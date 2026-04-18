/* ══════════════════════════════════════════════════════════════════════
   B.O.S.S. TRADING STRATEGIES — Metabolic Presets
   
   Each strategy is a different "body type" for the trading engine.
   Scalper = hummingbird (fast metabolism, many small meals)
   Swing = wolf (patient, bigger kills)
   Position = bear (hibernates, massive when it moves)
   Grief Hunter = vulture (waits for chaos, feeds on resolution)
   ══════════════════════════════════════════════════════════════════════ */

const STRATEGIES = {

  scalp: {
    name: '⚡ SCALPER (Hummingbird)',
    description: 'Fast metabolism. Many small trades. Catches 0.5-2% moves.',
    maxPositionPct: 0.15,
    maxTotalExposure: 0.80,
    stopLossPct: 0.015,        // 1.5% tight stop
    takeProfitPct: 0.025,      // 2.5% quick profit
    dailyLossLimit: 0.08,
    minWarmth: 0.02,           // fires on tiny signals
    maxTradesPerHour: 30,
    minTimeBetweenTrades: 15000, // 15 seconds
    griefCooldown: 60000,      // 1 min grief (quick recovery)
    warmthDecayExit: 0.01,     // exit fast when signal cools
    buyBearish: false,
    trailingStop: false,
  },

  swing: {
    name: '🐺 SWING (Wolf)',
    description: 'Patient hunter. Waits for 2-5% momentum, holds for bigger gains.',
    maxPositionPct: 0.20,
    maxTotalExposure: 0.60,
    stopLossPct: 0.05,
    takeProfitPct: 0.10,
    dailyLossLimit: 0.10,
    minWarmth: 0.15,
    maxTradesPerHour: 6,
    minTimeBetweenTrades: 60000,
    griefCooldown: 300000,
    warmthDecayExit: 0.3,
    buyBearish: false,
    trailingStop: false,
  },

  position: {
    name: '🐻 POSITION (Bear)',
    description: 'Hibernates until massive signal. Few trades, big wins.',
    maxPositionPct: 0.30,
    maxTotalExposure: 0.50,
    stopLossPct: 0.10,
    takeProfitPct: 0.30,
    dailyLossLimit: 0.15,
    minWarmth: 0.5,
    maxTradesPerHour: 2,
    minTimeBetweenTrades: 300000,
    griefCooldown: 600000,
    warmthDecayExit: 0.5,
    buyBearish: false,
    trailingStop: true,
  },

  griefHunter: {
    name: '🦅 GRIEF HUNTER (Vulture)',
    description: 'Waits for market contradictions. Enters after grief resolves.',
    maxPositionPct: 0.25,
    maxTotalExposure: 0.50,
    stopLossPct: 0.03,
    takeProfitPct: 0.08,
    dailyLossLimit: 0.10,
    minWarmth: 0.05,
    maxTradesPerHour: 10,
    minTimeBetweenTrades: 30000,
    griefCooldown: 30000,       // short grief — gets back in fast
    warmthDecayExit: 0.2,
    buyBearish: true,           // buys reversals after bear grief
    trailingStop: false,
    griefEntryMode: true,       // ONLY enters after grief resolves
  },

  degen: {
    name: '🎰 DEGEN (Moth to Flame)',
    description: 'Maximum aggression. High risk, high reward. Not recommended.',
    maxPositionPct: 0.40,
    maxTotalExposure: 0.90,
    stopLossPct: 0.03,
    takeProfitPct: 0.05,
    dailyLossLimit: 0.25,
    minWarmth: 0.01,
    maxTradesPerHour: 60,
    minTimeBetweenTrades: 10000,
    griefCooldown: 15000,
    warmthDecayExit: 0.005,
    buyBearish: true,
    trailingStop: false,
  }
};

if (typeof module !== 'undefined') module.exports = { STRATEGIES };
