/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. TEMPORAL RESONANCE FIELD — The Core Engine
   
   This replaces arrays/spreadsheets with a 4D resonance field.
   Nodes = assets. Edges = bonds with TIME DELAY.
   Events propagate through the field at bond-determined speeds.
   
   The graph IS the computation.
   ══════════════════════════════════════════════════════════════════ */

class ResonanceField {
  constructor(narrator) {
    this.nodes = new Map();       // id → FieldNode
    this.bonds = new Map();       // "A→B" → TemporalBond
    this.events = [];             // pending cascade events
    this.narrator = narrator;
    this.tick = 0;
    this.fieldWarmth = 0;         // global field temperature
    this.griefLevel = 0;          // 0 = clear, 1 = full grief
  }

  // ── Node Management ───────────────────────────────────────────
  addNode(id, type, metadata = {}) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    const node = new FieldNode(id, type, metadata);
    this.nodes.set(id, node);
    return node;
  }

  getNode(id) { return this.nodes.get(id); }

  // ── Bond Management (with temporal delay) ─────────────────────
  setBond(fromId, toId, strength, delayMs = 0) {
    const key = `${fromId}→${toId}`;
    this.bonds.set(key, new TemporalBond(fromId, toId, strength, delayMs));
    // Bidirectional but with potentially different delays
    const rKey = `${toId}→${fromId}`;
    if (!this.bonds.has(rKey)) {
      this.bonds.set(rKey, new TemporalBond(toId, fromId, strength * 0.7, delayMs * 1.3));
    }
  }

  // ── Learn Temporal Bonds from Data ────────────────────────────
  learnBonds(priceHistories) {
    const symbols = Object.keys(priceHistories);
    
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const a = symbols[i], b = symbols[j];
        const ha = priceHistories[a], hb = priceHistories[b];
        if (!ha || !hb || ha.length < 50 || hb.length < 50) continue;

        // Find optimal lag correlation
        let bestCorr = 0, bestLag = 0;
        
        for (let lag = 0; lag <= 24; lag++) { // test 0-24 hour lags
          const changesA = [], changesB = [];
          const len = Math.min(ha.length - lag, hb.length);
          
          for (let k = 1; k < len; k++) {
            changesA.push((ha[k] - ha[k-1]) / ha[k-1]);
            changesB.push((hb[k + lag] - hb[k + lag - 1]) / hb[k + lag - 1]);
          }
          
          if (changesA.length < 10) continue;
          
          const meanA = changesA.reduce((s,c) => s+c, 0) / changesA.length;
          const meanB = changesB.reduce((s,c) => s+c, 0) / changesB.length;
          
          let num = 0, denA = 0, denB = 0;
          for (let k = 0; k < changesA.length; k++) {
            const da = changesA[k] - meanA, db = changesB[k] - meanB;
            num += da * db; denA += da * da; denB += db * db;
          }
          
          const corr = (denA && denB) ? num / Math.sqrt(denA * denB) : 0;
          if (Math.abs(corr) > Math.abs(bestCorr)) {
            bestCorr = corr;
            bestLag = lag;
          }
        }

        if (Math.abs(bestCorr) > 0.3) {
          const delayMs = bestLag * 3600000; // hours to ms
          this.setBond(a, b, bestCorr, delayMs);
          
          if (bestLag > 0 && Math.abs(bestCorr) > 0.5) {
            this.narrator.log(
              `${a} leads ${b} by ${bestLag}h (${(bestCorr*100).toFixed(0)}% correlation)`,
              'bond'
            );
          }
        }
      }
    }
  }

  // ── Inject Event (price change, news, etc.) ───────────────────
  injectEvent(nodeId, eventType, magnitude, data = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Update the source node immediately
    node.warmth = Math.min(node.warmth + Math.abs(magnitude) * 2, 10);
    node.lastEvent = { type: eventType, magnitude, data, time: Date.now() };

    // Schedule cascade through bonds
    for (const [key, bond] of this.bonds) {
      if (bond.from === nodeId) {
        const propagatedMag = magnitude * bond.strength;
        if (Math.abs(propagatedMag) < 0.01) continue;

        this.events.push({
          targetId: bond.to,
          type: `cascade_${eventType}`,
          magnitude: propagatedMag,
          sourceId: nodeId,
          executeAt: Date.now() + bond.delayMs,
          bond: bond
        });
      }
    }
  }

  // ── Process Pending Cascade Events ────────────────────────────
  processCascades() {
    const now = Date.now();
    const ready = this.events.filter(e => e.executeAt <= now);
    this.events = this.events.filter(e => e.executeAt > now);

    for (const event of ready) {
      const node = this.nodes.get(event.targetId);
      if (!node) continue;

      node.warmth = Math.min(node.warmth + Math.abs(event.magnitude) * 1.5, 10);
      node.cascadeSource = event.sourceId;
      node.cascadeStrength = event.magnitude;

      this.narrator.log(
        `Cascade: ${event.sourceId} → ${event.targetId} (${event.magnitude > 0 ? 'bullish' : 'bearish'} wave arriving)`,
        'cascade'
      );
    }

    return ready.length;
  }

  // ── Update Field (call every tick) ────────────────────────────
  update(dt) {
    this.tick++;

    // Process scheduled cascades
    const cascades = this.processCascades();

    // Decay all warmth
    for (const [id, node] of this.nodes) {
      node.warmth *= Math.exp(-node.decayRate * dt);
      if (node.warmth < 0.01) node.warmth = 0.01;
    }

    // Calculate field-level metrics
    const allNodes = [...this.nodes.values()];
    this.fieldWarmth = allNodes.reduce((s, n) => s + n.warmth, 0) / (allNodes.length || 1);

    const bullWarmth = allNodes.filter(n => n.direction === 'BULL').reduce((s,n) => s + n.warmth, 0);
    const bearWarmth = allNodes.filter(n => n.direction === 'BEAR').reduce((s,n) => s + n.warmth, 0);

    // Grief = contradiction level
    const total = bullWarmth + bearWarmth;
    this.griefLevel = total > 0 ? 1 - Math.abs(bullWarmth - bearWarmth) / total : 0;

    // Pending cascade count
    this.pendingCascades = this.events.length;

    return { cascades, fieldWarmth: this.fieldWarmth, griefLevel: this.griefLevel };
  }

  // ── Get Trading Signals ───────────────────────────────────────
  getSignals(minWarmth = 0.1) {
    const signals = [];
    
    for (const [id, node] of this.nodes) {
      if (node.type !== 'crypto') continue; // only trade crypto
      if (node.warmth < minWarmth) continue;

      // Check if node has incoming cascades (front-run the wave)
      const incomingCascades = this.events.filter(e => e.targetId === id);
      const cascadeBoost = incomingCascades.reduce((s, e) => s + e.magnitude, 0);

      // Signal strength = warmth + cascade anticipation
      const strength = node.warmth + Math.abs(cascadeBoost) * 2;
      const direction = (node.direction === 'BULL' || cascadeBoost > 0.1) ? 'LONG' :
                       (node.direction === 'BEAR' || cascadeBoost < -0.1) ? 'SHORT' : null;

      if (direction && strength > minWarmth) {
        signals.push({
          symbol: id,
          direction,
          strength,
          warmth: node.warmth,
          cascadeBoost,
          cascadeArrival: incomingCascades.length > 0 ? 
            Math.min(...incomingCascades.map(e => e.executeAt)) - Date.now() : null,
          price: node.price,
          change: node.change
        });
      }
    }

    return signals.sort((a, b) => b.strength - a.strength);
  }

  // ── Get Field Summary ─────────────────────────────────────────
  getSummary() {
    const nodes = [...this.nodes.values()];
    return {
      totalNodes: nodes.length,
      cryptoNodes: nodes.filter(n => n.type === 'crypto').length,
      forexNodes: nodes.filter(n => n.type === 'forex').length,
      polyNodes: nodes.filter(n => n.type === 'poly').length,
      newsNodes: nodes.filter(n => n.type === 'news').length,
      fieldWarmth: this.fieldWarmth,
      griefLevel: this.griefLevel,
      pendingCascades: this.events.length,
      totalBonds: this.bonds.size,
      activeBonds: [...this.bonds.values()].filter(b => b.strength > 0.3).length
    };
  }
}

// ── Field Node ──────────────────────────────────────────────────
class FieldNode {
  constructor(id, type, metadata = {}) {
    this.id = id;
    this.type = type;           // crypto, forex, poly, news
    this.price = 0;
    this.change = 0;
    this.warmth = 0.1;
    this.direction = null;      // BULL, BEAR
    this.decayRate = type === 'news' ? 0.1 : 0.03;
    this.lastEvent = null;
    this.cascadeSource = null;
    this.cascadeStrength = 0;
    this.metadata = metadata;
    this.history = [];          // price history for pattern detection
  }

  updatePrice(price, change) {
    this.price = price;
    this.change = change;
    this.direction = change > 0 ? 'BULL' : 'BEAR';
    this.history.push(price);
    if (this.history.length > 200) this.history.shift();
  }
}

// ── Temporal Bond ───────────────────────────────────────────────
class TemporalBond {
  constructor(from, to, strength, delayMs) {
    this.from = from;
    this.to = to;
    this.strength = strength;   // -1 to 1 (negative = inverse correlation)
    this.delayMs = delayMs;     // propagation delay in milliseconds
    this.fireCount = 0;
    this.lastFired = 0;
  }
}

if (typeof module !== 'undefined') module.exports = { ResonanceField, FieldNode, TemporalBond };
