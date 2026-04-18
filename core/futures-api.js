/* ══════════════════════════════════════════════════════════════════
   HYPERLIQUID PERPETUAL FUTURES API
   WebSocket real-time data + trade execution
   ══════════════════════════════════════════════════════════════════ */

class HyperliquidAPI {
  constructor(narrator) {
    this.nar = narrator;
    this.ws = null;
    this.connected = false;
    this.orderbook = {};    // {symbol: {bids:[], asks:[]}}
    this.positions = {};    // {symbol: {size, entry, leverage, unrealizedPnl}}
    this.funding = {};      // {symbol: {rate, nextFunding}}
    this.liquidations = {}; // {symbol: [{price, size, side}]}
    this.trades = {};       // {symbol: [{price, size, side, time}]}
    this.callbacks = {};
  }

  // ── Connect WebSocket ─────────────────────────────────────────
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
        
        this.ws.onopen = () => {
          this.connected = true;
          this.nar.log('Hyperliquid WebSocket connected.', 'nt-trade');
          
          // Subscribe to top coins
          const coins = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON', 'XRP'];
          coins.forEach(c => {
            this.subscribe('trades', c);
            this.subscribe('l2Book', c);
          });
          
          // Subscribe to liquidations
          this.ws.send(JSON.stringify({method: 'subscribe', subscription: {type: 'allLiquidations'}}));
          
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch(e) {}
        };
        
        this.ws.onerror = (err) => {
          this.nar.log('WebSocket error. Using REST fallback.', 'nt');
          reject(err);
        };
        
        this.ws.onclose = () => {
          this.connected = false;
          // Auto-reconnect after 5s
          setTimeout(() => this.connect(), 5000);
        };
      } catch(e) {
        reject(e);
      }
    });
  }

  subscribe(type, coin) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type, coin }
    }));
  }

  handleMessage(data) {
    const channel = data.channel;
    const d = data.data;
    
    if (channel === 'trades') {
      for (const trade of (d || [])) {
        const sym = trade.coin;
        if (!this.trades[sym]) this.trades[sym] = [];
        this.trades[sym].push({
          price: parseFloat(trade.px),
          size: parseFloat(trade.sz),
          side: trade.side,
          time: Date.now()
        });
        // Keep last 100
        if (this.trades[sym].length > 100) this.trades[sym].shift();
        
        // Whale detection — large trade
        if (parseFloat(trade.sz) * parseFloat(trade.px) > 100000) {
          this.onWhale(sym, trade);
        }
      }
    }
    
    if (channel === 'l2Book') {
      const sym = d.coin;
      this.orderbook[sym] = {
        bids: (d.levels[0] || []).map(l => ({price: parseFloat(l.px), size: parseFloat(l.sz)})),
        asks: (d.levels[1] || []).map(l => ({price: parseFloat(l.px), size: parseFloat(l.sz)}))
      };
    }
    
    if (channel === 'allLiquidations') {
      for (const liq of (d || [])) {
        const sym = liq.coin;
        if (!this.liquidations[sym]) this.liquidations[sym] = [];
        this.liquidations[sym].push({
          price: parseFloat(liq.px),
          size: parseFloat(liq.sz),
          side: liq.side,
          time: Date.now()
        });
        if (this.liquidations[sym].length > 50) this.liquidations[sym].shift();
        
        this.nar.log(`Liquidation: ${sym} ${liq.side} $${parseFloat(liq.sz * liq.px).toFixed(0)}`, 'nt-grief');
      }
    }
  }

  onWhale(sym, trade) {
    const value = parseFloat(trade.sz) * parseFloat(trade.px);
    this.nar.log(`🐋 Whale: ${sym} ${trade.side} $${(value/1000).toFixed(0)}K`, 'nt-cascade');
    
    // Trigger callback for field injection
    if (this.callbacks.onWhale) {
      this.callbacks.onWhale(sym, trade.side, value);
    }
  }

  // ── REST API Fallback ─────────────────────────────────────────
  async getFundingRates() {
    try {
      const resp = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: 'metaAndAssetCtxs'})
      });
      const data = await resp.json();
      const metas = data[0]?.universe || [];
      const ctxs = data[1] || [];
      
      for (let i = 0; i < metas.length && i < ctxs.length; i++) {
        const sym = metas[i].name;
        this.funding[sym] = {
          rate: parseFloat(ctxs[i].funding || 0),
          openInterest: parseFloat(ctxs[i].openInterest || 0),
          markPrice: parseFloat(ctxs[i].markPx || 0),
          oraclePrice: parseFloat(ctxs[i].oraclePx || 0)
        };
      }
      return this.funding;
    } catch(e) {
      return {};
    }
  }

  // ── Get Order Book Depth ──────────────────────────────────────
  getDepth(symbol) {
    const ob = this.orderbook[symbol];
    if (!ob) return { bidDepth: 0, askDepth: 0, imbalance: 0 };
    
    const bidDepth = ob.bids.slice(0, 10).reduce((s, b) => s + b.size * b.price, 0);
    const askDepth = ob.asks.slice(0, 10).reduce((s, a) => s + a.size * a.price, 0);
    const total = bidDepth + askDepth;
    const imbalance = total > 0 ? (bidDepth - askDepth) / total : 0; // +1 = all bids, -1 = all asks
    
    return { bidDepth, askDepth, imbalance };
  }

  // ── Get Liquidation Clusters ──────────────────────────────────
  getLiquidationClusters(symbol) {
    const liqs = this.liquidations[symbol] || [];
    if (liqs.length < 3) return [];
    
    // Group by price proximity
    const sorted = [...liqs].sort((a, b) => a.price - b.price);
    const clusters = [];
    let current = { price: sorted[0].price, total: sorted[0].size, count: 1 };
    
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].price - current.price) / current.price < 0.01) {
        current.total += sorted[i].size;
        current.count++;
        current.price = (current.price + sorted[i].price) / 2;
      } else {
        if (current.count >= 2) clusters.push(current);
        current = { price: sorted[i].price, total: sorted[i].size, count: 1 };
      }
    }
    if (current.count >= 2) clusters.push(current);
    
    return clusters;
  }
}

// ── FUNDING RATE FARMING STRATEGY ───────────────────────────────
class FundingFarmer {
  constructor(api, narrator) {
    this.api = api;
    this.nar = narrator;
    this.farmPositions = {};
  }

  async scan() {
    const funding = await this.api.getFundingRates();
    const opportunities = [];
    
    for (const [sym, data] of Object.entries(funding)) {
      const annualized = data.rate * 3 * 365 * 100; // 3 funding per day * 365
      
      // If funding > 30% annualized, there's an opportunity
      if (Math.abs(annualized) > 30) {
        opportunities.push({
          symbol: sym,
          rate: data.rate,
          annualized,
          direction: data.rate > 0 ? 'SHORT' : 'LONG', // go opposite to get paid
          markPrice: data.markPrice
        });
      }
    }
    
    if (opportunities.length > 0) {
      const best = opportunities.sort((a, b) => Math.abs(b.annualized) - Math.abs(a.annualized))[0];
      this.nar.log(`Funding opportunity: ${best.symbol} ${best.direction} (${best.annualized.toFixed(0)}% APR)`, 'nt-cascade');
    }
    
    return opportunities;
  }
}
