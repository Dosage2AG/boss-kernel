/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. EDGE CALCULATOR — Your Information Advantage

   For prediction markets: you only trade when YOU know something
   the market doesn't. This module quantifies that gap.

   CORE CONCEPT:
   Market price IS a probability. If Polymarket prices a bet at 0.49,
   the crowd thinks it has a 49% chance. If your AI cluster says 65%,
   you have a 16% edge. That's worth trading.

   FORMULAS:
   edge        = p_model - p_market
   EV          = p_model * (1 - p_market) / p_market - (1 - p_model)
   mispricing  = (p_model - p_market) / stdDev   [Z-score]
   min_edge    = 0.04  (4% — below this, don't trade)

   WEIGHTED AI CONSENSUS (inspired by ryanfrigo/kalshi-ai-trading-bot):
   Claude Sonnet:  20% weight — news analyst
   GPT-4o-mini:    20% weight — bull case advocate
   Gemini Flash:   15% weight — bear case advocate
   B.O.S.S.:       30% weight — warmth/resonance (your proprietary edge)
   Polymarket:     15% weight — crowd wisdom cross-reference
   ══════════════════════════════════════════════════════════════════ */

// AI weight configuration — tune based on calibration performance
const AI_WEIGHTS = {
  boss:       0.30,   // B.O.S.S. resonance field (proprietary)
  claude:     0.20,   // Claude Sonnet — news analyst
  gpt:        0.20,   // GPT-4o-mini — bull advocate
  gemini:     0.15,   // Gemini Flash — bear advocate
  crowd:      0.15,   // Polymarket crowd (cross-reference)
};

class EdgeCalculator {
  constructor(clog) {
    this.clog = clog || console.log;
    this.weights = { ...AI_WEIGHTS };
    this.minEdge = 0.04;           // 4% minimum edge
    this.stdDevWindow = 50;        // trades to compute std dev from
    this.historicalEdges = [];     // for computing std dev
  }

  setWeights(weights) {
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    if (Math.abs(total - 1.0) > 0.01) {
      this.clog(`⚠️ Edge weights sum to ${total.toFixed(2)}, not 1.0 — normalizing`, 'log-err');
      for (const k of Object.keys(weights)) {
        weights[k] = weights[k] / total;
      }
    }
    this.weights = { ...weights };
  }

  // ── Weighted Probability from Multiple Sources ─────────────────
  // inputs: { boss, claude, gpt, gemini, crowd } — each 0-1 probability
  weightedProbability(inputs) {
    let total = 0;
    let weightSum = 0;

    for (const [source, weight] of Object.entries(this.weights)) {
      if (inputs[source] !== undefined && inputs[source] !== null) {
        total += inputs[source] * weight;
        weightSum += weight;
      }
    }

    if (weightSum === 0) return null;
    return total / weightSum; // normalize for missing sources
  }

  // ── Consensus Confidence ───────────────────────────────────────
  // How much do the sources agree? Low agreement = lower confidence.
  consensusConfidence(inputs) {
    const values = Object.keys(this.weights)
      .filter(k => inputs[k] !== undefined && inputs[k] !== null)
      .map(k => inputs[k]);

    if (values.length < 2) return 0.5;

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Low std dev = high agreement = high confidence
    // stdDev 0 = 1.0 confidence, stdDev 0.2 = ~0.5 confidence
    return Math.max(0, 1 - stdDev * 5);
  }

  // ── Direction Agreement ────────────────────────────────────────
  // Are all sources pointing the same way (above/below 0.5)?
  directionAgreement(inputs, threshold = 0.5) {
    const values = Object.keys(this.weights)
      .filter(k => inputs[k] !== undefined && inputs[k] !== null)
      .map(k => inputs[k]);

    if (values.length === 0) return { agreement: 0, direction: 'HOLD' };

    const bullVotes = values.filter(v => v > threshold).length;
    const bearVotes = values.filter(v => v <= threshold).length;
    const total = values.length;

    if (bullVotes > bearVotes) {
      return { agreement: bullVotes / total, direction: 'BULL' };
    } else if (bearVotes > bullVotes) {
      return { agreement: bearVotes / total, direction: 'BEAR' };
    } else {
      return { agreement: 0.5, direction: 'HOLD' };
    }
  }

  // ── Standard Deviation of Historical Edges ─────────────────────
  historicalStdDev() {
    const edges = this.historicalEdges.slice(-this.stdDevWindow);
    if (edges.length < 5) return 0.1; // default
    const mean = edges.reduce((s, e) => s + e, 0) / edges.length;
    const variance = edges.reduce((s, e) => s + Math.pow(e - mean, 2), 0) / edges.length;
    return Math.sqrt(variance) || 0.1;
  }

  // ── Main Edge Computation ──────────────────────────────────────
  compute(opts) {
    const {
      p_market,       // market price (0-1), from Polymarket/Kalshi
      aiVotes,        // { boss, claude, gpt, gemini, crowd } — each 0-1
      symbol,
      marketType,     // 'prediction' | 'crypto'
    } = opts;

    const p_model = this.weightedProbability(aiVotes);
    if (p_model === null) {
      return { tradeable: false, reason: 'Insufficient AI inputs' };
    }

    const tradeEdge = p_model - p_market;
    const absEdge = Math.abs(tradeEdge);
    const stdDev = this.historicalStdDev();
    const mispricing = stdDev > 0 ? tradeEdge / stdDev : 0;

    // EV for prediction market: buy YES at p_market, wins $1
    const ev = p_model * (1 - p_market) - (1 - p_model) * p_market;

    const confidence = this.consensusConfidence(aiVotes);
    const { agreement, direction } = this.directionAgreement(aiVotes);

    // Track for std dev computation
    this.historicalEdges.push(absEdge);
    if (this.historicalEdges.length > 200) this.historicalEdges.shift();

    // ── Decision ─────────────────────────────────────────────────
    const tradeable = (
      absEdge >= this.minEdge &&
      ev > 0 &&
      confidence > 0.4 &&
      agreement >= 0.5
    );

    const signal = tradeEdge > 0 ? 'LONG_YES' : 'LONG_NO';

    const result = {
      symbol,
      p_model: parseFloat(p_model.toFixed(4)),
      p_market: parseFloat(p_market.toFixed(4)),
      edge: parseFloat(tradeEdge.toFixed(4)),
      absEdge: parseFloat(absEdge.toFixed(4)),
      ev: parseFloat(ev.toFixed(4)),
      mispricing: parseFloat(mispricing.toFixed(2)),
      confidence: parseFloat(confidence.toFixed(3)),
      agreement: parseFloat(agreement.toFixed(3)),
      direction,
      signal: tradeable ? signal : 'HOLD',
      tradeable,
      reason: tradeable
        ? `edge=${(tradeEdge*100).toFixed(1)}% conf=${(confidence*100).toFixed(0)}% agree=${(agreement*100).toFixed(0)}%`
        : `edge=${(absEdge*100).toFixed(1)}% (min ${(this.minEdge*100).toFixed(0)}%) conf=${(confidence*100).toFixed(0)}% ev=${ev.toFixed(3)}`
    };

    const emoji = tradeable ? '🎯' : '⚪';
    this.clog(
      `${emoji} EDGE ${symbol}: model=${(p_model*100).toFixed(0)}% market=${(p_market*100).toFixed(0)}% edge=${(tradeEdge*100).toFixed(1)}% EV=${ev.toFixed(3)} → ${result.signal}`,
      tradeable ? 'log-pulse' : 'log-sys'
    );

    return result;
  }

  // ── Convert B.O.S.S. Warmth to Probability ────────────────────
  // Warmth is in arbitrary units (0-10+). Convert to 0-1 probability.
  warmthToProbability(warmth, direction = 'BULL') {
    // Sigmoid: maps warmth [0, 10] → probability [0.5, 0.95]
    const sigmoid = 1 / (1 + Math.exp(-0.5 * (warmth - 3)));
    return direction === 'BULL' ? sigmoid : 1 - sigmoid;
  }

  // ── Convert AI Consensus to Probability ───────────────────────
  // Takes AIConsensusEngine output and converts to p_model
  consensusToProbability(consensus) {
    if (!consensus || consensus.action === 'GRIEF') return 0.5;

    const { action, confidence, agreement } = consensus;
    // Base probability from confidence (1-10 scale → 0-1)
    const baseProbability = (confidence / 10) * agreement;

    if (action === 'LONG') return 0.5 + baseProbability * 0.5;
    if (action === 'SHORT') return 0.5 - baseProbability * 0.5;
    return 0.5;
  }
}

if (typeof module !== 'undefined') module.exports = { EdgeCalculator, AI_WEIGHTS };
