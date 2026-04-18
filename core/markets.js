/* ══════════════════════════════════════════════════════════════════════
   B.O.S.S. MARKET OBSERVER — Universal Resonance Field for All Markets
   
   Feeds: Polymarket (predictions), CoinGecko (crypto), ExchangeRate (forex)
   
   Each market data point becomes a Node in the B.O.S.S. kernel.
   Warmth = momentum. Decay = stale data fades. Arbiter = contradictions.
   ══════════════════════════════════════════════════════════════════════ */

class MarketFeed {
  constructor(kernel) {
    this.kernel = kernel;
    this.history = {};      // price history per symbol
    this.correlations = {}; // bond strength between symbols
    this.lastFetch = 0;
    this.fetchInterval = 30000; // 30 seconds
    this.feeds = {
      crypto: { enabled: true, url: 'https://api.coingecko.com/api/v3/simple/price', symbols: [] },
      forex: { enabled: true, url: 'https://open.er-api.com/v6/latest/USD', symbols: [] },
      polymarket: { enabled: true, url: 'https://gamma-api.polymarket.com/events', symbols: [] }
    };
  }

  // ── Fetch all market data ─────────────────────────────────────────
  async fetchAll() {
    const now = Date.now();
    if (now - this.lastFetch < this.fetchInterval) return;
    this.lastFetch = now;

    const results = {};
    
    try {
      // Crypto
      const cryptoData = await this.fetchCrypto();
      Object.assign(results, cryptoData);
    } catch(e) { console.warn('Crypto fetch failed:', e); }

    try {
      // Forex
      const forexData = await this.fetchForex();
      Object.assign(results, forexData);
    } catch(e) { console.warn('Forex fetch failed:', e); }

    try {
      // Polymarket
      const polyData = await this.fetchPolymarket();
      Object.assign(results, polyData);
    } catch(e) { console.warn('Polymarket fetch failed:', e); }

    // Update kernel nodes with market data
    this.updateKernel(results);
    
    return results;
  }

  // ── Crypto (CoinGecko) ────────────────────────────────────────────
  async fetchCrypto() {
    const coins = 'bitcoin,ethereum,solana,dogecoin,cardano,ripple,polkadot,avalanche-2,chainlink,polygon';
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
    
    const resp = await fetch(url);
    const data = await resp.json();
    const results = {};

    for (const [id, info] of Object.entries(data)) {
      const symbol = id.toUpperCase();
      const price = info.usd || 0;
      const change24h = info.usd_24h_change || 0;
      const volume = info.usd_24h_vol || 0;

      // Calculate momentum (warmth driver)
      const momentum = Math.abs(change24h) / 10; // normalize to 0-1 range roughly
      const direction = change24h > 0 ? 'BULL' : 'BEAR';

      results[`CRYPTO:${symbol}`] = {
        type: 'crypto',
        symbol: symbol,
        price: price,
        change24h: change24h,
        volume: volume,
        momentum: momentum,
        direction: direction,
        specialty: `${symbol} cryptocurrency ${direction.toLowerCase()} ${Math.abs(change24h).toFixed(1)}% move`,
        color: change24h > 0 ? '#00ffcc' : '#ff4444'
      };

      // Track history for correlation
      if (!this.history[symbol]) this.history[symbol] = [];
      this.history[symbol].push({ time: Date.now(), price, change: change24h });
      if (this.history[symbol].length > 100) this.history[symbol].shift();
    }

    return results;
  }

  // ── Forex (ExchangeRate API) ──────────────────────────────────────
  async fetchForex() {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await resp.json();
    const results = {};
    
    const majors = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'CNY', 'MXN', 'BRL', 'SEK'];
    
    for (const currency of majors) {
      const rate = data.rates[currency];
      if (!rate) continue;

      const symbol = `USD/${currency}`;
      
      // Calculate change from history
      let change = 0;
      if (this.history[symbol] && this.history[symbol].length > 0) {
        const lastRate = this.history[symbol][this.history[symbol].length - 1].price;
        change = ((rate - lastRate) / lastRate) * 100;
      }

      const momentum = Math.abs(change) * 10; // forex moves are small
      const direction = change > 0 ? 'STRONG_USD' : 'WEAK_USD';

      results[`FOREX:${symbol}`] = {
        type: 'forex',
        symbol: symbol,
        price: rate,
        change24h: change,
        volume: 0,
        momentum: momentum,
        direction: direction,
        specialty: `${symbol} forex pair ${rate.toFixed(4)}`,
        color: '#ffcc00'
      };

      if (!this.history[symbol]) this.history[symbol] = [];
      this.history[symbol].push({ time: Date.now(), price: rate, change });
      if (this.history[symbol].length > 100) this.history[symbol].shift();
    }

    return results;
  }

  // ── Polymarket (Prediction Markets) ───────────────────────────────
  async fetchPolymarket() {
    const resp = await fetch('https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false');
    const events = await resp.json();
    const results = {};

    for (const event of events) {
      const title = event.title || event.question || 'Unknown';
      const slug = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30).toUpperCase();
      
      // Get market outcomes
      const markets = event.markets || [];
      for (const market of markets) {
        const question = market.question || title;
        const outcomePrices = market.outcomePrices || [];
        const volume = parseFloat(market.volume || 0);
        
        // YES probability
        const yesPrice = outcomePrices[0] ? parseFloat(outcomePrices[0]) : 0.5;
        
        // Momentum from recent price movement
        const momentum = Math.abs(yesPrice - 0.5) * 2; // distance from 50/50 = conviction

        results[`POLY:${slug}`] = {
          type: 'polymarket',
          symbol: slug,
          price: yesPrice,
          change24h: 0,
          volume: volume,
          momentum: momentum,
          direction: yesPrice > 0.5 ? 'LIKELY' : 'UNLIKELY',
          specialty: question,
          color: yesPrice > 0.7 ? '#00ffcc' : yesPrice < 0.3 ? '#ff4444' : '#ffcc00',
          probability: yesPrice
        };
      }
    }

    return results;
  }

  // ── Update B.O.S.S. Kernel with Market Data ──────────────────────
  updateKernel(marketData) {
    if (!this.kernel || !this.kernel.updateMarketNodes) return;
    this.kernel.updateMarketNodes(marketData);
  }

  // ── Correlation Detection ─────────────────────────────────────────
  calculateCorrelations() {
    const symbols = Object.keys(this.history).filter(s => this.history[s].length >= 10);
    const correlations = {};

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const a = this.history[symbols[i]].map(h => h.change);
        const b = this.history[symbols[j]].map(h => h.change);
        const minLen = Math.min(a.length, b.length);
        
        if (minLen < 5) continue;

        // Pearson correlation
        const aSlice = a.slice(-minLen);
        const bSlice = b.slice(-minLen);
        const meanA = aSlice.reduce((s, v) => s + v, 0) / minLen;
        const meanB = bSlice.reduce((s, v) => s + v, 0) / minLen;
        
        let num = 0, denA = 0, denB = 0;
        for (let k = 0; k < minLen; k++) {
          const da = aSlice[k] - meanA;
          const db = bSlice[k] - meanB;
          num += da * db;
          denA += da * da;
          denB += db * db;
        }
        
        const corr = (denA && denB) ? num / Math.sqrt(denA * denB) : 0;
        
        if (Math.abs(corr) > 0.5) {
          const key = `${symbols[i]}:${symbols[j]}`;
          correlations[key] = corr;
        }
      }
    }

    this.correlations = correlations;
    return correlations;
  }

  // ── Get Market Summary ────────────────────────────────────────────
  getSummary(marketData) {
    const summary = { crypto: [], forex: [], polymarket: [] };
    
    for (const [key, data] of Object.entries(marketData)) {
      if (key.startsWith('CRYPTO:')) {
        summary.crypto.push(data);
      } else if (key.startsWith('FOREX:')) {
        summary.forex.push(data);
      } else if (key.startsWith('POLY:')) {
        summary.polymarket.push(data);
      }
    }

    // Sort by momentum (warmth potential)
    summary.crypto.sort((a, b) => b.momentum - a.momentum);
    summary.polymarket.sort((a, b) => b.momentum - a.momentum);

    return summary;
  }
}

// Export for use in kernel
if (typeof module !== 'undefined') module.exports = { MarketFeed };
