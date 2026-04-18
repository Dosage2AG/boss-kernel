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

class MaxProfitEngine {
  constructor(c) {
    this.c = c;
    this.balance = 1000;
    this.positions = {};
    this.trades = [];
    this.peak = 1000;
    this.maxDD = 0;
    this.monthlyPnL = {};
  }

  run(datasets) {
    const coins = Object.keys(datasets);
    const len = Math.min(...coins.map(c => datasets[c].length));
    const hist = {}; coins.forEach(c => hist[c] = []);

    for (let i = 1; i < len; i++) {
      for (const coin of coins) {
        const price = datasets[coin][i].price;
        hist[coin].push(price);
        if (hist[coin].length > 120) hist[coin].shift();
        const h = hist[coin];

        // Multi-timeframe EMAs
        const ema = (arr, period) => {
          const k = 2 / (period + 1);
          let e = arr[0];
          for (let j = 1; j < arr.length; j++) e = arr[j] * k + e * (1 - k);
          return e;
        };
        
        const ema8 = h.length >= 8 ? ema(h.slice(-8), 8) : price;
        const ema21 = h.length >= 21 ? ema(h.slice(-21), 21) : price;
        const ema55 = h.length >= 55 ? ema(h.slice(-55), 55) : price;

        // RSI-like momentum
        let gains = 0, losses = 0;
        const rsiLen = Math.min(14, h.length - 1);
        for (let j = h.length - rsiLen; j < h.length; j++) {
          const diff = h[j] - h[j-1];
          if (diff > 0) gains += diff; else losses -= diff;
        }
        const rs = losses > 0 ? gains / losses : 100;
        const rsi = 100 - (100 / (1 + rs));

        // Volatility
        const changes = [];
        for (let j = Math.max(1, h.length - 20); j < h.length; j++) {
          changes.push((h[j] - h[j-1]) / h[j-1]);
        }
        const vol = Math.sqrt(changes.reduce((s, c) => s + c * c, 0) / (changes.length || 1));

        // Dynamic leverage — higher conviction = higher leverage
        const trendStrength = Math.abs(ema8 - ema21) / ema21;
        const dynamicLev = Math.min(this.c.maxLeverage, this.c.baseLeverage + trendStrength * 50);

        // MANAGE POSITION
        if (this.positions[coin]) {
          const pos = this.positions[coin];
          const pnl = pos.dir === 'LONG'
            ? (price - pos.entry) / pos.entry * pos.lev
            : (pos.entry - price) / pos.entry * pos.lev;

          // Trailing stop — tighten as profit grows
          const trailStop = pnl > 0.05 ? -0.02 : -this.c.stopLoss;

          if (pnl <= trailStop) {
            this.close(coin, price, pnl > 0 ? 'TS' : 'SL', datasets[coin][i].time);
          } else if (pnl >= this.c.takeProfit) {
            // Partial close — take 60%, let 40% ride
            if (!pos.partial) {
              const partialPnl = pos.size * 0.6 * pnl;
              const fee = pos.size * 0.6 * this.c.fee * 2;
              this.balance += pos.size * 0.6 + partialPnl - fee;
              pos.size *= 0.4;
              pos.partial = true;
              this.trades.push({ coin, dir: pos.dir, pnl: partialPnl - fee, reason: 'PT', time: datasets[coin][i].time });
              this.trackMonth(datasets[coin][i].time);
            } else if (pnl >= this.c.takeProfit * 2) {
              this.close(coin, price, 'TP2', datasets[coin][i].time);
            }
          }
          // EMA crossover exit
          else if (pos.dir === 'LONG' && ema8 < ema21 && pnl > 0) {
            this.close(coin, price, 'EX', datasets[coin][i].time);
          } else if (pos.dir === 'SHORT' && ema8 > ema21 && pnl > 0) {
            this.close(coin, price, 'EX', datasets[coin][i].time);
          }
        }

        // ENTRY SIGNALS
        if (!this.positions[coin] && Object.keys(this.positions).length < this.c.maxPos) {
          // Grief — extreme volatility, stay out
          if (vol > this.c.griefVol) continue;

          // LONG: EMA8 crosses above EMA21, RSI between 40-70 (not overbought)
          if (ema8 > ema21 && ema21 > ema55 && rsi > 40 && rsi < 70 && trendStrength > 0.003) {
            const size = Math.min(this.balance * this.c.posSize, this.balance * 0.95);
            if (size < 10) continue;
            this.positions[coin] = { entry: price, size, dir: 'LONG', lev: dynamicLev, partial: false };
            this.balance -= size;
          }
          // SHORT: EMA8 crosses below EMA21, RSI between 30-60
          else if (ema8 < ema21 && ema21 < ema55 && rsi > 30 && rsi < 60 && trendStrength > 0.003) {
            const size = Math.min(this.balance * this.c.posSize, this.balance * 0.95);
            if (size < 10) continue;
            this.positions[coin] = { entry: price, size, dir: 'SHORT', lev: dynamicLev, partial: false };
            this.balance -= size;
          }
        }
      }

      // Track equity
      let eq = this.balance;
      for (const coin of coins) {
        if (this.positions[coin]) {
          const pos = this.positions[coin];
          const p = datasets[coin][i].price;
          const upnl = pos.dir === 'LONG'
            ? pos.size * ((p - pos.entry) / pos.entry * pos.lev)
            : pos.size * ((pos.entry - p) / pos.entry * pos.lev);
          eq += pos.size + upnl;
        }
      }
      if (eq > this.peak) this.peak = eq;
      const dd = (this.peak - eq) / this.peak;
      if (dd > this.maxDD) this.maxDD = dd;

      const date = new Date(datasets[coins[0]][i].time);
      const mk = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      if (!this.monthlyPnL[mk]) this.monthlyPnL[mk] = { start: eq, end: eq, trades: 0 };
      this.monthlyPnL[mk].end = eq;
    }

    // Close remaining
    for (const coin of coins) {
      if (this.positions[coin]) {
        this.close(coin, datasets[coin][datasets[coin].length-1].price, 'END', datasets[coin][datasets[coin].length-1].time);
      }
    }

    return this.results();
  }

  close(coin, price, reason, time) {
    const pos = this.positions[coin];
    if (!pos) return;
    const pnl = pos.dir === 'LONG'
      ? pos.size * ((price - pos.entry) / pos.entry * pos.lev)
      : pos.size * ((pos.entry - price) / pos.entry * pos.lev);
    const fee = pos.size * this.c.fee * 2;
    this.balance += pos.size + pnl - fee;
    this.trades.push({ coin, dir: pos.dir, pnl: pnl - fee, pnlPct: (pnl-fee)/pos.size*100, reason, time });
    this.trackMonth(time);
    delete this.positions[coin];
  }

  trackMonth(time) {
    const d = new Date(time);
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (this.monthlyPnL[mk]) this.monthlyPnL[mk].trades++;
  }

  results() {
    const w = this.trades.filter(t => t.pnl > 0);
    const l = this.trades.filter(t => t.pnl <= 0);
    return {
      final: this.balance, ret: (this.balance - 1000) / 10,
      trades: this.trades.length, winRate: this.trades.length ? w.length/this.trades.length*100 : 0,
      avgWin: w.length ? w.reduce((s,t)=>s+t.pnlPct,0)/w.length : 0,
      avgLoss: l.length ? l.reduce((s,t)=>s+t.pnlPct,0)/l.length : 0,
      maxDD: this.maxDD * 100,
      pf: l.length ? Math.abs(w.reduce((s,t)=>s+t.pnl,0))/Math.abs(l.reduce((s,t)=>s+t.pnl,0)) : Infinity,
      monthly: this.monthlyPnL
    };
  }
}

const configs = [
  { name: 'DYNAMIC 3-5x', baseLeverage: 3, maxLeverage: 5, posSize: 0.35, maxPos: 3, stopLoss: 0.03, takeProfit: 0.08, fee: 0.0005, griefVol: 0.04 },
  { name: 'DYNAMIC 5-8x', baseLeverage: 5, maxLeverage: 8, posSize: 0.30, maxPos: 3, stopLoss: 0.02, takeProfit: 0.06, fee: 0.0005, griefVol: 0.035 },
  { name: 'DYNAMIC 5-10x', baseLeverage: 5, maxLeverage: 10, posSize: 0.25, maxPos: 3, stopLoss: 0.015, takeProfit: 0.05, fee: 0.0005, griefVol: 0.03 },
  { name: 'MAX POWER 8-15x', baseLeverage: 8, maxLeverage: 15, posSize: 0.20, maxPos: 2, stopLoss: 0.01, takeProfit: 0.04, fee: 0.0005, griefVol: 0.025 },
];

async function main() {
  console.log('═'.repeat(70));
  console.log('  B.O.S.S. MAX PROFIT BACKTEST — Targeting 100%+ Returns');
  console.log('  90 Days | BTC + ETH + SOL | Dynamic Leverage | $1,000');
  console.log('  Features: EMA crossover, RSI filter, trailing stop,');
  console.log('  partial take-profit, dynamic leverage, grief protocol');
  console.log('═'.repeat(70));

  const btc = await getHistory('bitcoin', 90);
  await new Promise(r => setTimeout(r, 1500));
  const eth = await getHistory('ethereum', 90);
  await new Promise(r => setTimeout(r, 1500));
  const sol = await getHistory('solana', 90);

  const ds = { bitcoin: btc, ethereum: eth, solana: sol };
  const bh = ((btc[btc.length-1].price - btc[0].price) / btc[0].price * 100);
  console.log(`\n  Market: BTC ${bh.toFixed(1)}% (bear market)\n`);

  for (const c of configs) {
    const engine = new MaxProfitEngine(c);
    const r = engine.run(JSON.parse(JSON.stringify(ds)));

    console.log('─'.repeat(70));
    console.log(`  ${c.name}`);
    console.log(`  Return: ${r.ret >= 0 ? '+' : ''}${r.ret.toFixed(1)}% | $1000 → $${r.final.toFixed(0)} | ${r.trades} trades`);
    console.log(`  WR: ${r.winRate.toFixed(0)}% | AvgW: +${r.avgWin.toFixed(1)}% | AvgL: ${r.avgLoss.toFixed(1)}% | MaxDD: ${r.maxDD.toFixed(1)}% | PF: ${r.pf === Infinity ? '∞' : r.pf.toFixed(2)}`);

    console.log('  Monthly:');
    let userTotal = 0, bossTotal = 0;
    for (const [m, d] of Object.entries(r.monthly)) {
      const gross = d.end - d.start;
      const pct = gross / d.start * 100;
      const sub = 29;
      const share = gross > 0 ? gross * 0.175 : 0;
      const userNet = gross - sub - share;
      userTotal += userNet;
      bossTotal += sub + share;
      const e = userNet >= 0 ? '🟢' : '🔴';
      console.log(`    ${e} ${m}: ${gross>=0?'+':''}$${gross.toFixed(0)} (${pct.toFixed(1)}%) → user: ${userNet>=0?'+':''}$${userNet.toFixed(0)} | boss: $${(sub+share).toFixed(0)}`);
    }
    console.log(`  TOTAL → User: ${userTotal>=0?'+':''}$${userTotal.toFixed(0)} | B.O.S.S: $${bossTotal.toFixed(0)} | ${r.ret >= 100 ? '✓ 100%+ TARGET HIT' : '✗ below 100%'}`);
  }
  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
