/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. KELLY CRITERION ENGINE

   Replaces fixed % position sizing with mathematically optimal
   Kelly Criterion. Fractional Kelly (0.25x default) prevents ruin.

   FORMULAS:
   f* = (p * b - q) / b          Full Kelly fraction
   f_use = f* * kellyFraction    Fractional Kelly (safer)
   EV = p * b - (1 - p)         Expected value of trade
   VaR = positionSize * stopPct  Value at Risk

   Source: PDF "AI-Powered Prediction Market Trading Bot" + Kelly 1956
   ══════════════════════════════════════════════════════════════════ */

class KellyEngine {
  constructor(clog) {
    this.clog = clog || console.log;

    // Conservative defaults — change via configure()
    this.kellyFraction = 0.25;      // Quarter-Kelly (reduces variance)
    this.maxPositionPct = 0.10;     // Hard cap: never more than 10% on one trade
    this.minEdge = 0.04;            // Minimum edge (4%) to consider a trade
    this.maxDailyVaR = 0.08;        // Block new trades if drawdown > 8%
    this.maxConcurrent = 15;        // Max 15 open positions at once
    this.dailyAICostCap = 50.00;    // $50/day max AI API spend
  }

  configure(opts = {}) {
    if (opts.kellyFraction !== undefined) this.kellyFraction = opts.kellyFraction;
    if (opts.maxPositionPct !== undefined) this.maxPositionPct = opts.maxPositionPct;
    if (opts.minEdge !== undefined) this.minEdge = opts.minEdge;
    if (opts.maxDailyVaR !== undefined) this.maxDailyVaR = opts.maxDailyVaR;
    if (opts.maxConcurrent !== undefined) this.maxConcurrent = opts.maxConcurrent;
    if (opts.dailyAICostCap !== undefined) this.dailyAICostCap = opts.dailyAICostCap;
  }

  // ── Core Kelly Calculation ─────────────────────────────────────
  // p: win probability (0-1), b: net odds (e.g. 1.0 = 2:1 payout)
  fullKelly(p, b) {
    if (b <= 0 || p <= 0 || p >= 1) return 0;
    const q = 1 - p;
    return (p * b - q) / b;
  }

  fractionalKelly(p, b) {
    return this.fullKelly(p, b) * this.kellyFraction;
  }

  // ── Expected Value ─────────────────────────────────────────────
  // b = net odds (profit if win / amount risked)
  expectedValue(p, b) {
    return p * b - (1 - p);
  }

  // ── Market Edge (Prediction Market specific) ───────────────────
  // p_model: your estimated probability
  // p_market: what the market is pricing (0-1)
  edge(p_model, p_market) {
    return p_model - p_market;
  }

  // ── Mispricing Z-Score ─────────────────────────────────────────
  // stdDev: historical std dev of model accuracy
  mispricingScore(p_model, p_market, stdDev = 0.1) {
    if (stdDev <= 0) return 0;
    return (p_model - p_market) / stdDev;
  }

  // ── Size a Position ────────────────────────────────────────────
  // Returns { size, fraction, ev, edge, reason, approved }
  sizePosition(opts) {
    const {
      bankroll,         // total available capital
      p_model,          // your probability estimate (0-1)
      p_market,         // market price (0-1)
      stopLossPct,      // how much you lose if wrong (e.g. 0.05)
      currentDrawdown,  // current drawdown from peak (0-1)
      openPositions,    // number of currently open positions
      dailyAICost,      // today's AI API spend so far
    } = opts;

    // b = net odds. If you lose stopLossPct when wrong,
    // your reward needs to be at least that to break even.
    // For prediction markets: contracts pay $1. You buy at p_market.
    // Net odds = (1 - p_market) / p_market
    const b = (1 - p_market) / p_market;

    const tradeEdge = this.edge(p_model, p_market);
    const ev = this.expectedValue(p_model, b);
    const mispricing = this.mispricingScore(p_model, p_market);

    // ── Risk Gate: must pass ALL checks ───────────────────────────
    const checks = [];

    if (tradeEdge < this.minEdge) {
      checks.push(`edge ${(tradeEdge*100).toFixed(1)}% below minimum ${(this.minEdge*100)}%`);
    }

    if (ev <= 0) {
      checks.push(`negative EV: ${ev.toFixed(3)}`);
    }

    if (currentDrawdown >= this.maxDailyVaR) {
      checks.push(`drawdown ${(currentDrawdown*100).toFixed(1)}% exceeds max ${(this.maxDailyVaR*100)}%`);
    }

    if (openPositions >= this.maxConcurrent) {
      checks.push(`open positions ${openPositions} at max ${this.maxConcurrent}`);
    }

    if ((dailyAICost || 0) >= this.dailyAICostCap) {
      checks.push(`AI cost $${dailyAICost.toFixed(2)} at daily cap $${this.dailyAICostCap}`);
    }

    if (checks.length > 0) {
      return {
        approved: false,
        size: 0,
        fraction: 0,
        ev,
        edge: tradeEdge,
        mispricing,
        reason: `BLOCKED: ${checks.join('; ')}`
      };
    }

    // ── Kelly Size ─────────────────────────────────────────────────
    let fraction = this.fractionalKelly(p_model, b);

    // Hard cap
    fraction = Math.min(fraction, this.maxPositionPct);

    // Never negative
    fraction = Math.max(fraction, 0);

    const size = bankroll * fraction;

    // ── VaR check ─────────────────────────────────────────────────
    const var95 = size * (stopLossPct || 0.05);

    this.clog(
      `📐 Kelly: edge=${(tradeEdge*100).toFixed(1)}% EV=${ev.toFixed(3)} f=${(fraction*100).toFixed(1)}% size=${size.toFixed(2)} VaR=${var95.toFixed(2)}`,
      'log-bond'
    );

    return {
      approved: true,
      size,
      fraction,
      ev,
      edge: tradeEdge,
      mispricing,
      var95,
      reason: `Kelly(${(this.kellyFraction*100).toFixed(0)}%): f=${(fraction*100).toFixed(1)}% edge=${(tradeEdge*100).toFixed(1)}% EV=${ev.toFixed(3)}`
    };
  }

  // ── Batch: rank multiple opportunities ────────────────────────
  rankOpportunities(opportunities, bankroll, context = {}) {
    return opportunities
      .map(opp => ({
        ...opp,
        sizing: this.sizePosition({
          bankroll,
          p_model: opp.p_model,
          p_market: opp.p_market,
          stopLossPct: opp.stopLossPct || 0.05,
          ...context
        })
      }))
      .filter(o => o.sizing.approved)
      .sort((a, b) => b.sizing.ev - a.sizing.ev); // highest EV first
  }
}

if (typeof module !== 'undefined') module.exports = { KellyEngine };
