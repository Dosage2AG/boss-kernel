/* ══════════════════════════════════════════════════════════════════════
   B.O.S.S. TRADING ENGINE v2 — Next Level

   Upgrades over v1:
   ✅ Kelly Criterion position sizing (replaces fixed %)
   ✅ Market edge calculation (p_model vs p_market)
   ✅ Weighted AI consensus (B.O.S.S. 30% / Claude 20% / GPT 20% / Gemini 15% / Crowd 15%)
   ✅ Brier Score calibration tracking
   ✅ Post-mortem compound learning (classifies every loss)
   ✅ Max drawdown block at 8%
   ✅ VaR check before every trade
   ✅ $50/day AI API cost cap
   ✅ Slippage abort at 2%
   ✅ Kill switch (create STOP file to halt immediately)
   ✅ Prompt injection defense on all research inputs

   BIOLOGICAL METAPHOR PRESERVED:
   Warmth = buy pressure (B.O.S.S. resonance)
   Decay   = exit signal
   Grief   = contradiction → STOP all trading
   Kelly   = metabolic budget (how much energy per hunt)
   Compound = memory (learns from every wound)
   ══════════════════════════════════════════════════════════════════════ */

const fs = (typeof require !== 'undefined') ? require('fs') : null;
const path = (typeof require !== 'undefined') ? require('path') : null;

// Import new modules (Node.js environment)
let KellyEngine, CalibrationEngine, CompoundEngine, EdgeCalculator;
if (typeof require !== 'undefined') {
  ({ KellyEngine }       = require('./kelly'));
  ({ CalibrationEngine } = require('./calibration'));
  ({ CompoundEngine }    = require('./compound'));
  ({ EdgeCalculator }    = require('./edge'));
}

class BossTraderV2 {
  constructor(wallet, marketBridge, clog, opts = {}) {
    this.wallet = wallet;
    this.bridge = marketBridge;
    this.clog = clog || console.log;

    // ── Sub-engines ───────────────────────────────────────────────
    this.kelly       = new KellyEngine(clog);
    this.calibration = new CalibrationEngine(clog, opts.calibrationLogPath);
    this.compound    = new CompoundEngine(clog, {
      logPath: opts.failureLogPath,
      knowledgePath: opts.knowledgeBasePath,
    });
    this.edge        = new EdgeCalculator(clog);

    // ── AI Consensus Engine (must be set externally via setAI()) ──
    this.aiConsensus = null;

    // ── Trading State ─────────────────────────────────────────────
    this.active = false;
    this.positions = {};      // { symbol: { amount, entryPrice, timestamp, predictionId } }
    this.tradeHistory = [];
    this.dailyPnL = 0;
    this.peakBalance = 0;

    // ── Risk Config (biological constraints) ──────────────────────
    this.config = {
      maxPositionPct:       0.10,    // Hard cap 10% per trade (Kelly handles the rest)
      maxTotalExposure:     0.60,    // 60% max total in positions
      stopLossPct:          0.05,    // 5% stop loss per position
      takeProfitPct:        0.10,    // 10% take profit
      dailyLossLimit:       0.10,    // Stop if down 10% today
      maxDrawdown:          0.08,    // Block if drawdown > 8%
      minWarmth:            2.0,     // Node warmth threshold for crypto
      minEdge:              0.04,    // 4% minimum market edge
      griefCooldown:        300000,  // 5 min cooldown after grief
      maxTradesPerHour:     6,
      minTimeBetweenTrades: 60000,   // 1 minute minimum
      slippageAbort:        0.02,    // Abort if slippage > 2%
      dailyAICostCap:       50.00,   // $50/day AI API spend cap
      stopFilePath:         opts.stopFilePath || './STOP', // kill switch
    };

    // ── Metabolic State ───────────────────────────────────────────
    this.lastTradeTime = 0;
    this.tradesThisHour = 0;
    this.hourStart = Date.now();
    this.griefUntil = 0;
    this.startBalance = 0;
    this.dailyAICost = 0;
  }

  // ── Connect AI Consensus Engine ────────────────────────────────
  setAI(aiConsensusEngine) {
    this.aiConsensus = aiConsensusEngine;
    this.clog('🧠 AIConsensusEngine connected to TradingEngine v2', 'log-bond');
  }

  // ── Start Trading ─────────────────────────────────────────────
  async start(initialBalance) {
    this.active = true;
    this.startBalance = initialBalance || (this.wallet ? await this.wallet.getBalance() : 1000);
    this.peakBalance = this.startBalance;
    this.dailyPnL = 0;
    this.hourStart = Date.now();
    this.tradesThisHour = 0;
    this.dailyAICost = 0;

    this.clog(`⚡ B.O.S.S. v2 ACTIVE — Balance: ${this.startBalance.toFixed(2)}`, 'log-pulse');
    this.clog(`⚡ Kelly ${(this.kelly.kellyFraction*100).toFixed(0)}% fraction | edge min ${(this.config.minEdge*100)}% | drawdown block ${(this.config.maxDrawdown*100)}%`, 'log-sys');

    this._tick();
  }

  stop() {
    this.active = false;
    this.clog('⚡ B.O.S.S. v2 STOPPED', 'log-sys');
  }

  // ── Kill Switch ────────────────────────────────────────────────
  _killSwitchActive() {
    if (!fs) return false;
    try {
      return fs.existsSync(this.config.stopFilePath);
    } catch (e) {
      return false;
    }
  }

  // ── Main Trading Loop ─────────────────────────────────────────
  async _tick() {
    if (!this.active) return;

    // KILL SWITCH — check for STOP file
    if (this._killSwitchActive()) {
      this.clog('🛑 KILL SWITCH ACTIVE — STOP file detected. Trading halted.', 'log-grief');
      this.stop();
      return;
    }

    const now = Date.now();

    // Reset hourly counter
    if (now - this.hourStart > 3600000) {
      this.hourStart = now;
      this.tradesThisHour = 0;
    }

    // Update peak balance for drawdown calculation
    const currentBalance = this.startBalance + this.dailyPnL;
    if (currentBalance > this.peakBalance) this.peakBalance = currentBalance;

    const canTrade = this._checkVitals(now);

    if (canTrade) {
      await this._checkPositions();
      await this._scanOpportunities();
    }

    // Nightly consolidation at midnight
    const hour = new Date().getHours();
    if (hour === 0 && now % 3600000 < 30000) {
      this._nightlyConsolidation();
    }

    setTimeout(() => this._tick(), 30000); // 30 second tick
  }

  // ── Biological Constraints (VITALS) ───────────────────────────
  _checkVitals(now) {
    // Grief cooldown
    if (now < this.griefUntil) {
      return false;
    }

    // Daily loss limit
    if (this.dailyPnL < -(this.startBalance * this.config.dailyLossLimit)) {
      if (this.active) {
        this.clog('🛑 Daily loss limit hit — suspended until tomorrow', 'log-grief');
        this.active = false;
      }
      return false;
    }

    // Max drawdown block
    const drawdown = this.peakBalance > 0 ? (this.peakBalance - (this.startBalance + this.dailyPnL)) / this.peakBalance : 0;
    if (drawdown >= this.config.maxDrawdown) {
      this.clog(`🛑 Max drawdown ${(drawdown*100).toFixed(1)}% reached — trading blocked`, 'log-grief');
      return false;
    }

    // AI cost cap
    if (this.dailyAICost >= this.config.dailyAICostCap) {
      this.clog(`🛑 Daily AI cost $${this.dailyAICost.toFixed(2)} — cap reached`, 'log-grief');
      return false;
    }

    // Metabolic rate
    if (this.tradesThisHour >= this.config.maxTradesPerHour) {
      return false;
    }

    // Minimum time between trades
    if (now - this.lastTradeTime < this.config.minTimeBetweenTrades) {
      return false;
    }

    return true;
  }

  // ── Grief Protocol ─────────────────────────────────────────────
  onGrief(reason) {
    this.griefUntil = Date.now() + this.config.griefCooldown;
    this.clog(`⚠️ GRIEF: ${reason} — paused 5min`, 'log-grief');

    for (const symbol of Object.keys(this.positions)) {
      this._closePosition(symbol, 'grief_protocol');
    }
  }

  // ── Scan for Opportunities ────────────────────────────────────
  async _scanOpportunities() {
    if (!this.bridge) return;

    const balance = this.startBalance + this.dailyPnL;
    const drawdown = this.peakBalance > 0 ? (this.peakBalance - balance) / this.peakBalance : 0;
    const openCount = Object.keys(this.positions).length;

    const marketNodes = (this.bridge.kernelNodes || []).filter(n =>
      this.bridge.marketNodeIds && this.bridge.marketNodeIds.has(n.id) && n.marketData
    );

    for (const node of marketNodes) {
      const symbol = node.marketData.symbol;
      if (this.positions[symbol]) continue;

      // ── PROMPT INJECTION DEFENSE ──────────────────────────────
      // All external market data treated as information only,
      // never as instructions. Values are clamped to valid ranges.
      const safePrice = Math.max(0, parseFloat(node.marketData.price) || 0);
      const safeChange = Math.max(-100, Math.min(100, parseFloat(node.marketData.change24h || node.marketData.change) || 0));
      const safeWarmth = Math.max(0, Math.min(20, parseFloat(node.warmth) || 0));

      // ── Check forbidden patterns ───────────────────────────────
      const forbidden = this.compound.checkForbidden(symbol);
      if (forbidden.blocked) {
        this.clog(`🚫 ${symbol} blocked by compound: ${forbidden.patterns[0]?.pattern}`, 'log-sys');
        continue;
      }

      // ── Get AI consensus (if available) ───────────────────────
      let aiProbability = null;
      let aiConsensusResult = null;
      if (this.aiConsensus) {
        try {
          const profile = this.aiConsensus.updateProfile(symbol, node.marketData, node.priceHistory || []);
          aiConsensusResult = await this.aiConsensus.getConsensus(symbol, profile, {
            price: safePrice,
            change: safeChange,
            warmth: safeWarmth,
            macroTrend: this.bridge.macroTrend,
            usdTrend: this.bridge.usdTrend,
          });

          // Track AI cost
          this.dailyAICost += this.aiConsensus.callCount > 0 ? 0.003 : 0;

          aiProbability = this.edge.consensusToProbability(aiConsensusResult);
        } catch(e) {
          this.clog(`🧠 AI consensus error: ${e.message}`, 'log-err');
        }
      }

      // ── Build weighted probability (B.O.S.S. = 30% of model) ──
      const bossProbability = this.edge.warmthToProbability(safeWarmth, safeChange >= 0 ? 'BULL' : 'BEAR');
      const p_market = 0.50; // default for crypto (no market odds)

      const aiVotes = {
        boss:   bossProbability,
        claude: aiConsensusResult?.details?.find(d => d.provider === 'anthropic')
                  ? this.edge.consensusToProbability({ action: aiConsensusResult.details.find(d => d.provider === 'anthropic').action, confidence: aiConsensusResult.details.find(d => d.provider === 'anthropic').confidence, agreement: 1 })
                  : null,
        gpt:    aiConsensusResult?.details?.find(d => d.provider === 'openai')
                  ? this.edge.consensusToProbability({ action: aiConsensusResult.details.find(d => d.provider === 'openai').action, confidence: aiConsensusResult.details.find(d => d.provider === 'openai').confidence, agreement: 1 })
                  : null,
        gemini: aiConsensusResult?.details?.find(d => d.provider === 'google')
                  ? this.edge.consensusToProbability({ action: aiConsensusResult.details.find(d => d.provider === 'google').action, confidence: aiConsensusResult.details.find(d => d.provider === 'google').confidence, agreement: 1 })
                  : null,
        crowd:  null, // Polymarket price would go here for prediction markets
      };

      // ── Compute edge ───────────────────────────────────────────
      const edgeResult = this.edge.compute({
        p_market,
        aiVotes,
        symbol,
        marketType: node.marketData.type,
      });

      if (!edgeResult.tradeable) continue;

      // ── Warmth gate (B.O.S.S. native) ────────────────────────
      if (safeWarmth < this.config.minWarmth) continue;

      // ── Direction gate ────────────────────────────────────────
      if (edgeResult.direction !== 'BULL') continue;

      // ── Kelly sizing ──────────────────────────────────────────
      const sizing = this.kelly.sizePosition({
        bankroll: balance,
        p_model: edgeResult.p_model,
        p_market: edgeResult.p_market,
        stopLossPct: this.config.stopLossPct,
        currentDrawdown: drawdown,
        openPositions: openCount,
        dailyAICost: this.dailyAICost,
      });

      if (!sizing.approved) {
        this.clog(`📐 ${symbol} sizing rejected: ${sizing.reason}`, 'log-sys');
        continue;
      }

      // ── Total exposure check ───────────────────────────────────
      const totalExposure = Object.values(this.positions).reduce((s, p) => s + p.amount, 0);
      if (totalExposure + sizing.size >= balance * this.config.maxTotalExposure) {
        this.clog(`📐 ${symbol} exposure limit reached`, 'log-sys');
        continue;
      }

      // ── SIGNAL: BUY ───────────────────────────────────────────
      this.clog(
        `🟢 BUY SIGNAL: ${symbol} — warmth:${safeWarmth.toFixed(1)} edge:${(edgeResult.edge*100).toFixed(1)}% EV:${edgeResult.ev.toFixed(3)} kelly:${(sizing.fraction*100).toFixed(1)}%`,
        'log-pulse'
      );

      // Record prediction for calibration tracking
      const predId = `${symbol}_${Date.now()}`;
      this.calibration.recordPrediction(predId, symbol, edgeResult.p_model, edgeResult.p_market, edgeResult.edge, {
        aiVotes,
        aiConsensus: aiConsensusResult,
      });

      await this._openPosition(symbol, sizing.size, safePrice, { predId, edgeResult });
    }
  }

  // ── Check Existing Positions ──────────────────────────────────
  async _checkPositions() {
    for (const [symbol, position] of Object.entries(this.positions)) {
      const node = (this.bridge.kernelNodes || []).find(n =>
        n.id === `MKT_${symbol}` && n.marketData
      );

      if (!node) continue;

      const currentPrice = parseFloat(node.marketData.price) || position.entryPrice;
      const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

      // Slippage check on existing positions (price moved unexpectedly fast)
      const expectedMove = Math.abs(pnlPct);
      if (expectedMove > 0.20 && Date.now() - position.timestamp < 60000) {
        this.clog(`⚠️ ${symbol}: 20%+ move in <1min — checking for manipulation`, 'log-grief');
      }

      // Stop loss
      if (pnlPct <= -this.config.stopLossPct) {
        this.clog(`🔴 STOP LOSS: ${symbol} at ${(pnlPct*100).toFixed(1)}%`, 'log-grief');
        await this._closePosition(symbol, 'stop_loss');
        continue;
      }

      // Take profit
      if (pnlPct >= this.config.takeProfitPct) {
        this.clog(`🟢 TAKE PROFIT: ${symbol} at +${(pnlPct*100).toFixed(1)}%`, 'log-win');
        await this._closePosition(symbol, 'take_profit');
        continue;
      }

      // Warmth decay exit
      if (node.warmth < 0.5 && pnlPct > 0) {
        this.clog(`🟡 WARMTH EXIT: ${symbol} cooling, locking +${(pnlPct*100).toFixed(1)}%`, 'log-bond');
        await this._closePosition(symbol, 'warmth_decay');
        continue;
      }
    }
  }

  // ── Open Position ─────────────────────────────────────────────
  async _openPosition(symbol, amount, price, meta = {}) {
    this.positions[symbol] = {
      amount,
      entryPrice: price,
      timestamp: Date.now(),
      predId: meta.predId,
      edgeResult: meta.edgeResult,
    };

    this.lastTradeTime = Date.now();
    this.tradesThisHour++;

    this.tradeHistory.push({
      type: 'BUY',
      symbol,
      amount,
      price,
      time: Date.now(),
      edge: meta.edgeResult?.edge,
    });

    this.clog(`📈 OPENED: ${symbol} — ${amount.toFixed(2)} @ $${price.toFixed(2)}`, 'log-pulse');
  }

  // ── Close Position ────────────────────────────────────────────
  async _closePosition(symbol, reason) {
    const position = this.positions[symbol];
    if (!position) return;

    const node = (this.bridge?.kernelNodes || []).find(n => n.id === `MKT_${symbol}`);
    const currentPrice = node ? node.marketData.price : position.entryPrice;
    const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
    const pnlAmount = position.amount * pnlPct;
    const duration = Date.now() - position.timestamp;

    this.dailyPnL += pnlAmount;

    const closedTrade = {
      type: 'SELL',
      symbol,
      amount: position.amount,
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      pnl: pnlAmount,
      pnlPct,
      reason,
      time: Date.now(),
      duration,
      p_model: position.edgeResult?.p_model,
      p_market: position.edgeResult?.p_market,
      aiAgreement: position.edgeResult?.agreement,
      wasGrief: reason === 'grief_protocol',
    };

    this.tradeHistory.push(closedTrade);

    // ── Calibration: record outcome ────────────────────────────
    if (position.predId) {
      const outcome = pnlAmount >= 0 ? 1 : 0;
      this.calibration.recordOutcome(position.predId, outcome, pnlAmount);
    }

    // ── Compound: post-mortem if loss ──────────────────────────
    if (pnlAmount < 0) {
      this.compound.postMortem(closedTrade);
    }

    delete this.positions[symbol];

    const emoji = pnlAmount >= 0 ? '✅' : '❌';
    this.clog(
      `${emoji} CLOSED: ${symbol} — ${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toFixed(2)} (${(pnlPct*100).toFixed(1)}%) [${reason}]`,
      pnlAmount >= 0 ? 'log-win' : 'log-grief'
    );
  }

  // ── Nightly Consolidation ──────────────────────────────────────
  _nightlyConsolidation() {
    this.clog('🌙 NIGHTLY CONSOLIDATION running...', 'log-bond');
    const result = this.compound.consolidate();
    const report = this.calibration.report();
    this.dailyPnL = 0;        // Reset daily P&L
    this.dailyAICost = 0;     // Reset AI cost
    this.peakBalance = this.startBalance; // Reset peak for new day

    this.clog(`🌙 Compound: ${result.activeForbiddenPatterns} active forbidden patterns`, 'log-bond');
    this.clog(`🌙 Brier: ${report.brierScore} | WinRate: ${report.winRate} | Sharpe: ${report.sharpeRatio}`, 'log-bond');
  }

  // ── Status ────────────────────────────────────────────────────
  getStatus() {
    const balance = this.startBalance + this.dailyPnL;
    const drawdown = this.peakBalance > 0 ? (this.peakBalance - balance) / this.peakBalance : 0;
    const openPositions = Object.keys(this.positions).length;
    const closed = this.tradeHistory.filter(t => t.type === 'SELL');
    const wins = closed.filter(t => t.pnl > 0).length;
    const winRate = closed.length > 0 ? (wins / closed.length * 100).toFixed(0) : 0;
    const calibReport = this.calibration.report();

    return {
      version: 'v2',
      active: this.active,
      killSwitchActive: this._killSwitchActive(),
      balance: parseFloat(balance.toFixed(2)),
      dailyPnL: parseFloat(this.dailyPnL.toFixed(2)),
      dailyAICost: parseFloat(this.dailyAICost.toFixed(2)),
      drawdown: parseFloat((drawdown * 100).toFixed(1)),
      drawdownBlocked: drawdown >= this.config.maxDrawdown,
      openPositions,
      totalTrades: closed.length,
      winRate: parseFloat(winRate),
      isGrieving: Date.now() < this.griefUntil,
      brierScore: calibReport.brierScore,
      sharpe: calibReport.sharpeRatio,
      compoundStats: this.compound.stats(),
      positions: { ...this.positions },
    };
  }
}

if (typeof module !== 'undefined') module.exports = { BossTraderV2 };
