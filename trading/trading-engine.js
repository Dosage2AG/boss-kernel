/* ══════════════════════════════════════════════════════════════════════
   B.O.S.S. TRADING ENGINE — Resonance-Based Automated Trading
   
   Uses B.O.S.S. kernel signals to make trading decisions.
   Warmth = buy pressure. Decay = sell signal. Grief = STOP.
   
   RISK MANAGEMENT IS BIOLOGICAL:
   - The system gets "tired" (metabolic decay limits trading frequency)
   - The system "grieves" (contradictions pause all trading)
   - The system has a "metabolism" (daily loss limit = starvation point)
   ══════════════════════════════════════════════════════════════════════ */

class BossTrader {
  constructor(wallet, marketBridge, clog) {
    this.wallet = wallet;
    this.bridge = marketBridge;
    this.clog = clog || console.log;
    
    // Trading state
    this.active = false;
    this.positions = {};      // { symbol: { amount, entryPrice, timestamp } }
    this.tradeHistory = [];
    this.dailyPnL = 0;
    
    // Risk parameters (biological constraints)
    this.config = {
      maxPositionPct: 0.20,    // max 20% of balance per trade
      maxTotalExposure: 0.60,  // max 60% of balance in positions
      stopLossPct: 0.05,       // 5% stop loss per position
      takeProfitPct: 0.10,     // 10% take profit
      dailyLossLimit: 0.10,    // stop trading if down 10% today
      minWarmth: 2.0,          // node must be this warm to trigger buy
      minMatch: 0.4,           // minimum semantic match for signal
      griefCooldown: 300000,   // 5 min cooldown after grief protocol
      maxTradesPerHour: 6,     // metabolic rate limit
      minTimeBetweenTrades: 60000, // 1 minute minimum
    };
    
    // Metabolic state
    this.lastTradeTime = 0;
    this.tradesThisHour = 0;
    this.hourStart = Date.now();
    this.griefUntil = 0;       // timestamp when grief cooldown ends
    this.startBalance = 0;
  }

  // ── Start Trading ─────────────────────────────────────────────────
  async start(initialBalance) {
    this.active = true;
    this.startBalance = initialBalance || await this.wallet.getBalance();
    this.dailyPnL = 0;
    this.hourStart = Date.now();
    this.tradesThisHour = 0;
    
    this.clog(`⚡ Trading engine ACTIVE — Balance: ${this.startBalance.toFixed(2)} TON`, 'log-pulse');
    this.clog(`⚡ Risk: ${(this.config.maxPositionPct*100)}% max position, ${(this.config.stopLossPct*100)}% stop loss`, 'log-sys');
    
    this.tick();
  }

  stop() {
    this.active = false;
    this.clog('⚡ Trading engine STOPPED', 'log-sys');
  }

  // ── Main Trading Loop ─────────────────────────────────────────────
  async tick() {
    if (!this.active) return;

    const now = Date.now();

    // Reset hourly counter
    if (now - this.hourStart > 3600000) {
      this.hourStart = now;
      this.tradesThisHour = 0;
    }

    // Check biological constraints
    const canTrade = this.checkVitals(now);
    
    if (canTrade) {
      // Check existing positions for stop loss / take profit
      await this.checkPositions();
      
      // Look for new opportunities
      await this.scanOpportunities();
    }

    // Next tick in 30 seconds
    setTimeout(() => this.tick(), 30000);
  }

  // ── Biological Constraints (VITALS) ───────────────────────────────
  checkVitals(now) {
    // Grief cooldown — Arbiter said STOP
    if (now < this.griefUntil) {
      return false;
    }

    // Daily loss limit — starvation point
    if (this.dailyPnL < -(this.startBalance * this.config.dailyLossLimit)) {
      if (this.active) {
        this.clog('🛑 Daily loss limit hit — trading suspended until tomorrow', 'log-grief');
        this.active = false;
      }
      return false;
    }

    // Metabolic rate — can't trade too fast
    if (this.tradesThisHour >= this.config.maxTradesPerHour) {
      return false;
    }

    // Minimum time between trades
    if (now - this.lastTradeTime < this.config.minTimeBetweenTrades) {
      return false;
    }

    return true;
  }

  // ── Grief Protocol — Called by Arbiter ─────────────────────────────
  onGrief(reason) {
    this.griefUntil = Date.now() + this.config.griefCooldown;
    this.clog(`⚠️ GRIEF: ${reason} — trading paused 5min`, 'log-grief');
    
    // Close all positions on grief (safety)
    for (const symbol of Object.keys(this.positions)) {
      this.closePosition(symbol, 'grief_protocol');
    }
  }

  // ── Scan for Opportunities ────────────────────────────────────────
  async scanOpportunities() {
    if (!this.bridge) return;

    const marketNodes = this.bridge.kernelNodes.filter(n => 
      this.bridge.marketNodeIds.has(n.id) && n.marketData
    );

    for (const node of marketNodes) {
      const symbol = node.marketData.symbol;
      
      // Skip if already in position
      if (this.positions[symbol]) continue;

      // Skip non-crypto (can only trade crypto on TON DEX)
      if (node.marketData.type !== 'crypto') continue;

      // CHECK: Is the node warm enough?
      if (node.warmth < this.config.minWarmth) continue;

      // CHECK: Is momentum strong?
      if (node.marketData.momentum < 0.3) continue;

      // CHECK: Direction — only buy bullish signals
      if (node.marketData.direction !== 'BULL') continue;

      // CHECK: Total exposure limit
      const totalExposure = Object.values(this.positions)
        .reduce((sum, p) => sum + p.amount, 0);
      const balance = this.startBalance + this.dailyPnL;
      if (totalExposure >= balance * this.config.maxTotalExposure) continue;

      // SIGNAL: BUY
      const positionSize = balance * this.config.maxPositionPct;
      
      this.clog(
        `🟢 BUY SIGNAL: ${symbol} — warmth:${node.warmth.toFixed(1)} momentum:${node.marketData.momentum.toFixed(2)} change:${node.marketData.change24h.toFixed(1)}%`,
        'log-pulse'
      );

      await this.openPosition(symbol, positionSize, node.marketData.price);
    }
  }

  // ── Check Existing Positions ──────────────────────────────────────
  async checkPositions() {
    for (const [symbol, position] of Object.entries(this.positions)) {
      const node = this.bridge.kernelNodes.find(n => 
        n.id === `MKT_${symbol}` && n.marketData
      );

      if (!node) continue;

      const currentPrice = node.marketData.price;
      const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

      // Stop loss
      if (pnlPct <= -this.config.stopLossPct) {
        this.clog(`🔴 STOP LOSS: ${symbol} at ${(pnlPct*100).toFixed(1)}%`, 'log-grief');
        await this.closePosition(symbol, 'stop_loss');
        continue;
      }

      // Take profit
      if (pnlPct >= this.config.takeProfitPct) {
        this.clog(`🟢 TAKE PROFIT: ${symbol} at +${(pnlPct*100).toFixed(1)}%`, 'log-win');
        await this.closePosition(symbol, 'take_profit');
        continue;
      }

      // Warmth decay — node cooling = exit signal
      if (node.warmth < 0.5 && pnlPct > 0) {
        this.clog(`🟡 WARMTH EXIT: ${symbol} cooling, locking +${(pnlPct*100).toFixed(1)}%`, 'log-bond');
        await this.closePosition(symbol, 'warmth_decay');
        continue;
      }
    }
  }

  // ── Open Position ─────────────────────────────────────────────────
  async openPosition(symbol, amount, price) {
    // In production: execute swap on STON.fi or DeDust
    // For now: simulated position tracking
    
    this.positions[symbol] = {
      amount: amount,
      entryPrice: price,
      timestamp: Date.now()
    };
    
    this.lastTradeTime = Date.now();
    this.tradesThisHour++;
    
    this.tradeHistory.push({
      type: 'BUY',
      symbol: symbol,
      amount: amount,
      price: price,
      time: Date.now()
    });

    this.clog(
      `📈 OPENED: ${symbol} — ${amount.toFixed(2)} TON @ $${price.toFixed(2)}`,
      'log-pulse'
    );
  }

  // ── Close Position ────────────────────────────────────────────────
  async closePosition(symbol, reason) {
    const position = this.positions[symbol];
    if (!position) return;

    const node = this.bridge.kernelNodes.find(n => n.id === `MKT_${symbol}`);
    const currentPrice = node ? node.marketData.price : position.entryPrice;
    const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
    const pnlAmount = position.amount * pnlPct;

    this.dailyPnL += pnlAmount;

    this.tradeHistory.push({
      type: 'SELL',
      symbol: symbol,
      amount: position.amount,
      entryPrice: position.entryPrice,
      exitPrice: currentPrice,
      pnl: pnlAmount,
      pnlPct: pnlPct,
      reason: reason,
      time: Date.now()
    });

    delete this.positions[symbol];

    const emoji = pnlAmount >= 0 ? '✅' : '❌';
    this.clog(
      `${emoji} CLOSED: ${symbol} — ${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toFixed(2)} TON (${(pnlPct*100).toFixed(1)}%) [${reason}]`,
      pnlAmount >= 0 ? 'log-win' : 'log-grief'
    );
  }

  // ── Get Status ────────────────────────────────────────────────────
  getStatus() {
    const balance = this.startBalance + this.dailyPnL;
    const openPositions = Object.keys(this.positions).length;
    const totalTrades = this.tradeHistory.filter(t => t.type === 'SELL').length;
    const wins = this.tradeHistory.filter(t => t.type === 'SELL' && t.pnl > 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(0) : 0;

    return {
      active: this.active,
      balance: balance,
      dailyPnL: this.dailyPnL,
      openPositions: openPositions,
      totalTrades: totalTrades,
      winRate: winRate,
      positions: { ...this.positions },
      isGrieving: Date.now() < this.griefUntil
    };
  }
}

if (typeof module !== 'undefined') module.exports = { BossTrader };
