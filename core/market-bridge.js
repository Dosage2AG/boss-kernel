/* ══════════════════════════════════════════════════════════════════════
   MARKET BRIDGE — Connects MarketFeed to B.O.S.S. Kernel
   
   Dynamically creates/updates/kills nodes based on live market data.
   Nodes are born from market activity. Nodes die from inactivity.
   This is CEA applied to financial markets.
   ══════════════════════════════════════════════════════════════════════ */

class MarketBridge {
  constructor(kernelNodes, clog, fireNodeFn) {
    this.feed = new MarketFeed(null);
    this.kernelNodes = kernelNodes;
    this.marketNodeIds = new Set();
    this.clog = clog;
    this.fireNode = fireNodeFn;
    this.running = false;
    this.cycle = 0;
  }

  async start() {
    this.running = true;
    this.clog('📡 Market Observer online — Crypto, Forex, Polymarket', 'log-sys');
    this.tick();
  }

  stop() {
    this.running = false;
    this.clog('📡 Market Observer offline', 'log-sys');
  }

  async tick() {
    if (!this.running) return;
    
    try {
      const data = await this.feed.fetchAll();
      if (data) {
        this.cycle++;
        this.processMarketData(data);
        
        // Calculate correlations every 10 cycles
        if (this.cycle % 10 === 0) {
          const corrs = this.feed.calculateCorrelations();
          this.updateBonds(corrs);
        }
      }
    } catch(e) {
      this.clog(`📡 Feed error: ${e.message}`, 'log-err');
    }

    setTimeout(() => this.tick(), 30000); // every 30s
  }

  processMarketData(data) {
    const summary = this.feed.getSummary(data);
    
    // Top movers get nodes
    const topCrypto = summary.crypto.slice(0, 5);
    const topPoly = summary.polymarket.slice(0, 5);
    const allForex = summary.forex.slice(0, 5);

    const allMarkets = [...topCrypto, ...topPoly, ...allForex];

    for (const market of allMarkets) {
      const nodeId = `MKT_${market.symbol}`;
      let node = this.kernelNodes.find(n => n.id === nodeId);

      if (!node) {
        // Birth a new market node
        const x = 100 + Math.random() * 600;
        const y = 100 + Math.random() * 400;
        node = new Node(
          market.symbol.substring(0, 10),
          market.specialty,
          x, y,
          market.color,
          0.5 + market.momentum,
          false
        );
        node.id = nodeId;
        node.marketData = market;
        this.kernelNodes.push(node);
        this.marketNodeIds.add(nodeId);
        this.clog(`🌱 Born: ${market.symbol} (${market.type})`, 'log-bond');
      } else {
        // Update existing node
        node.specialty = market.specialty;
        node.color = market.color;
        node.marketData = market;

        // Momentum drives warmth
        if (market.momentum > 0.3) {
          node.warmth = Math.min(node.warmth + market.momentum, 10);
          node.flashT = performance.now();
        }
      }
    }

    // Kill nodes with zero warmth for too long (market went quiet)
    const toRemove = [];
    for (const nodeId of this.marketNodeIds) {
      const node = this.kernelNodes.find(n => n.id === nodeId);
      if (node && node.warmth < 0.06) {
        const market = allMarkets.find(m => `MKT_${m.symbol}` === nodeId);
        if (!market) {
          // No longer in top movers — let it die
          toRemove.push(nodeId);
          this.clog(`💀 Died: ${node.name} (no resonance)`, 'log-grief');
        }
      }
    }

    for (const id of toRemove) {
      const idx = this.kernelNodes.findIndex(n => n.id === id);
      if (idx >= 0) this.kernelNodes.splice(idx, 1);
      this.marketNodeIds.delete(id);
    }

    // Log market pulse
    if (this.cycle % 5 === 0) {
      const hottest = allMarkets[0];
      if (hottest) {
        this.clog(
          `📊 Hottest: ${hottest.symbol} ${hottest.direction} (${hottest.change24h?.toFixed(1) || '?'}%)`,
          'log-pulse'
        );
      }
    }
  }

  updateBonds(correlations) {
    for (const [pair, strength] of Object.entries(correlations)) {
      const [symA, symB] = pair.split(':');
      const nodeA = this.kernelNodes.find(n => n.id === `MKT_${symA}`);
      const nodeB = this.kernelNodes.find(n => n.id === `MKT_${symB}`);
      
      if (nodeA && nodeB) {
        nodeA.bonds[nodeB.id] = Math.abs(strength);
        nodeB.bonds[nodeA.id] = Math.abs(strength);

        if (Math.abs(strength) > 0.8) {
          this.clog(`🔗 Strong bond: ${symA} ↔ ${symB} (${strength.toFixed(2)})`, 'log-bond');
        }
      }
    }
  }

  // Get market insight for a user query
  getInsight(intent) {
    const marketNodes = this.kernelNodes.filter(n => this.marketNodeIds.has(n.id));
    
    if (marketNodes.length === 0) return null;

    // Score each market node against the intent
    const scored = marketNodes.map(node => {
      const match = semanticSim(intent, node.specialty);
      const thermal = node.warmth * match;
      return { node, match, thermal, market: node.marketData };
    }).sort((a, b) => b.thermal - a.thermal);

    return scored.slice(0, 5);
  }
}
