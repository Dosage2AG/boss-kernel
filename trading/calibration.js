/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. CALIBRATION ENGINE — Are Your Predictions Any Good?

   Tracks every AI prediction vs actual outcome.
   If you say 70% and you're right 70% of the time: perfect.
   If you say 70% and you're right 40% of the time: disaster.

   METRICS TRACKED:
   - Brier Score: (predicted - outcome)^2. Target < 0.25.
   - Win Rate: target 60%+
   - Sharpe Ratio: risk-adjusted return. Target > 2.0
   - Profit Factor: gross profit / gross loss. Target > 1.5
   - Max Drawdown: largest peak-to-trough. Block if > 8%.
   - Calibration curve: bucket predictions by decile.

   All data persists to calibration_log.json in the trading folder.
   ══════════════════════════════════════════════════════════════════ */

const fs = (typeof require !== 'undefined') ? require('fs') : null;
const path = (typeof require !== 'undefined') ? require('path') : null;

class CalibrationEngine {
  constructor(clog, logPath) {
    this.clog = clog || console.log;
    this.logPath = logPath || './calibration_log.json';

    // In-memory store
    this.predictions = [];   // { id, symbol, p_model, p_market, edge, timestamp }
    this.outcomes = {};      // { id: { outcome: 0|1, pnl, closedAt } }
    this.tradeLog = [];      // completed trade records for Sharpe/drawdown

    this._load();
  }

  // ── Persist & Load ─────────────────────────────────────────────
  _load() {
    if (!fs) return;
    try {
      if (fs.existsSync(this.logPath)) {
        const data = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
        this.predictions = data.predictions || [];
        this.outcomes = data.outcomes || {};
        this.tradeLog = data.tradeLog || [];
        this.clog(`📊 Calibration: loaded ${this.predictions.length} predictions, ${this.tradeLog.length} trades`, 'log-bond');
      }
    } catch(e) {
      this.clog(`📊 Calibration load error: ${e.message}`, 'log-err');
    }
  }

  _save() {
    if (!fs) return;
    try {
      fs.writeFileSync(this.logPath, JSON.stringify({
        predictions: this.predictions,
        outcomes: this.outcomes,
        tradeLog: this.tradeLog,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch(e) {
      this.clog(`📊 Calibration save error: ${e.message}`, 'log-err');
    }
  }

  // ── Record a Prediction (before trade) ────────────────────────
  recordPrediction(id, symbol, p_model, p_market, edge, aiDetails = {}) {
    const record = {
      id,
      symbol,
      p_model,
      p_market,
      edge,
      timestamp: Date.now(),
      aiDetails  // { claude, gpt, gemini votes and confidences }
    };
    this.predictions.push(record);
    this._save();
    return record;
  }

  // ── Record Outcome (after trade closes) ───────────────────────
  // outcome: 1 = correct (win), 0 = incorrect (loss)
  recordOutcome(id, outcome, pnl, closedAt = Date.now()) {
    this.outcomes[id] = { outcome, pnl, closedAt };

    this.tradeLog.push({
      id,
      pnl,
      closedAt,
      outcome
    });

    this._save();

    // Log Brier contribution
    const pred = this.predictions.find(p => p.id === id);
    if (pred) {
      const brierContrib = Math.pow(pred.p_model - outcome, 2);
      this.clog(
        `📊 Outcome ${id}: ${outcome ? 'WIN' : 'LOSS'} PnL=${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} Brier=${brierContrib.toFixed(3)}`,
        outcome ? 'log-win' : 'log-grief'
      );
    }
  }

  // ── Brier Score ────────────────────────────────────────────────
  // Lower = better. Well-calibrated: < 0.25. Random guessing: 0.25.
  brierScore() {
    const resolved = this.predictions.filter(p => this.outcomes[p.id] !== undefined);
    if (resolved.length === 0) return null;

    const sum = resolved.reduce((acc, p) => {
      const outcome = this.outcomes[p.id].outcome;
      return acc + Math.pow(p.p_model - outcome, 2);
    }, 0);

    return sum / resolved.length;
  }

  // ── Win Rate ───────────────────────────────────────────────────
  winRate() {
    const closed = this.tradeLog;
    if (closed.length === 0) return null;
    const wins = closed.filter(t => t.pnl > 0).length;
    return wins / closed.length;
  }

  // ── Sharpe Ratio ───────────────────────────────────────────────
  // Annualized. Target > 2.0.
  sharpeRatio() {
    if (this.tradeLog.length < 5) return null;
    const returns = this.tradeLog.map(t => t.pnl);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return null;
    // Annualize: assume ~252 trading days
    return (mean / stdDev) * Math.sqrt(252);
  }

  // ── Profit Factor ─────────────────────────────────────────────
  // Gross profit / Gross loss. Target > 1.5.
  profitFactor() {
    const grossProfit = this.tradeLog.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(this.tradeLog.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    if (grossLoss === 0) return grossProfit > 0 ? Infinity : null;
    return grossProfit / grossLoss;
  }

  // ── Max Drawdown ───────────────────────────────────────────────
  maxDrawdown() {
    if (this.tradeLog.length === 0) return 0;
    let peak = 0;
    let cumulative = 0;
    let maxDD = 0;

    for (const trade of this.tradeLog) {
      cumulative += trade.pnl;
      if (cumulative > peak) peak = cumulative;
      const dd = peak > 0 ? (peak - cumulative) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    return maxDD;
  }

  // ── Calibration Curve ─────────────────────────────────────────
  // Groups predictions into decile buckets, shows predicted vs actual
  calibrationCurve() {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i*10}-${(i+1)*10}%`,
      count: 0,
      wins: 0,
      avgPredicted: 0
    }));

    const resolved = this.predictions.filter(p => this.outcomes[p.id] !== undefined);

    for (const pred of resolved) {
      const bucketIdx = Math.min(Math.floor(pred.p_model * 10), 9);
      const bucket = buckets[bucketIdx];
      bucket.count++;
      bucket.avgPredicted += pred.p_model;
      if (this.outcomes[pred.id].outcome === 1) bucket.wins++;
    }

    return buckets.map(b => ({
      range: b.range,
      count: b.count,
      predicted: b.count > 0 ? b.avgPredicted / b.count : 0,
      actual: b.count > 0 ? b.wins / b.count : 0,
      calibrationError: b.count > 0 ? Math.abs(b.avgPredicted / b.count - b.wins / b.count) : 0
    }));
  }

  // ── Full Report ────────────────────────────────────────────────
  report() {
    const bs = this.brierScore();
    const wr = this.winRate();
    const sr = this.sharpeRatio();
    const pf = this.profitFactor();
    const dd = this.maxDrawdown();

    const resolved = this.predictions.filter(p => this.outcomes[p.id] !== undefined).length;

    const report = {
      totalPredictions: this.predictions.length,
      resolvedPredictions: resolved,
      totalTrades: this.tradeLog.length,
      brierScore: bs !== null ? bs.toFixed(4) : 'insufficient data',
      brierRating: bs === null ? 'N/A' : bs < 0.1 ? '🟢 EXCELLENT' : bs < 0.2 ? '🟡 GOOD' : bs < 0.25 ? '🟠 FAIR' : '🔴 POOR',
      winRate: wr !== null ? `${(wr*100).toFixed(1)}%` : 'N/A',
      winRateRating: wr === null ? 'N/A' : wr >= 0.6 ? '🟢' : wr >= 0.5 ? '🟡' : '🔴',
      sharpeRatio: sr !== null ? sr.toFixed(2) : 'N/A',
      sharpeRating: sr === null ? 'N/A' : sr >= 2.0 ? '🟢' : sr >= 1.0 ? '🟡' : '🔴',
      profitFactor: pf !== null ? (pf === Infinity ? '∞' : pf.toFixed(2)) : 'N/A',
      maxDrawdown: `${(dd*100).toFixed(1)}%`,
      drawdownRating: dd >= 0.08 ? '🔴 BLOCK TRADING' : dd >= 0.05 ? '🟠 WARNING' : '🟢 OK',
      isDrawdownBlocked: dd >= 0.08
    };

    this.clog(`📊 CALIBRATION REPORT:
  Brier: ${report.brierScore} ${report.brierRating}
  Win Rate: ${report.winRate} ${report.winRateRating}
  Sharpe: ${report.sharpeRatio} ${report.sharpeRating}
  Profit Factor: ${report.profitFactor}
  Max Drawdown: ${report.maxDrawdown} ${report.drawdownRating}`, 'log-bond');

    return report;
  }

  // ── Drawdown Block Check ───────────────────────────────────────
  isDrawdownBlocked() {
    return this.maxDrawdown() >= this.maxDailyVaR;
  }
}

if (typeof module !== 'undefined') module.exports = { CalibrationEngine };
