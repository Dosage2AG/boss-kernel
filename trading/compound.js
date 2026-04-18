/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. COMPOUND ENGINE — The System That Learns

   After every loss, a post-mortem runs automatically.
   Classifies what went wrong. Saves the lesson.
   Future scans read past failures before trading.

   "A prediction market bot that doesn't learn is just gambling." — PDF

   FAILURE CLASSES:
   1. BAD_PREDICTION  — model probability was wrong
   2. BAD_TIMING      — right direction, wrong time
   3. BAD_EXECUTION   — good signal, bad fill / slippage
   4. EXTERNAL_SHOCK  — unforeseeable news / event
   5. GRIEF_SPIRAL    — traded during active grief protocol

   NIGHTLY JOB: consolidates all lessons, prunes stale ones,
   generates a "forbidden patterns" list that the scanner reads.
   ══════════════════════════════════════════════════════════════════ */

const fs = (typeof require !== 'undefined') ? require('fs') : null;

const FAILURE_CLASSES = {
  BAD_PREDICTION:  'bad_prediction',
  BAD_TIMING:      'bad_timing',
  BAD_EXECUTION:   'bad_execution',
  EXTERNAL_SHOCK:  'external_shock',
  GRIEF_SPIRAL:    'grief_spiral',
};

class CompoundEngine {
  constructor(clog, opts = {}) {
    this.clog = clog || console.log;
    this.logPath = opts.logPath || './failure_log.json';
    this.knowledgePath = opts.knowledgePath || './knowledge_base.json';

    this.failureLog = [];
    this.lessons = [];
    this.forbiddenPatterns = [];

    this._load();
  }

  // ── Persist & Load ─────────────────────────────────────────────
  _load() {
    if (!fs) return;
    try {
      if (fs.existsSync(this.logPath)) {
        const data = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
        this.failureLog = data.failureLog || [];
        this.lessons = data.lessons || [];
        this.clog(`🧠 Compound: loaded ${this.failureLog.length} failures, ${this.lessons.length} lessons`, 'log-bond');
      }
      if (fs.existsSync(this.knowledgePath)) {
        const kb = JSON.parse(fs.readFileSync(this.knowledgePath, 'utf8'));
        this.forbiddenPatterns = kb.forbiddenPatterns || [];
      }
    } catch(e) {
      this.clog(`🧠 Compound load error: ${e.message}`, 'log-err');
    }
  }

  _save() {
    if (!fs) return;
    try {
      fs.writeFileSync(this.logPath, JSON.stringify({
        failureLog: this.failureLog,
        lessons: this.lessons,
        lastUpdated: new Date().toISOString()
      }, null, 2));

      fs.writeFileSync(this.knowledgePath, JSON.stringify({
        forbiddenPatterns: this.forbiddenPatterns,
        lastConsolidated: new Date().toISOString()
      }, null, 2));
    } catch(e) {
      this.clog(`🧠 Compound save error: ${e.message}`, 'log-err');
    }
  }

  // ── Classify a Failed Trade ────────────────────────────────────
  classify(trade, marketContext = {}) {
    const {
      pnl,
      pnlPct,
      entryPrice,
      exitPrice,
      reason,         // stop_loss | take_profit | warmth_decay | grief_protocol
      duration,       // ms in trade
      p_model,        // our probability estimate
      p_market,       // market price at entry
      aiAgreement,    // 0-1 how much AIs agreed
      wasGrief,       // were we in grief protocol?
      slippage,       // price slip between signal and fill
    } = trade;

    // Auto-classify based on available signals
    let failureClass = FAILURE_CLASSES.BAD_PREDICTION;
    let confidence = 0.5;
    let details = '';

    if (reason === 'grief_protocol' || wasGrief) {
      failureClass = FAILURE_CLASSES.GRIEF_SPIRAL;
      confidence = 0.9;
      details = 'Trade executed during or immediately after grief protocol';
    } else if (slippage && Math.abs(slippage) > 0.02) {
      failureClass = FAILURE_CLASSES.BAD_EXECUTION;
      confidence = 0.8;
      details = `Slippage ${(slippage*100).toFixed(1)}% exceeded 2% abort threshold`;
    } else if (p_model && p_market) {
      const edge = p_model - p_market;
      if (edge > 0.10 && pnl < 0) {
        // High edge but still lost — timing or shock
        if (duration && duration < 60000) {
          failureClass = FAILURE_CLASSES.BAD_TIMING;
          confidence = 0.7;
          details = `High edge (${(edge*100).toFixed(0)}%) but exited in <1min — premature`;
        } else {
          failureClass = FAILURE_CLASSES.EXTERNAL_SHOCK;
          confidence = 0.6;
          details = `Edge was strong (${(edge*100).toFixed(0)}%) but outcome reversed — likely external event`;
        }
      } else if (edge < 0.04 && pnl < 0) {
        failureClass = FAILURE_CLASSES.BAD_PREDICTION;
        confidence = 0.85;
        details = `Edge (${(edge*100).toFixed(0)}%) was below 4% minimum — should not have traded`;
      }
    }

    if (aiAgreement !== undefined && aiAgreement < 0.5 && pnl < 0) {
      failureClass = FAILURE_CLASSES.BAD_PREDICTION;
      confidence = Math.max(confidence, 0.75);
      details += ` AI consensus was weak (${(aiAgreement*100).toFixed(0)}% agreement)`;
    }

    return { failureClass, confidence, details };
  }

  // ── Run Post-Mortem After a Loss ───────────────────────────────
  postMortem(trade, marketContext = {}) {
    if (trade.pnl >= 0) return null; // only for losses

    const { failureClass, confidence, details } = this.classify(trade, marketContext);

    const failure = {
      id: `FAIL_${Date.now()}`,
      timestamp: Date.now(),
      date: new Date().toISOString(),
      symbol: trade.symbol,
      pnl: trade.pnl,
      pnlPct: trade.pnlPct,
      failureClass,
      confidence,
      details,
      trade: {
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        reason: trade.reason,
        duration: trade.duration,
        p_model: trade.p_model,
        p_market: trade.p_market,
        aiAgreement: trade.aiAgreement,
      },
      lesson: this._generateLesson(failureClass, trade, details),
    };

    this.failureLog.push(failure);

    this.clog(
      `🧠 POST-MORTEM: ${trade.symbol} ${failureClass.toUpperCase()} — "${failure.lesson}"`,
      'log-grief'
    );

    // Add to forbidden patterns if high confidence
    if (confidence >= 0.75) {
      this._addForbiddenPattern(failure);
    }

    this._save();
    return failure;
  }

  // ── Generate Human-Readable Lesson ────────────────────────────
  _generateLesson(failureClass, trade, details) {
    const templates = {
      [FAILURE_CLASSES.BAD_PREDICTION]: [
        `Do not trade ${trade.symbol} when AI agreement is below 60%`,
        `Model overestimated ${trade.symbol} probability — widen uncertainty bands`,
        `${trade.symbol} edge was insufficient at entry — enforce 4% minimum strictly`,
      ],
      [FAILURE_CLASSES.BAD_TIMING]: [
        `${trade.symbol}: correct direction but entered too early — wait for confirmation`,
        `${trade.symbol}: signal fired before momentum confirmed — add volume filter`,
      ],
      [FAILURE_CLASSES.BAD_EXECUTION]: [
        `${trade.symbol}: slippage exceeded threshold — use limit orders only`,
        `${trade.symbol}: fill quality was poor — check liquidity before trading`,
      ],
      [FAILURE_CLASSES.EXTERNAL_SHOCK]: [
        `${trade.symbol}: external event invalidated signal — not preventable, log only`,
        `${trade.symbol}: news-driven reversal — scan headlines before entry`,
      ],
      [FAILURE_CLASSES.GRIEF_SPIRAL]: [
        `Never trade during grief protocol — enforce the cooldown unconditionally`,
        `${trade.symbol}: traded while field was contradicting — grief cooldown was bypassed`,
      ],
    };

    const options = templates[failureClass] || [`Learn from ${trade.symbol} loss — review parameters`];
    return options[Math.floor(Math.random() * options.length)];
  }

  // ── Add Forbidden Pattern ──────────────────────────────────────
  _addForbiddenPattern(failure) {
    const pattern = {
      id: failure.id,
      symbol: failure.symbol,
      failureClass: failure.failureClass,
      pattern: failure.lesson,
      addedAt: Date.now(),
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
      severity: failure.confidence >= 0.9 ? 'HIGH' : 'MEDIUM',
    };

    // Don't duplicate
    const exists = this.forbiddenPatterns.some(p => p.symbol === failure.symbol && p.failureClass === failure.failureClass);
    if (!exists) {
      this.forbiddenPatterns.push(pattern);
    }
  }

  // ── Check if Symbol Has Forbidden Pattern ─────────────────────
  checkForbidden(symbol, failureClass = null) {
    const now = Date.now();
    const active = this.forbiddenPatterns.filter(p =>
      p.symbol === symbol &&
      p.expiresAt > now &&
      (failureClass ? p.failureClass === failureClass : true)
    );
    return { blocked: active.length > 0, patterns: active };
  }

  // ── Nightly Consolidation ──────────────────────────────────────
  consolidate() {
    const now = Date.now();

    // Prune expired forbidden patterns
    const before = this.forbiddenPatterns.length;
    this.forbiddenPatterns = this.forbiddenPatterns.filter(p => p.expiresAt > now);
    const pruned = before - this.forbiddenPatterns.length;

    // Find recurring failures (same class for same symbol, 3+ times)
    const symbolClass = {};
    for (const f of this.failureLog) {
      const key = `${f.symbol}:${f.failureClass}`;
      symbolClass[key] = (symbolClass[key] || 0) + 1;
    }

    let escalated = 0;
    for (const [key, count] of Object.entries(symbolClass)) {
      if (count >= 3) {
        const [symbol, failureClass] = key.split(':');
        const existing = this.forbiddenPatterns.find(p => p.symbol === symbol && p.failureClass === failureClass);
        if (existing) {
          // Extend ban for repeat offenders
          existing.expiresAt = now + (90 * 24 * 60 * 60 * 1000); // 90 days
          existing.severity = 'HIGH';
          escalated++;
        }
      }
    }

    // Generate summary lesson
    const recentFailures = this.failureLog.filter(f => f.timestamp > now - 86400000); // last 24h
    const classCounts = {};
    for (const f of recentFailures) {
      classCounts[f.failureClass] = (classCounts[f.failureClass] || 0) + 1;
    }

    const dominantClass = Object.entries(classCounts).sort((a, b) => b[1] - a[1])[0];

    this.clog(
      `🧠 NIGHTLY CONSOLIDATION: pruned ${pruned} patterns, escalated ${escalated}, dominant failure: ${dominantClass ? dominantClass[0] : 'none'}`,
      'log-bond'
    );

    this._save();

    return {
      pruned,
      escalated,
      activeForbiddenPatterns: this.forbiddenPatterns.length,
      dominantFailureClass: dominantClass ? dominantClass[0] : null,
      recentFailureCount: recentFailures.length,
    };
  }

  // ── Stats Summary ─────────────────────────────────────────────
  stats() {
    const classCounts = {};
    for (const f of this.failureLog) {
      classCounts[f.failureClass] = (classCounts[f.failureClass] || 0) + 1;
    }

    return {
      totalFailures: this.failureLog.length,
      byClass: classCounts,
      activeForbiddenPatterns: this.forbiddenPatterns.filter(p => p.expiresAt > Date.now()).length,
      recentLessons: this.failureLog.slice(-5).map(f => f.lesson),
    };
  }
}

if (typeof module !== 'undefined') module.exports = { CompoundEngine, FAILURE_CLASSES };
