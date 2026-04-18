/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. ENGINE — Browser Runtime
   Temporal Resonance Field + Trade Executor + Narrator
   Single file, no dependencies, runs in any browser
   ══════════════════════════════════════════════════════════════════ */

// ── NARRATOR ────────────────────────────────────────────────────
class BossNarrator {
  constructor(el) {
    this.el = el;
    this.buffer = [];
  }
  log(msg, cls = 'nt') {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    if (this.el) {
      this.el.appendChild(d);
      this.el.scrollTop = this.el.scrollHeight;
      if (this.el.children.length > 40) this.el.removeChild(this.el.firstChild);
    }
    this.buffer.push({ time: Date.now(), msg, cls });
    if (this.buffer.length > 200) this.buffer.shift();
  }
}

// ── TEMPORAL BOND ───────────────────────────────────────────────
class TBond {
  constructor(from, to, strength, delayH) {
    this.from = from;
    this.to = to;
    this.strength = strength;     // -1 to 1
    this.delayMs = delayH * 3600000;
    this.lastFired = 0;
  }
}

// ── RESONANCE FIELD ─────────────────────────────────────────────
class BossField {
  constructor(narrator) {
    this.nar = narrator;
    this.nodes = new Map();
    this.bonds = [];
    this.cascadeQueue = [];       // {target, magnitude, executeAt, source}
    this.grief = 0;
    this.fieldWarmth = 0;
  }

  addNode(id, type) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id, type, price: 0, change: 0, warmth: 0.1,
        dir: null, history: [], ema8: 0, ema21: 0, ema55: 0,
        rsi: 50, cascadeFrom: null, hasTrade: false
      });
    }
    return this.nodes.get(id);
  }

  updateNode(id, price, change) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.price = price;
    n.change = change;
    n.dir = change > 0 ? 'BULL' : 'BEAR';
    n.warmth = Math.max(n.warmth, Math.abs(change) / 3);
    n.history.push(price);
    if (n.history.length > 200) n.history.shift();

    // Calculate EMAs
    const h = n.history;
    if (h.length >= 8) n.ema8 = this._ema(h.slice(-8), 8);
    if (h.length >= 21) n.ema21 = this._ema(h.slice(-21), 21);
    if (h.length >= 55) n.ema55 = this._ema(h.slice(-55), 55);

    // RSI
    if (h.length >= 15) {
      let gains = 0, losses = 0;
      for (let i = h.length - 14; i < h.length; i++) {
        const d = h[i] - h[i - 1];
        if (d > 0) gains += d; else losses -= d;
      }
      const rs = losses > 0 ? gains / losses : 100;
      n.rsi = 100 - (100 / (1 + rs));
    }
  }

  _ema(arr, period) {
    const k = 2 / (period + 1);
    let e = arr[0];
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }

  // ── Learn temporal bonds from price histories ─────────────────
  learnBonds() {
    const ids = [...this.nodes.keys()].filter(id => {
      const n = this.nodes.get(id);
      return n.type === 'crypto' && n.history.length >= 30;
    });

    this.bonds = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ha = this.nodes.get(ids[i]).history;
        const hb = this.nodes.get(ids[j]).history;
        let bestCorr = 0, bestLag = 0;

        for (let lag = 0; lag <= 12; lag++) {
          const len = Math.min(ha.length - lag, hb.length) - 1;
          if (len < 10) continue;
          const ca = [], cb = [];
          for (let k = 1; k < len; k++) {
            ca.push((ha[k] - ha[k - 1]) / ha[k - 1]);
            cb.push((hb[k + lag] - hb[k + lag - 1]) / hb[k + lag - 1]);
          }
          const mA = ca.reduce((s, c) => s + c, 0) / ca.length;
          const mB = cb.reduce((s, c) => s + c, 0) / cb.length;
          let num = 0, dA = 0, dB = 0;
          for (let k = 0; k < ca.length; k++) {
            const a = ca[k] - mA, b = cb[k] - mB;
            num += a * b; dA += a * a; dB += b * b;
          }
          const corr = (dA && dB) ? num / Math.sqrt(dA * dB) : 0;
          if (Math.abs(corr) > Math.abs(bestCorr)) { bestCorr = corr; bestLag = lag; }
        }

        if (Math.abs(bestCorr) > 0.35) {
          this.bonds.push(new TBond(ids[i], ids[j], bestCorr, bestLag));
          if (bestLag > 0 && Math.abs(bestCorr) > 0.5) {
            this.nar.log(`Bond: ${ids[i]} leads ${ids[j]} by ${bestLag}h (${(bestCorr * 100).toFixed(0)}%)`, 'nt-cascade');
          }
        }
      }
    }
  }

  // ── Inject event and schedule cascades ────────────────────────
  injectEvent(nodeId, magnitude) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    n.warmth = Math.min(n.warmth + Math.abs(magnitude) * 2, 10);

    for (const bond of this.bonds) {
      if (bond.from === nodeId || bond.to === nodeId) {
        const target = bond.from === nodeId ? bond.to : bond.from;
        const prop = magnitude * bond.strength;
        if (Math.abs(prop) < 0.01) continue;
        this.cascadeQueue.push({
          target, magnitude: prop, source: nodeId,
          executeAt: Date.now() + bond.delayMs
        });
      }
    }
  }

  // ── Process cascades ──────────────────────────────────────────
  processCascades() {
    const now = Date.now();
    const ready = this.cascadeQueue.filter(c => c.executeAt <= now);
    this.cascadeQueue = this.cascadeQueue.filter(c => c.executeAt > now);

    for (const c of ready) {
      const n = this.nodes.get(c.target);
      if (!n) continue;
      n.warmth = Math.min(n.warmth + Math.abs(c.magnitude) * 1.5, 10);
      n.cascadeFrom = c.source;
      this.nar.log(`Wave arrived: ${c.source} → ${c.target} (${c.magnitude > 0 ? 'bull' : 'bear'})`, 'nt-cascade');
    }
    return ready.length;
  }

  // ── Tick ──────────────────────────────────────────────────────
  tick(dt) {
    this.processCascades();
    for (const [, n] of this.nodes) {
      n.warmth *= Math.exp(-0.001 * dt);
      if (n.warmth < 0.08) n.warmth = 0.08;
    }
    // Field metrics
    const cryptos = [...this.nodes.values()].filter(n => n.type === 'crypto');
    const bullW = cryptos.filter(n => n.dir === 'BULL').reduce((s, n) => s + n.warmth, 0);
    const bearW = cryptos.filter(n => n.dir === 'BEAR').reduce((s, n) => s + n.warmth, 0);
    const total = bullW + bearW;
    this.grief = total > 0 ? 1 - Math.abs(bullW - bearW) / total : 0;
    this.fieldWarmth = cryptos.reduce((s, n) => s + n.warmth, 0) / (cryptos.length || 1);
  }

  // ── Get trading signals ───────────────────────────────────────
  getSignals() {
    const signals = [];
    for (const [id, n] of this.nodes) {
      if (n.type !== 'crypto') continue;
      if (n.warmth < 0.15) continue;
      if (n.history.length < 25) continue;

      let dir = null, reason = '';

      // EMA crossover + RSI filter
      if (n.ema8 > n.ema21 && n.ema21 > n.ema55 && n.rsi > 35 && n.rsi < 72) {
        dir = 'LONG';
        reason = `EMA aligned bullish. RSI ${n.rsi.toFixed(0)}.`;
      } else if (n.ema8 < n.ema21 && n.ema21 < n.ema55 && n.rsi > 28 && n.rsi < 65) {
        dir = 'SHORT';
        reason = `EMA aligned bearish. RSI ${n.rsi.toFixed(0)}.`;
      }

      // Grief filter — EMAs disagree
      if (n.ema8 > n.ema21 && n.ema21 < n.ema55) dir = null;
      if (n.ema8 < n.ema21 && n.ema21 > n.ema55) dir = null;

      // Cascade boost
      const incoming = this.cascadeQueue.filter(c => c.target === id);
      const cascadeBoost = incoming.reduce((s, c) => s + c.magnitude, 0);

      if (dir) {
        signals.push({ id, dir, warmth: n.warmth, price: n.price, reason, cascadeBoost, rsi: n.rsi });
      }
    }
    return signals.sort((a, b) => b.warmth - a.warmth);
  }
}

// ── TRADE EXECUTOR ──────────────────────────────────────────────
class BossTrader {
  constructor(field, narrator) {
    this.field = field;
    this.nar = narrator;
    this.balance = 0;
    this.startBal = 0;
    this.positions = new Map();   // id → {entry, size, dir, leverage, time, partial}
    this.history = [];
    this.wins = 0;
    this.losses = 0;
    this.dailyPnL = 0;
    this.consecutiveLosses = 0;
    this.lastLossTime = 0;

    this.cfg = {
      maxPos: 4,
      posSize: 0.20,
      maxExposure: 0.65,
      stopLoss: 0.035,
      takeProfit: 0.08,
      dailyLimit: 0.12,
      baseLev: 2,
      maxLev: 4,
      fee: 0.0005,
      griefThreshold: 0.6,
      cooldown: 30000
    };
  }

  start(bal) {
    this.balance = bal;
    this.startBal = bal;
    this.nar.log(`Trader online. ${bal.toFixed(2)} TON. Max ${this.cfg.maxPos} positions.`, 'nt-trade');
  }

  execute() {
    if (this.balance <= 0) return;
    const now = Date.now();

    // Daily limit
    if (this.dailyPnL < -(this.startBal * this.cfg.dailyLimit)) {
      this.nar.log('Daily loss limit. Sleeping.', 'nt-grief');
      return;
    }

    // Field grief
    if (this.field.grief > this.cfg.griefThreshold) {
      this.nar.log(`Field grief ${(this.field.grief * 100).toFixed(0)}%. Closing all.`, 'nt-grief');
      this.closeAll('Grief protocol');
      return;
    }

    // Cooldown after loss
    if (now - this.lastLossTime < this.cfg.cooldown) return;

    // Manage open positions
    for (const [id, pos] of this.positions) {
      const n = this.field.nodes.get(id);
      if (!n) continue;

      const pnl = pos.dir === 'LONG'
        ? (n.price - pos.entry) / pos.entry * pos.lev
        : (pos.entry - n.price) / pos.entry * pos.lev;

      // Trailing stop
      const stopAt = pnl > 0.05 ? -0.012 : -this.cfg.stopLoss;

      if (pnl <= stopAt) {
        this.close(id, n.price, pnl, pnl > 0 ? 'Trailing stop' : 'Stop loss');
      } else if (pnl >= this.cfg.takeProfit && !pos.partial) {
        // Partial take — close 60%
        const amt = pos.size * 0.6;
        const net = amt * pnl - amt * this.cfg.fee * 2;
        this.balance += amt + net;
        this.dailyPnL += net;
        pos.size *= 0.4;
        pos.partial = true;
        this.nar.log(`Partial TP on ${id}. +${(pnl * 100).toFixed(1)}%. 40% riding.`, 'nt-trade');
      } else if (pnl >= this.cfg.takeProfit * 2.5) {
        this.close(id, n.price, pnl, 'Extended target');
      } else if (n.warmth < 0.12 && pnl > 0.01) {
        this.close(id, n.price, pnl, 'Signal fading');
      }
    }

    // New entries
    if (this.positions.size >= this.cfg.maxPos) return;
    const exposure = [...this.positions.values()].reduce((s, p) => s + p.size, 0);
    if (exposure >= this.balance * this.cfg.maxExposure) return;

    const signals = this.field.getSignals();
    for (const sig of signals) {
      if (this.positions.has(sig.id)) continue;
      if (this.positions.size >= this.cfg.maxPos) break;

      let size = this.balance * this.cfg.posSize;
      // Cascade boost
      if (sig.cascadeBoost && Math.abs(sig.cascadeBoost) > 0.05) {
        size *= 1.4;
        this.nar.log(`Cascade signal on ${sig.id}. Boosting position.`, 'nt-cascade');
      }
      // Reduce after losses
      if (this.consecutiveLosses > 2) size *= 0.5;

      const lev = Math.min(this.cfg.maxLev, this.cfg.baseLev + sig.warmth);
      size = Math.min(size, this.balance * 0.9);
      if (size < 1) continue;

      this.positions.set(sig.id, {
        entry: sig.price, size, dir: sig.dir, lev,
        time: Date.now(), partial: false
      });
      this.balance -= size;

      // Mark star
      const node = this.field.nodes.get(sig.id);
      if (node) node.hasTrade = true;

      this.nar.log(`${sig.dir === 'LONG' ? 'Bought' : 'Shorted'} ${sig.id}. ${sig.reason} ${lev.toFixed(1)}x.`, 'nt-trade');
    }
  }

  close(id, price, pnlPct, reason) {
    const pos = this.positions.get(id);
    if (!pos) return;
    const net = pos.size * pnlPct - pos.size * this.cfg.fee * 2;
    this.balance += pos.size + net;
    this.dailyPnL += net;

    if (net >= 0) { this.wins++; this.consecutiveLosses = 0; }
    else { this.losses++; this.consecutiveLosses++; this.lastLossTime = Date.now(); }

    const node = this.field.nodes.get(id);
    if (node) node.hasTrade = false;

    this.history.push({ id, dir: pos.dir, pnl: net, pnlPct: pnlPct * 100, reason, time: Date.now() });
    this.positions.delete(id);

    const emoji = net >= 0 ? '✓' : '✗';
    this.nar.log(`${emoji} Closed ${id}. ${net >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(1)}%. ${reason}`, net >= 0 ? 'nt-trade' : 'nt-grief');
  }

  closeAll(reason) {
    for (const [id] of this.positions) {
      const n = this.field.nodes.get(id);
      if (!n) continue;
      const pos = this.positions.get(id);
      const pnl = pos.dir === 'LONG'
        ? (n.price - pos.entry) / pos.entry * pos.lev
        : (pos.entry - n.price) / pos.entry * pos.lev;
      this.close(id, n.price, pnl, reason);
    }
  }

  getStatus() {
    const total = this.wins + this.losses;
    return {
      balance: this.balance,
      equity: this.balance + [...this.positions.values()].reduce((s, p) => s + p.size, 0),
      dailyPnL: this.dailyPnL,
      positions: this.positions.size,
      trades: total,
      wins: this.wins,
      losses: this.losses,
      winRate: total > 0 ? (this.wins / total * 100) : 0,
      grief: this.field.grief
    };
  }
}
