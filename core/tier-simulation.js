/* ══════════════════════════════════════════════════════════════
   B.O.S.S. TIER PROFIT SIMULATION
   $1,000 investment over 30 days, all 5 tiers
   Based on actual engine parameters + backtest data
   ══════════════════════════════════════════════════════════════ */

const DAYS = 30;
const TICKS_PER_DAY = 96; // every 15 min
const INITIAL = 1000; // USD
const RUNS = 500; // Monte Carlo runs per tier

// Tier configurations — based on actual engine params
const TIERS = {
  observer: {
    name: '👁  OBSERVER',
    monthlyFee: 0,
    profitShare: 0,
    canTrade: false,
    description: 'Watch only — no trading'
  },
  explorer: {
    name: '🔭 EXPLORER',
    monthlyFee: 29,
    profitShare: 0,
    canTrade: true, // demo only, but simulating as if real
    maxPos: 4,
    posSize: 0.20,
    stopLoss: 0.035,
    takeProfit: 0.08,
    baseLev: 2,
    maxLev: 4,
    signalQuality: 0.52, // base win rate from EMA/RSI
    description: 'Demo signals, basic engine'
  },
  trader: {
    name: '⚡ TRADER',
    monthlyFee: 99,
    profitShare: 0.20,
    canTrade: true,
    maxPos: 4,
    posSize: 0.20,
    stopLoss: 0.035,
    takeProfit: 0.08,
    baseLev: 2,
    maxLev: 4,
    signalQuality: 0.52,
    description: 'Real money, same engine'
  },
  strategist: {
    name: '🧠 STRATEGIST',
    monthlyFee: 299,
    profitShare: 0.15,
    canTrade: true,
    maxPos: 6,
    posSize: 0.18,
    stopLoss: 0.03,
    takeProfit: 0.10,
    baseLev: 2,
    maxLev: 5,
    signalQuality: 0.58, // AI consensus boosts accuracy
    cascadeBoost: true,
    fundingFarm: true,
    description: 'AI consensus + cascade + funding farming'
  },
  boss: {
    name: '👑 BOSS TOKEN',
    monthlyFee: 0, // staking instead
    profitShare: 0.10,
    canTrade: true,
    maxPos: 8,
    posSize: 0.15,
    stopLoss: 0.025,
    takeProfit: 0.12,
    baseLev: 2,
    maxLev: 6,
    signalQuality: 0.60, // best signals + all data
    cascadeBoost: true,
    fundingFarm: true,
    stakeRequired: 500, // $500 worth of BOSS token
    description: 'All features, tightest risk, best signals'
  }
};

// Market simulation — realistic crypto volatility
function simulateMarket(days) {
  const ticks = days * TICKS_PER_DAY;
  const prices = [];
  let regime = 'neutral'; // bull, bear, neutral, choppy
  let regimeTimer = 0;

  for (let t = 0; t < ticks; t++) {
    // Regime shifts every 1-5 days
    regimeTimer--;
    if (regimeTimer <= 0) {
      const r = Math.random();
      if (r < 0.3) regime = 'bull';
      else if (r < 0.55) regime = 'bear';
      else if (r < 0.75) regime = 'choppy';
      else regime = 'neutral';
      regimeTimer = Math.floor((TICKS_PER_DAY * 1) + Math.random() * TICKS_PER_DAY * 4);
    }

    // Base volatility per 15-min tick
    let drift = 0, vol = 0.003;
    if (regime === 'bull') { drift = 0.0004; vol = 0.004; }
    else if (regime === 'bear') { drift = -0.0003; vol = 0.005; }
    else if (regime === 'choppy') { drift = 0; vol = 0.006; }

    // Multiple assets moving with correlation
    const marketMove = drift + (Math.random() - 0.5) * 2 * vol;
    const assets = [];
    for (let a = 0; a < 10; a++) {
      const correlation = 0.6 + Math.random() * 0.3;
      const idio = (Math.random() - 0.5) * 2 * vol * 0.5;
      assets.push(marketMove * correlation + idio);
    }
    prices.push({ regime, moves: assets, grief: regime === 'choppy' ? 0.7 : 0.2 });
  }
  return prices;
}

// Trading simulation for one tier
function simulateTier(tierKey, market) {
  const tier = TIERS[tierKey];
  if (!tier.canTrade) {
    return {
      finalBalance: INITIAL - tier.monthlyFee,
      grossProfit: 0,
      fees: tier.monthlyFee,
      platformCut: 0,
      netProfit: -tier.monthlyFee,
      trades: 0,
      wins: 0,
      losses: 0,
      maxDrawdown: 0
    };
  }

  let balance = INITIAL;
  let peak = INITIAL;
  let maxDD = 0;
  const positions = [];
  let wins = 0, losses = 0;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;
  let dailyPnL = 0;
  let lastDayReset = 0;
  let fundingIncome = 0;

  for (let t = 0; t < market.length; t++) {
    const tick = market[t];
    const day = Math.floor(t / TICKS_PER_DAY);

    // Reset daily P&L
    if (day !== lastDayReset) { dailyPnL = 0; lastDayReset = day; }

    // Daily loss limit (12%)
    if (dailyPnL < -(INITIAL * 0.12)) continue;

    // Grief filter — don't trade in choppy markets
    if (tick.grief > 0.6) {
      // Close all positions during grief
      for (let p = positions.length - 1; p >= 0; p--) {
        const pos = positions[p];
        const pnl = pos.dir === 1 ? tick.moves[pos.asset] * pos.lev : -tick.moves[pos.asset] * pos.lev;
        const net = pos.size * pnl;
        balance += pos.size + net;
        dailyPnL += net;
        if (net > 0) { wins++; consecutiveLosses = 0; }
        else { losses++; consecutiveLosses++; }
        positions.splice(p, 1);
      }
      continue;
    }

    // Cooldown after consecutive losses
    if (t < cooldownUntil) continue;

    // Manage open positions
    for (let p = positions.length - 1; p >= 0; p--) {
      const pos = positions[p];
      pos.cumPnl += pos.dir === 1 ? tick.moves[pos.asset] * pos.lev : -tick.moves[pos.asset] * pos.lev;

      // Stop loss
      if (pos.cumPnl <= -tier.stopLoss) {
        const net = pos.size * pos.cumPnl;
        balance += pos.size + net;
        dailyPnL += net;
        losses++; consecutiveLosses++;
        if (consecutiveLosses >= 3) cooldownUntil = t + TICKS_PER_DAY / 4; // 6 hour cooldown
        positions.splice(p, 1);
        continue;
      }

      // Take profit
      if (pos.cumPnl >= tier.takeProfit) {
        const net = pos.size * pos.cumPnl;
        balance += pos.size + net;
        dailyPnL += net;
        wins++; consecutiveLosses = 0;
        positions.splice(p, 1);
        continue;
      }

      // Trailing stop (lock profits above 5%)
      if (pos.cumPnl > 0.05 && pos.cumPnl < pos.peak - 0.015) {
        const net = pos.size * pos.cumPnl;
        balance += pos.size + net;
        dailyPnL += net;
        wins++; consecutiveLosses = 0;
        positions.splice(p, 1);
        continue;
      }

      if (pos.cumPnl > pos.peak) pos.peak = pos.cumPnl;
    }

    // New entries — check if signal quality hits
    if (positions.length < tier.maxPos && balance > 50) {
      // Signal fires ~2-4 times per day
      if (Math.random() < 3 / TICKS_PER_DAY) {
        // Signal quality determines if it's a good entry
        const goodSignal = Math.random() < tier.signalQuality;
        // Cascade boost for strategist/boss
        let sizeMultiplier = 1;
        if (tier.cascadeBoost && Math.random() < 0.15) sizeMultiplier = 1.4;

        const dir = goodSignal ? (tick.regime === 'bear' ? -1 : 1) : (Math.random() > 0.5 ? 1 : -1);
        let size = balance * tier.posSize * sizeMultiplier;
        if (consecutiveLosses > 2) size *= 0.5;
        size = Math.min(size, balance * 0.9);
        const lev = Math.min(tier.maxLev, tier.baseLev + Math.random() * 2);

        positions.push({ asset: Math.floor(Math.random() * 10), dir, size, lev, cumPnl: 0, peak: 0 });
        balance -= size;
      }
    }

    // Funding farming income (strategist/boss) — small steady income
    if (tier.fundingFarm && Math.random() < 0.1) {
      const fi = balance * 0.0001; // ~0.01% per opportunity
      fundingIncome += fi;
      balance += fi;
    }

    // Track drawdown
    const totalValue = balance + positions.reduce((s, p) => s + p.size, 0);
    if (totalValue > peak) peak = totalValue;
    const dd = (peak - totalValue) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Close remaining positions at end
  for (const pos of positions) {
    const net = pos.size * pos.cumPnl;
    balance += pos.size + net;
    if (net > 0) wins++; else losses++;
  }

  const grossProfit = balance - INITIAL;
  const platformCut = grossProfit > 0 ? grossProfit * tier.profitShare : 0;
  const netProfit = grossProfit - platformCut - tier.monthlyFee;

  return {
    finalBalance: INITIAL + netProfit,
    grossProfit: grossProfit,
    fees: tier.monthlyFee,
    platformCut,
    netProfit,
    trades: wins + losses,
    wins, losses,
    maxDrawdown: maxDD,
    fundingIncome
  };
}

// ══════════════════════════════════════════════════════════════
// RUN MONTE CARLO
// ══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(70));
console.log('  B.O.S.S. TIER PROFIT SIMULATION');
console.log('  $1,000 investment · 30 days · ' + RUNS + ' Monte Carlo runs');
console.log('═'.repeat(70));

const results = {};

for (const tierKey of Object.keys(TIERS)) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const market = simulateMarket(DAYS);
    runs.push(simulateTier(tierKey, market));
  }

  // Aggregate
  runs.sort((a, b) => a.netProfit - b.netProfit);
  const median = runs[Math.floor(RUNS / 2)];
  const p10 = runs[Math.floor(RUNS * 0.1)];
  const p90 = runs[Math.floor(RUNS * 0.9)];
  const avg = {
    netProfit: runs.reduce((s, r) => s + r.netProfit, 0) / RUNS,
    grossProfit: runs.reduce((s, r) => s + r.grossProfit, 0) / RUNS,
    trades: runs.reduce((s, r) => s + r.trades, 0) / RUNS,
    wins: runs.reduce((s, r) => s + r.wins, 0) / RUNS,
    losses: runs.reduce((s, r) => s + r.losses, 0) / RUNS,
    maxDrawdown: runs.reduce((s, r) => s + r.maxDrawdown, 0) / RUNS,
    platformCut: runs.reduce((s, r) => s + r.platformCut, 0) / RUNS,
    fees: TIERS[tierKey].monthlyFee,
    fundingIncome: runs.reduce((s, r) => s + (r.fundingIncome || 0), 0) / RUNS,
  };
  const winRate = avg.trades > 0 ? (avg.wins / avg.trades * 100) : 0;
  const profitableRuns = runs.filter(r => r.netProfit > 0).length;

  results[tierKey] = { avg, median, p10, p90, winRate, profitableRuns, tier: TIERS[tierKey] };
}

// Print results
for (const [key, r] of Object.entries(results)) {
  const t = r.tier;
  console.log('\n' + '─'.repeat(70));
  console.log(`  ${t.name}  —  ${t.description}`);
  console.log('─'.repeat(70));

  if (!t.canTrade) {
    console.log('  No trading. Cost: -$' + t.monthlyFee);
    console.log('  Net after 30 days: $' + (INITIAL - t.monthlyFee).toFixed(0));
    continue;
  }

  const a = r.avg;
  console.log(`  Monthly fee:      $${a.fees}`);
  console.log(`  Profit share:     ${(t.profitShare * 100)}%`);
  console.log(`  Avg trades/mo:    ${a.trades.toFixed(0)} (WR: ${r.winRate.toFixed(0)}%)`);
  console.log(`  Avg gross profit: $${a.grossProfit.toFixed(2)} (${(a.grossProfit / INITIAL * 100).toFixed(1)}%)`);
  console.log(`  Platform cut:     -$${a.platformCut.toFixed(2)}`);
  console.log(`  Fee:              -$${a.fees}`);
  if (a.fundingIncome > 0)
    console.log(`  Funding income:   +$${a.fundingIncome.toFixed(2)}`);
  console.log(`  ─────────────────────────`);
  console.log(`  NET PROFIT:       $${a.netProfit >= 0 ? '+' : ''}${a.netProfit.toFixed(2)} (${(a.netProfit / INITIAL * 100).toFixed(1)}%)`);
  console.log(`  Final balance:    $${(INITIAL + a.netProfit).toFixed(2)}`);
  console.log();
  console.log(`  Scenarios (500 runs):`);
  console.log(`    Bad month (10th %ile):  $${(INITIAL + r.p10.netProfit).toFixed(0)} (${r.p10.netProfit >= 0 ? '+' : ''}${(r.p10.netProfit / INITIAL * 100).toFixed(1)}%)`);
  console.log(`    Median month:           $${(INITIAL + r.median.netProfit).toFixed(0)} (${r.median.netProfit >= 0 ? '+' : ''}${(r.median.netProfit / INITIAL * 100).toFixed(1)}%)`);
  console.log(`    Good month (90th %ile): $${(INITIAL + r.p90.netProfit).toFixed(0)} (${r.p90.netProfit >= 0 ? '+' : ''}${(r.p90.netProfit / INITIAL * 100).toFixed(1)}%)`);
  console.log(`  Profitable runs:  ${r.profitableRuns}/${RUNS} (${(r.profitableRuns / RUNS * 100).toFixed(0)}%)`);
  console.log(`  Avg max drawdown: ${(a.maxDrawdown * 100).toFixed(1)}%`);
}

// Summary comparison
console.log('\n' + '═'.repeat(70));
console.log('  COMPARISON — $1,000 over 30 days');
console.log('═'.repeat(70));
console.log('  Tier          │ Net Profit │ Return │ Win Rate │ Profitable');
console.log('  ──────────────┼────────────┼────────┼──────────┼──────────');
for (const [key, r] of Object.entries(results)) {
  const name = r.tier.name.padEnd(14);
  const net = ('$' + (r.avg.netProfit >= 0 ? '+' : '') + r.avg.netProfit.toFixed(0)).padStart(10);
  const ret = ((r.avg.netProfit / INITIAL * 100).toFixed(1) + '%').padStart(6);
  const wr = r.tier.canTrade ? (r.winRate.toFixed(0) + '%').padStart(8) : '    N/A ';
  const prof = r.tier.canTrade ? ((r.profitableRuns / RUNS * 100).toFixed(0) + '%').padStart(8) : '    N/A ';
  console.log(`  ${name} │ ${net} │ ${ret} │ ${wr} │ ${prof}`);
}
console.log('═'.repeat(70) + '\n');
