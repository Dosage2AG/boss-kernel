/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. BACKTEST V2 — Monthly P&L, Multi-Asset, Leverage
   ════════════════════════════════════════════════════════════════ */

const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BOSS/1.0' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getHistory(coin, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=${days}&interval=hourly`;
  const data = await fetchJSON(url);
  return data.prices.map(([time, price]) => ({ time, price }));
}

// ── Multi-Asset Engine ──────────────────────────────────────────
class MultiAssetEngine {
  constructor(config) {
    this.c = config;
    this.balance = config.startBalance;
    this.positions = {}; // {coin: {entry, size, direction, time}}
    this.trades = [];
    this.monthlyPnL = {};
    this.peak = this.balance;
    this.maxDD = 0;
  }

  run(datasets) {
    // datasets = {bitcoin: [...], ethereum: [...], solana: [...]}
    const coins = Object.keys(datasets);
    const length = Math.min(...coins.map(c => datasets[c].length));
    
    // Price history per coin for trend calculation
    const history = {};
    coins.forEach(c => history[c] = []);
    
    for (let i = 1; i < length; i++) {
      const signals = {};
      
      for (const coin of coins) {
        const price = datasets[coin][i].price;
        const prevPrice = datasets[coin][i-1].price;
        const change = (price - prevPrice) / prevPrice;
        
        history[coin].push(price);
        if (history[coin].length > 100) history[coin].shift();
        
        // Multi-timeframe analysis
        const h = history[coin];
        const sma6 = h.length >= 6 ? h.slice(-6).reduce((s,p) => s+p, 0) / 6 : price;
        const sma24 = h.length >= 24 ? h.slice(-24).reduce((s,p) => s+p, 0) / 24 : price;
        const sma72 = h.length >= 72 ? h.slice(-72).reduce((s,p) => s+p, 0) / 72 : price;
        
        // Trend strength
        const shortTrend = (price - sma6) / sma6;
        const medTrend = (price - sma24) / sma24;
        const longTrend = (price - sma72) / sma72;
        
        // Warmth = combined momentum across timeframes
        const warmth = Math.abs(shortTrend) * 3 + Math.abs(medTrend) * 2 + Math.abs(longTrend);
        
        // Volatility for position sizing
        const vol = h.length >= 12 ? (() => {
          const rets = [];
          for (let j = 1; j < Math.min(h.length, 12); j++) {
            rets.push((h[j] - h[j-1]) / h[j-1]);
          }
          const avg = rets.reduce((s,r) => s+r, 0) / rets.length;
          return Math.sqrt(rets.reduce((s,r) => s + (r-avg)**2, 0) / rets.length);
        })() : 0.02;
        
        // Signal
        let direction = null;
        let strength = 0;
        
        // LONG: short trend up + medium confirms + warmth high
        if (shortTrend > this.c.entryThreshold && medTrend > 0 && warmth > this.c.minWarmth) {
          direction = 'LONG';
          strength = warmth;
        }
        // SHORT: short trend down + medium confirms
        else if (shortTrend < -this.c.entryThreshold && medTrend < 0 && warmth > this.c.minWarmth) {
          direction = 'SHORT';
          strength = warmth;
        }
        
        // Grief: short and medium disagree = confusion
        if (shortTrend * medTrend < 0 && Math.abs(shortTrend) > 0.01) {
          direction = null; // grief
        }
        
        signals[coin] = { price, change, direction, strength, warmth, vol };
      }
      
      // Manage existing positions
      for (const coin of coins) {
        if (this.positions[coin]) {
          const pos = this.positions[coin];
          const price = signals[coin].price;
          const pnl = pos.direction === 'LONG'
            ? (price - pos.entry) / pos.entry * this.c.leverage
            : (pos.entry - price) / pos.entry * this.c.leverage;
          
          if (pnl <= -this.c.stopLoss) {
            this.close(coin, price, 'SL', datasets[coin][i].time);
          } else if (pnl >= this.c.takeProfit) {
            this.close(coin, price, 'TP', datasets[coin][i].time);
          } else if (signals[coin].warmth < this.c.exitWarmth && pnl > 0.005) {
            this.close(coin, price, 'WD', datasets[coin][i].time);
          }
        }
      }
      
      // Open new positions — pick strongest signal
      const openCount = Object.keys(this.positions).length;
      if (openCount < this.c.maxPositions) {
        const candidates = coins
          .filter(c => !this.positions[c] && signals[c].direction)
          .sort((a, b) => signals[b].strength - signals[a].strength);
        
        for (const coin of candidates.slice(0, this.c.maxPositions - openCount)) {
          const s = signals[coin];
          // Position size based on volatility (riskier = smaller position)
          const volAdj = Math.min(1, 0.02 / (s.vol || 0.02));
          const size = this.balance * this.c.positionSize * volAdj;
          if (size < 10) continue;
          
          this.positions[coin] = {
            entry: s.price, size, direction: s.direction,
            time: datasets[coin][i].time
          };
          this.balance -= size;
        }
      }
      
      // Track equity and monthly P&L
      let totalEquity = this.balance;
      for (const coin of coins) {
        if (this.positions[coin]) {
          const pos = this.positions[coin];
          const price = signals[coin].price;
          const upnl = pos.direction === 'LONG'
            ? pos.size * ((price - pos.entry) / pos.entry * this.c.leverage)
            : pos.size * ((pos.entry - price) / pos.entry * this.c.leverage);
          totalEquity += pos.size + upnl;
        }
      }
      
      if (totalEquity > this.peak) this.peak = totalEquity;
      const dd = (this.peak - totalEquity) / this.peak;
      if (dd > this.maxDD) this.maxDD = dd;
      
      // Monthly tracking
      const date = new Date(datasets[coins[0]][i].time);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      if (!this.monthlyPnL[monthKey]) this.monthlyPnL[monthKey] = { start: totalEquity, end: totalEquity, trades: 0 };
      this.monthlyPnL[monthKey].end = totalEquity;
    }
    
    // Close remaining
    for (const coin of coins) {
      if (this.positions[coin]) {
        const price = datasets[coin][datasets[coin].length - 1].price;
        this.close(coin, price, 'END', datasets[coin][datasets[coin].length - 1].time);
      }
    }
    
    return this.results();
  }
  
  close(coin, price, reason, time) {
    const pos = this.positions[coin];
    if (!pos) return;
    const rawPnl = pos.direction === 'LONG'
      ? pos.size * ((price - pos.entry) / pos.entry * this.c.leverage)
      : pos.size * ((pos.entry - price) / pos.entry * this.c.leverage);
    const fee = pos.size * this.c.tradeFee * 2;
    const net = rawPnl - fee;
    this.balance += pos.size + net;
    this.trades.push({ coin, direction: pos.direction, pnl: net, pnlPct: net/pos.size*100, reason, time });
    
    const date = new Date(time);
    const mk = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    if (this.monthlyPnL[mk]) this.monthlyPnL[mk].trades++;
    
    delete this.positions[coin];
  }
  
  results() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    return {
      final: this.balance,
      totalReturn: (this.balance - this.c.startBalance) / this.c.startBalance * 100,
      trades: this.trades.length,
      winRate: this.trades.length > 0 ? wins.length / this.trades.length * 100 : 0,
      avgWin: wins.length > 0 ? wins.reduce((s,t) => s + t.pnlPct, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s,t) => s + t.pnlPct, 0) / losses.length : 0,
      maxDD: this.maxDD * 100,
      profitFactor: losses.length > 0
        ? Math.abs(wins.reduce((s,t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s,t) => s + t.pnl, 0))
        : Infinity,
      monthly: this.monthlyPnL
    };
  }
}

// ── Configurations to test ──────────────────────────────────────
const configs = [
  {
    name: 'POSITION 1x', startBalance: 1000, leverage: 1,
    positionSize: 0.4, maxPositions: 3, stopLoss: 0.06, takeProfit: 0.15,
    minWarmth: 0.08, exitWarmth: 0.03, entryThreshold: 0.005,
    tradeFee: 0.001, decayRate: 0.02
  },
  {
    name: 'POSITION 2x', startBalance: 1000, leverage: 2,
    positionSize: 0.3, maxPositions: 3, stopLoss: 0.04, takeProfit: 0.12,
    minWarmth: 0.08, exitWarmth: 0.03, entryThreshold: 0.005,
    tradeFee: 0.0005, decayRate: 0.02
  },
  {
    name: 'POSITION 3x', startBalance: 1000, leverage: 3,
    positionSize: 0.25, maxPositions: 3, stopLoss: 0.03, takeProfit: 0.10,
    minWarmth: 0.08, exitWarmth: 0.03, entryThreshold: 0.005,
    tradeFee: 0.0005, decayRate: 0.02
  },
  {
    name: 'AGGRESSIVE 2x', startBalance: 1000, leverage: 2,
    positionSize: 0.35, maxPositions: 3, stopLoss: 0.03, takeProfit: 0.08,
    minWarmth: 0.04, exitWarmth: 0.01, entryThreshold: 0.003,
    tradeFee: 0.0005, decayRate: 0.08
  },
  {
    name: 'MULTI-ASSET OPTIMIZED', startBalance: 1000, leverage: 2,
    positionSize: 0.30, maxPositions: 3, stopLoss: 0.035, takeProfit: 0.10,
    minWarmth: 0.06, exitWarmth: 0.02, entryThreshold: 0.004,
    tradeFee: 0.0005, decayRate: 0.04
  }
];

async function main() {
  console.log('═'.repeat(70));
  console.log('  B.O.S.S. BACKTEST V2 — Multi-Asset, Monthly Breakdown');
  console.log('  90 Days | BTC + ETH + SOL simultaneous | $1,000 start');
  console.log('═'.repeat(70));
  
  console.log('\n  Fetching data...');
  const btc = await getHistory('bitcoin', 90);
  await new Promise(r => setTimeout(r, 1500));
  const eth = await getHistory('ethereum', 90);
  await new Promise(r => setTimeout(r, 1500));
  const sol = await getHistory('solana', 90);
  
  const datasets = { bitcoin: btc, ethereum: eth, solana: sol };
  console.log(`  BTC: ${btc.length}h | ETH: ${eth.length}h | SOL: ${sol.length}h\n`);
  
  // Buy & hold comparison
  const bhBTC = ((btc[btc.length-1].price - btc[0].price) / btc[0].price * 100);
  const bhETH = ((eth[eth.length-1].price - eth[0].price) / eth[0].price * 100);
  const bhSOL = ((sol[sol.length-1].price - sol[0].price) / sol[0].price * 100);
  console.log(`  Buy & Hold: BTC ${bhBTC.toFixed(1)}% | ETH ${bhETH.toFixed(1)}% | SOL ${bhSOL.toFixed(1)}%\n`);
  
  for (const config of configs) {
    const engine = new MultiAssetEngine(config);
    const r = engine.run(JSON.parse(JSON.stringify(datasets)));
    
    console.log('─'.repeat(70));
    console.log(`  ${config.name} (${config.leverage}x leverage)`);
    console.log('─'.repeat(70));
    console.log(`  Return: ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | Final: $${r.final.toFixed(0)} | Trades: ${r.trades}`);
    console.log(`  WinRate: ${r.winRate.toFixed(0)}% | AvgWin: +${r.avgWin.toFixed(1)}% | AvgLoss: ${r.avgLoss.toFixed(1)}% | PF: ${r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)} | MaxDD: ${r.maxDD.toFixed(1)}%`);
    
    // Monthly breakdown with fees
    console.log('\n  MONTHLY P&L (after 99 EUR sub + 0.5% trade fee + 17.5% profit share):');
    let totalUserProfit = 0;
    let totalBossRevenue = 0;
    
    for (const [month, data] of Object.entries(r.monthly)) {
      const grossPnl = data.end - data.start;
      const grossPct = (grossPnl / data.start * 100);
      
      const sub = 99;
      const tradeFees = data.trades * data.start * 0.005 * config.positionSize; // approximate
      const profitShare = grossPnl > 0 ? grossPnl * 0.175 : 0;
      const totalFees = sub + profitShare;
      
      const userNet = grossPnl - totalFees;
      const userNetPct = (userNet / data.start * 100);
      
      totalUserProfit += userNet;
      totalBossRevenue += totalFees;
      
      const emoji = userNet >= 0 ? '🟢' : '🔴';
      console.log(`    ${emoji} ${month}: Gross ${grossPnl >= 0 ? '+' : ''}$${grossPnl.toFixed(0)} (${grossPct.toFixed(1)}%) → Sub -$99, Share -$${profitShare.toFixed(0)} → User net: ${userNet >= 0 ? '+' : ''}$${userNet.toFixed(0)} (${userNetPct.toFixed(1)}%)`);
    }
    
    console.log(`\n    TOTAL — User profit: ${totalUserProfit >= 0 ? '+' : ''}$${totalUserProfit.toFixed(0)} | B.O.S.S. revenue: $${totalBossRevenue.toFixed(0)}`);
    console.log(`    Min account for user to profit: $${(99 / (r.totalReturn/100 * (1-0.175)) * 3).toFixed(0)} (estimated)`);
  }
  
  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
