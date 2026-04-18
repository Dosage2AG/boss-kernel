/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. BACKTEST ENGINE — Historical Trading Simulation
   Tests ALL strategies against real market data
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

// ── Fetch Historical Data ───────────────────────────────────────
async function getHistoricalData(coin, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=${days}&interval=hourly`;
  const data = await fetchJSON(url);
  return data.prices.map(([time, price]) => ({ time, price }));
}

// ── Trading Strategy ────────────────────────────────────────────
class BacktestEngine {
  constructor(config) {
    this.config = config;
    this.balance = 1000; // Start with $1000
    this.positions = [];
    this.trades = [];
    this.equity = [];
    this.maxDrawdown = 0;
    this.peak = 1000;
  }

  run(priceData) {
    const warmthHistory = [];
    let warmth = 0.1;
    let lastPrice = priceData[0].price;
    
    for (let i = 1; i < priceData.length; i++) {
      const price = priceData[i].price;
      const change = (price - lastPrice) / lastPrice;
      const changePct = change * 100;
      const momentum = Math.abs(changePct);
      
      // Update warmth (biological decay + momentum injection)
      warmth *= Math.exp(-this.config.decayRate);
      warmth += momentum * 0.5;
      warmthHistory.push(warmth);
      
      // Moving averages for trend detection
      const lookback = Math.min(i, this.config.lookback || 24);
      const prices = priceData.slice(i - lookback, i + 1).map(p => p.price);
      const sma = prices.reduce((s, p) => s + p, 0) / prices.length;
      const trend = price > sma ? 'BULL' : 'BEAR';
      
      // Volatility (standard deviation of recent changes)
      const changes = [];
      for (let j = Math.max(1, i - lookback); j <= i; j++) {
        changes.push((priceData[j].price - priceData[j-1].price) / priceData[j-1].price);
      }
      const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;
      const volatility = Math.sqrt(changes.reduce((s, c) => s + (c - avgChange) ** 2, 0) / changes.length);
      
      // Check existing position
      if (this.positions.length > 0) {
        const pos = this.positions[0];
        const posPnL = pos.direction === 'LONG' 
          ? (price - pos.entry) / pos.entry 
          : (pos.entry - price) / pos.entry;
        
        // Stop loss
        if (posPnL <= -this.config.stopLoss) {
          this.closePosition(price, 'SL', priceData[i].time);
        }
        // Take profit
        else if (posPnL >= this.config.takeProfit) {
          this.closePosition(price, 'TP', priceData[i].time);
        }
        // Warmth decay exit — signal dying
        else if (warmth < this.config.exitWarmth && posPnL > 0.002) {
          this.closePosition(price, 'WD', priceData[i].time);
        }
      }
      
      // Entry signals
      if (this.positions.length === 0 && warmth >= this.config.minWarmth) {
        // Grief check — skip if volatility is extreme (contradictory signals)
        if (volatility > this.config.griefVolatility) {
          // Grief — do nothing
        } else if (trend === 'BULL' && changePct > this.config.entryThreshold) {
          this.openPosition(price, 'LONG', priceData[i].time);
        } else if (trend === 'BEAR' && changePct < -this.config.entryThreshold) {
          this.openPosition(price, 'SHORT', priceData[i].time);
        }
      }
      
      // Track equity
      let unrealized = 0;
      if (this.positions.length > 0) {
        const pos = this.positions[0];
        unrealized = pos.direction === 'LONG'
          ? pos.size * ((price - pos.entry) / pos.entry)
          : pos.size * ((pos.entry - price) / pos.entry);
      }
      const totalEquity = this.balance + (this.positions.length > 0 ? this.positions[0].size : 0) + unrealized;
      this.equity.push({ time: priceData[i].time, value: totalEquity });
      
      if (totalEquity > this.peak) this.peak = totalEquity;
      const dd = (this.peak - totalEquity) / this.peak;
      if (dd > this.maxDrawdown) this.maxDrawdown = dd;
      
      lastPrice = price;
    }
    
    // Close any remaining position at final price
    if (this.positions.length > 0) {
      this.closePosition(priceData[priceData.length - 1].price, 'END', priceData[priceData.length - 1].time);
    }
    
    return this.getResults();
  }
  
  openPosition(price, direction, time) {
    const size = this.balance * this.config.positionSize;
    this.balance -= size;
    this.positions.push({ entry: price, size, direction, time });
  }
  
  closePosition(price, reason, time) {
    const pos = this.positions[0];
    const pnl = pos.direction === 'LONG'
      ? pos.size * ((price - pos.entry) / pos.entry)
      : pos.size * ((pos.entry - price) / pos.entry);
    
    // Subtract trading fees
    const fee = pos.size * this.config.tradeFee * 2; // entry + exit
    const netPnl = pnl - fee;
    
    this.balance += pos.size + netPnl;
    this.trades.push({
      direction: pos.direction,
      entry: pos.entry,
      exit: price,
      pnl: netPnl,
      pnlPct: (netPnl / pos.size * 100),
      reason,
      time
    });
    this.positions = [];
  }
  
  getResults() {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl <= 0);
    const totalPnl = this.balance - 1000;
    const returnPct = (totalPnl / 1000 * 100);
    const winRate = this.trades.length > 0 ? (wins.length / this.trades.length * 100) : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const profitFactor = losses.length > 0
      ? Math.abs(wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
      : wins.length > 0 ? Infinity : 0;
    
    return {
      finalBalance: this.balance,
      totalPnl,
      returnPct,
      trades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgWin,
      avgLoss,
      maxDrawdown: this.maxDrawdown * 100,
      profitFactor,
      equity: this.equity
    };
  }
}

// ── Strategy Configurations ─────────────────────────────────────
const strategies = {
  scalp: {
    name: '⚡ SCALPER',
    positionSize: 0.3, stopLoss: 0.015, takeProfit: 0.025,
    minWarmth: 0.1, exitWarmth: 0.05, entryThreshold: 0.3,
    decayRate: 0.15, lookback: 6, griefVolatility: 0.03,
    tradeFee: 0.001 // 0.1% Binance
  },
  swing: {
    name: '🐺 SWING',
    positionSize: 0.4, stopLoss: 0.04, takeProfit: 0.08,
    minWarmth: 0.3, exitWarmth: 0.1, entryThreshold: 0.5,
    decayRate: 0.05, lookback: 24, griefVolatility: 0.04,
    tradeFee: 0.001
  },
  position: {
    name: '🐻 POSITION',
    positionSize: 0.5, stopLoss: 0.08, takeProfit: 0.20,
    minWarmth: 0.8, exitWarmth: 0.3, entryThreshold: 1.0,
    decayRate: 0.02, lookback: 72, griefVolatility: 0.05,
    tradeFee: 0.001
  },
  aggressive: {
    name: '🔥 AGGRESSIVE',
    positionSize: 0.5, stopLoss: 0.02, takeProfit: 0.04,
    minWarmth: 0.05, exitWarmth: 0.02, entryThreshold: 0.2,
    decayRate: 0.1, lookback: 12, griefVolatility: 0.025,
    tradeFee: 0.001
  },
  conservative: {
    name: '🛡️ CONSERVATIVE',
    positionSize: 0.2, stopLoss: 0.03, takeProfit: 0.06,
    minWarmth: 0.5, exitWarmth: 0.2, entryThreshold: 0.8,
    decayRate: 0.03, lookback: 48, griefVolatility: 0.035,
    tradeFee: 0.001
  }
};

// ── Run Backtest ────────────────────────────────────────────────
async function main() {
  const coins = ['bitcoin', 'ethereum', 'solana'];
  const days = 90;
  
  console.log('═'.repeat(70));
  console.log('  B.O.S.S. BACKTEST — 90 Days Historical Data');
  console.log('  Starting capital: $1,000 per test');
  console.log('  Fee: 0.1% per trade (Binance rate)');
  console.log('═'.repeat(70));
  
  for (const coin of coins) {
    console.log(`\n  Fetching ${coin} ${days}-day hourly data...`);
    let data;
    try {
      data = await getHistoricalData(coin, days);
      console.log(`  Got ${data.length} hourly candles`);
    } catch(e) {
      console.log(`  Error: ${e.message}`);
      continue;
    }
    
    const startPrice = data[0].price;
    const endPrice = data[data.length - 1].price;
    const buyHold = ((endPrice - startPrice) / startPrice * 100);
    
    console.log(`  ${coin.toUpperCase()}: $${startPrice.toFixed(2)} → $${endPrice.toFixed(2)} (buy&hold: ${buyHold.toFixed(1)}%)`);
    console.log('─'.repeat(70));
    console.log(`  ${'Strategy'.padEnd(18)} ${'Return'.padEnd(10)} ${'Trades'.padEnd(8)} ${'Win%'.padEnd(8)} ${'AvgWin'.padEnd(9)} ${'AvgLoss'.padEnd(9)} ${'MaxDD'.padEnd(8)} ${'PF'.padEnd(6)} Final`);
    console.log('─'.repeat(70));
    
    for (const [key, config] of Object.entries(strategies)) {
      const engine = new BacktestEngine(config);
      const r = engine.run([...data]);
      
      const better = r.returnPct > buyHold ? '✓' : '✗';
      console.log(
        `  ${better} ${config.name.padEnd(16)} ` +
        `${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(1) + '%'}`.padEnd(10) +
        `${r.trades}`.padEnd(8) +
        `${r.winRate.toFixed(0)}%`.padEnd(8) +
        `${'+' + r.avgWin.toFixed(1) + '%'}`.padEnd(9) +
        `${r.avgLoss.toFixed(1) + '%'}`.padEnd(9) +
        `${r.maxDrawdown.toFixed(1) + '%'}`.padEnd(8) +
        `${r.profitFactor.toFixed(2)}`.padEnd(6) +
        `$${r.finalBalance.toFixed(0)}`
      );
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('  LEGEND: Return = total %, Trades = count, Win% = win rate');
  console.log('  AvgWin/Loss = average trade %, MaxDD = max drawdown, PF = profit factor');
  console.log('  ✓ = beat buy & hold, ✗ = underperformed buy & hold');
  console.log('═'.repeat(70));
}

main().catch(console.error);
