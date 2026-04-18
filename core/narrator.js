/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. NARRATOR — Human-readable market narration
   
   Translates machine signals into plain language.
   Every trade, cascade, grief, and event gets narrated.
   ══════════════════════════════════════════════════════════════════ */

class Narrator {
  constructor() {
    this.buffer = [];
    this.maxBuffer = 200;
    this.listeners = [];
  }

  onLog(fn) { this.listeners.push(fn); }

  log(message, type = 'info') {
    const entry = {
      time: Date.now(),
      timeStr: new Date().toLocaleTimeString(),
      message,
      type // info, trade, cascade, grief, profit, loss, news, bond, ai
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    this.listeners.forEach(fn => fn(entry));
  }

  // ── Market Narration Templates ────────────────────────────────
  priceMove(symbol, change, warmth) {
    if (Math.abs(change) < 0.5) return;
    
    const intensity = Math.abs(change) > 5 ? 'surging' :
                     Math.abs(change) > 2 ? 'moving' : 'drifting';
    const dir = change > 0 ? 'upward' : 'downward';
    
    this.log(`${symbol} ${intensity} ${dir}. ${Math.abs(change).toFixed(1)}% move. Warmth rising.`, 'info');
  }

  cascade(from, to, delay, direction) {
    const hours = (delay / 3600000).toFixed(1);
    const word = direction > 0 ? 'bullish' : 'bearish';
    this.log(`${from} triggered a ${word} wave. ${to} expected to follow in ${hours} hours.`, 'cascade');
  }

  tradeOpen(symbol, direction, reason) {
    const word = direction === 'LONG' ? 'Buying' : 'Shorting';
    this.log(`${word} ${symbol}. ${reason}`, 'trade');
  }

  tradeClose(symbol, pnlPct, reason) {
    const word = pnlPct >= 0 ? 'Profit' : 'Loss';
    const type = pnlPct >= 0 ? 'profit' : 'loss';
    this.log(`Closed ${symbol}. ${word}: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%. ${reason}`, type);
  }

  grief(reason) {
    this.log(`Market confused. ${reason} Stepping aside.`, 'grief');
  }

  news(headline, verified, impact) {
    const tag = verified ? 'Verified' : 'Unverified';
    this.log(`News [${tag}]: ${headline}. Impact: ${impact}.`, 'news');
  }

  aiConsensus(symbol, action, agreement, topReason) {
    const pct = Math.round(agreement * 100);
    this.log(`AI consensus on ${symbol}: ${action} (${pct}% agree). ${topReason}`, 'ai');
  }

  fieldStatus(warmth, grief, pending) {
    if (grief > 0.7) {
      this.log(`Field under stress. Grief level high. ${pending} cascades pending.`, 'grief');
    } else if (warmth > 0.5) {
      this.log(`Field active. Strong signals flowing. ${pending} cascades in transit.`, 'info');
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Narrator };
