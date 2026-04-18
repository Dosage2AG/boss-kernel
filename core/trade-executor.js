/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. TRADE EXECUTOR — Resonance Field → Trades
   
   Takes signals from the temporal resonance field and executes
   with dynamic leverage, trailing stops, partial TP, and 
   cascade-aware timing.
   ══════════════════════════════════════════════════════════════════ */

class TradeExecutor {
  constructor(field, narrator, wallet) {
    this.field = field;
    this.narrator = narrator;
    this.wallet = wallet;
    this.positions = new Map();
    this.history = [];
    this.balance = 0;
    this.startBalance = 0;
    this.dailyPnL = 0;
    this.dayStart = Date.now();

    // Adaptive risk — adjusts based on recent performance
    this.recentWinRate = 0.5;
    this.consecutiveLosses = 0;

    this.config = {
      maxPositions: 5,
      basePosSize: 0.15,       // 15% of balance
      maxExposure: 0.70,       // 70% total
      baseStopLoss: 0.03,      // 3%
      baseTakeProfit: 0.08,    // 8%
      dailyLossLimit: 0.12,    // 12%
      baseLeverage: 2,
      maxLeverage: 5,
      tradeFee: 0.0005,        // 0.05% (Hyperliquid rate)
      minSignalStrength: 0.3,
      cascadeBonus: 1.5,       // multiply position size for cascade signals
      griefThreshold: 0.6,     // field grief > 0.6 = stop trading
      cooldownAfterLoss: 60000 // 1 min cooldown after loss
    };

    this.lastLossTime = 0;
  }

  start(balance) {
    this.balance = balance;
    this.startBalance = balance;
    this.narrator.log(`Engine active. Balance: ${balance.toFixed(2)}. Max ${this.config.maxPositions} positions.`, 'trade');
  }

  // ── Main Execution Loop ───────────────────────────────────────
  execute() {
    if (this.balance <= 0) return;

    const now = Date.now();

    // Reset daily
    if (now - this.dayStart > 86400000) {
      this.dailyPnL = 0;
      this.dayStart = now;
    }

    // Daily loss limit
    if (this.dailyPnL < -(this.startBalance * this.config.dailyLossLimit)) {
      this.narrator.grief('Daily loss limit reached. Engine sleeping until tomorrow.');
      return;
    }

    // Field grief check
    if (this.field.griefLevel > this.config.griefThreshold) {
      this.narrator.grief(`Field contradiction at ${(this.field.griefLevel * 100).toFixed(0)}%.`);
      this.closeAll('grief');
      return;
    }

    // Cooldown after loss
    if (now - this.lastLossTime < this.config.cooldownAfterLoss) return;

    // Check existing positions
    this.managePositions();

    // Look for new signals
    this.seekEntries();
  }

  // ── Manage Open Positions ─────────────────────────────────────
  managePositions() {
    for (const [symbol, pos] of this.positions) {
      const node = this.field.getNode(symbol);
      if (!node) continue;

      const price = node.price;
      const pnl = pos.direction === 'LONG'
        ? (price - pos.entry) / pos.entry * pos.leverage
        : (pos.entry - price) / pos.entry * pos.leverage;

      // Dynamic trailing stop — tightens as profit grows
      let stopLevel;
      if (pnl > 0.06) stopLevel = -0.01;      // tight trail in deep profit
      else if (pnl > 0.03) stopLevel = -0.015; // moderate trail
      else stopLevel = -this.config.baseStopLoss;

      // Stop loss
      if (pnl <= stopLevel) {
        this.closePosition(symbol, price, pnl, 'Trailing stop hit');
        continue;
      }

      // Take profit with partial close
      if (pnl >= this.config.baseTakeProfit && !pos.partialClosed) {
        // Close 60%, let 40% ride
        const closeAmount = pos.size * 0.6;
        const closePnl = closeAmount * pnl;
        this.balance += closeAmount + closePnl - (closeAmount * this.config.tradeFee * 2);
        pos.size *= 0.4;
        pos.partialClosed = true;
        this.dailyPnL += closePnl;
        this.narrator.tradeClose(symbol, pnl * 100, 'Partial take profit. 40% riding.');
        continue;
      }

      // Extended take profit for runners
      if (pnl >= this.config.baseTakeProfit * 2.5) {
        this.closePosition(symbol, price, pnl, 'Extended target reached');
        continue;
      }

      // Warmth decay exit — signal dying, lock gains
      if (node.warmth < 0.1 && pnl > 0.01) {
        this.closePosition(symbol, price, pnl, 'Signal cooling. Locking gains.');
        continue;
      }

      // Direction reversal
      if (pos.direction === 'LONG' && node.direction === 'BEAR' && node.warmth > 0.3) {
        this.closePosition(symbol, price, pnl, 'Trend reversed.');
      } else if (pos.direction === 'SHORT' && node.direction === 'BULL' && node.warmth > 0.3) {
        this.closePosition(symbol, price, pnl, 'Trend reversed.');
      }
    }
  }

  // ── Seek New Entries ──────────────────────────────────────────
  seekEntries() {
    if (this.positions.size >= this.config.maxPositions) return;

    const totalExposure = [...this.positions.values()].reduce((s, p) => s + p.size, 0);
    if (totalExposure >= this.balance * this.config.maxExposure) return;

    const signals = this.field.getSignals(this.config.minSignalStrength);

    for (const signal of signals) {
      if (this.positions.has(signal.symbol)) continue;
      if (this.positions.size >= this.config.maxPositions) break;

      // Dynamic position sizing
      let posSize = this.balance * this.config.basePosSize;

      // Cascade signals get bigger positions (front-running a wave)
      if (signal.cascadeBoost && Math.abs(signal.cascadeBoost) > 0.1) {
        posSize *= this.config.cascadeBonus;
        this.narrator.log(
          `Cascade signal on ${signal.symbol}. Wave arriving ${signal.cascadeArrival ? (signal.cascadeArrival / 3600000).toFixed(1) + 'h' : 'soon'}. Increasing position.`,
          'cascade'
        );
      }

      // Reduce size after consecutive losses
      if (this.consecutiveLosses > 2) {
        posSize *= 0.5;
      }

      // Dynamic leverage based on signal strength
      const leverage = Math.min(
        this.config.maxLeverage,
        this.config.baseLeverage + signal.strength * 2
      );

      posSize = Math.min(posSize, this.balance * 0.95);
      if (posSize < 5) continue;

      // Open position
      this.positions.set(signal.symbol, {
        entry: signal.price,
        size: posSize,
        direction: signal.direction,
        leverage,
        openTime: Date.now(),
        partialClosed: false,
        cascadeSignal: !!signal.cascadeBoost
      });

      this.balance -= posSize;
      const reason = signal.cascadeBoost 
        ? `Cascade from ${this.field.getNode(signal.symbol)?.cascadeSource}. ${leverage.toFixed(1)}x leverage.`
        : `Warmth ${signal.warmth.toFixed(2)}. AI confirmed. ${leverage.toFixed(1)}x leverage.`;

      this.narrator.tradeOpen(signal.symbol, signal.direction, reason);
    }
  }

  // ── Close Position ────────────────────────────────────────────
  closePosition(symbol, price, pnlPct, reason) {
    const pos = this.positions.get(symbol);
    if (!pos) return;

    const pnlAmount = pos.size * pnlPct;
    const fee = pos.size * this.config.tradeFee * 2;
    const netPnl = pnlAmount - fee;

    this.balance += pos.size + netPnl;
    this.dailyPnL += netPnl;

    if (netPnl >= 0) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
      this.lastLossTime = Date.now();
    }

    this.narrator.tradeClose(symbol, pnlPct * 100, reason);
    this.history.push({
      symbol, direction: pos.direction, entry: pos.entry, exit: price,
      pnl: netPnl, pnlPct: pnlPct * 100, reason, leverage: pos.leverage,
      cascade: pos.cascadeSignal, time: Date.now()
    });

    this.positions.delete(symbol);

    // Update win rate
    const recent = this.history.slice(-20);
    this.recentWinRate = recent.filter(t => t.pnl > 0).length / (recent.length || 1);
  }

  closeAll(reason) {
    for (const [symbol] of this.positions) {
      const node = this.field.getNode(symbol);
      if (node) {
        const pos = this.positions.get(symbol);
        const pnl = pos.direction === 'LONG'
          ? (node.price - pos.entry) / pos.entry * pos.leverage
          : (pos.entry - node.price) / pos.entry * pos.leverage;
        this.closePosition(symbol, node.price, pnl, reason);
      }
    }
  }

  getStatus() {
    const wins = this.history.filter(t => t.pnl > 0);
    const losses = this.history.filter(t => t.pnl <= 0);
    const cascadeTrades = this.history.filter(t => t.cascade);
    const cascadeWins = cascadeTrades.filter(t => t.pnl > 0);

    return {
      balance: this.balance,
      totalValue: this.balance + [...this.positions.values()].reduce((s, p) => s + p.size, 0),
      dailyPnL: this.dailyPnL,
      openPositions: this.positions.size,
      totalTrades: this.history.length,
      wins: wins.length,
      losses: losses.length,
      winRate: this.history.length ? (wins.length / this.history.length * 100) : 0,
      avgWin: wins.length ? wins.reduce((s,t) => s + t.pnlPct, 0) / wins.length : 0,
      avgLoss: losses.length ? losses.reduce((s,t) => s + t.pnlPct, 0) / losses.length : 0,
      cascadeTrades: cascadeTrades.length,
      cascadeWinRate: cascadeTrades.length ? (cascadeWins.length / cascadeTrades.length * 100) : 0,
      recentWinRate: this.recentWinRate * 100,
      consecutiveLosses: this.consecutiveLosses
    };
  }
}

if (typeof module !== 'undefined') module.exports = { TradeExecutor };
