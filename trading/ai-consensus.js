/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. AI CONSENSUS ENGINE — MiroFish Market Intelligence
   
   Multiple AIs observe the same market data independently.
   Agreement = strong signal. Disagreement = grief protocol.
   
   Each coin has a behavioral profile built from observation.
   The AIs don't just analyze numbers — they read the profile
   and generate narrative insight like a human trader would.
   ══════════════════════════════════════════════════════════════════ */

class AIConsensusEngine {
  constructor(clog) {
    this.clog = clog || console.log;
    this.profiles = {};     // behavioral profile per coin
    this.lastConsensus = {};
    this.apiKeys = {
      anthropic: null,      // Claude
      openai: null,         // GPT  
      google: null          // Gemini
    };
    this.callCount = 0;
    this.costEstimate = 0;
  }

  setKey(provider, key) {
    this.apiKeys[provider] = key;
    this.clog(`🧠 ${provider} API connected`, 'log-bond');
  }

  // ── Build Behavioral Profile (MiroFish style) ─────────────────
  updateProfile(symbol, marketData, history) {
    if (!this.profiles[symbol]) {
      this.profiles[symbol] = {
        symbol,
        personality: '',
        patterns: [],
        currentState: '',
        observations: [],
        lastAIAnalysis: null,
        consensusHistory: []
      };
    }

    const p = this.profiles[symbol];
    const h = history || [];

    // Build personality from observed behavior
    if (h.length >= 50) {
      const changes = [];
      for (let i = 1; i < h.length; i++) {
        changes.push((h[i] - h[i-1]) / h[i-1] * 100);
      }
      
      const avgChange = changes.reduce((s,c) => s+c, 0) / changes.length;
      const volatility = Math.sqrt(changes.reduce((s,c) => s + (c - avgChange)**2, 0) / changes.length);
      const maxDrop = Math.min(...changes);
      const maxPump = Math.max(...changes);
      const recoveryCount = changes.filter((c, i) => i > 0 && c > 1 && changes[i-1] < -1).length;
      
      // Personality traits from observed data
      const traits = [];
      if (volatility > 3) traits.push('highly volatile');
      else if (volatility < 1) traits.push('stable');
      else traits.push('moderate volatility');
      
      if (recoveryCount > 3) traits.push('resilient (bounces back fast)');
      if (maxPump > 10) traits.push('capable of explosive moves');
      if (avgChange > 0.1) traits.push('bullish tendency');
      else if (avgChange < -0.1) traits.push('bearish tendency');
      else traits.push('range-bound');
      
      p.personality = traits.join(', ');
    }

    // Current state observation
    const price = marketData.price;
    const change = marketData.change;
    const warmth = marketData.warmth || 0;
    
    let state = '';
    if (Math.abs(change) < 0.5) state = 'quiet, low activity';
    else if (change > 3) state = 'strong pump, high momentum';
    else if (change > 1) state = 'gradual uptrend';
    else if (change < -3) state = 'heavy selling pressure';
    else if (change < -1) state = 'gradual downtrend';
    
    p.currentState = state;

    // Pattern recognition from history
    if (h.length >= 20) {
      const recent5 = h.slice(-5);
      const recent20 = h.slice(-20);
      const sma5 = recent5.reduce((s,p) => s+p, 0) / 5;
      const sma20 = recent20.reduce((s,p) => s+p, 0) / 20;
      
      if (sma5 > sma20 && h[h.length-2] < h[h.length-1]) {
        p.patterns.push('golden cross forming (bullish)');
      } else if (sma5 < sma20 && h[h.length-2] > h[h.length-1]) {
        p.patterns.push('death cross forming (bearish)');
      }
      
      // Keep last 5 patterns
      if (p.patterns.length > 5) p.patterns = p.patterns.slice(-5);
    }

    return p;
  }

  // ── Generate Market Snapshot for AI ────────────────────────────
  buildPrompt(symbol, profile, marketContext) {
    return `You are a professional crypto trader analyzing ${symbol}.

BEHAVIORAL PROFILE (built from observed data):
- Personality: ${profile.personality || 'insufficient data'}
- Current state: ${profile.currentState}
- Recent patterns: ${profile.patterns.slice(-3).join('; ') || 'none detected'}

MARKET DATA:
- Price: $${marketContext.price.toFixed(2)}
- 24h change: ${marketContext.change.toFixed(2)}%
- Warmth (B.O.S.S. momentum): ${(marketContext.warmth || 0).toFixed(3)}

MACRO CONTEXT:
- Market trend: ${marketContext.macroTrend || 'unknown'}
- USD strength: ${marketContext.usdTrend || 'unknown'}
- Prediction markets: ${marketContext.polyContext || 'no data'}
- Correlated assets: ${marketContext.correlations || 'none'}

TASK: Respond with EXACTLY one of these actions and a confidence 1-10:
FORMAT: ACTION|CONFIDENCE|ONE_LINE_REASON

Example: LONG|8|Strong bounce from support with rising volume
Example: SHORT|6|Bearish divergence forming on lower timeframe
Example: HOLD|7|No clear edge, waiting for confirmation

Your response:`;
  }

  // ── Query Single AI ───────────────────────────────────────────
  async queryAI(provider, prompt) {
    const key = this.apiKeys[provider];
    if (!key) return null;

    try {
      let response;
      
      if (provider === 'anthropic') {
        response = await this.callClaude(key, prompt);
      } else if (provider === 'openai') {
        response = await this.callGPT(key, prompt);
      } else if (provider === 'google') {
        response = await this.callGemini(key, prompt);
      }

      this.callCount++;
      this.costEstimate += 0.003; // ~$0.003 per call average

      // Parse response: ACTION|CONFIDENCE|REASON
      if (response) {
        const parts = response.trim().split('|');
        if (parts.length >= 3) {
          return {
            provider,
            action: parts[0].trim().toUpperCase(),
            confidence: parseInt(parts[1]) || 5,
            reason: parts.slice(2).join('|').trim()
          };
        }
      }
    } catch(e) {
      this.clog(`🧠 ${provider} error: ${e.message}`, 'log-err');
    }
    return null;
  }

  async callClaude(key, prompt) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return data.content?.[0]?.text;
  }

  async callGPT(key, prompt) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content;
  }

  async callGemini(key, prompt) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 50 }
      })
    });
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  }

  // ── Get Consensus from All AIs ────────────────────────────────
  async getConsensus(symbol, profile, marketContext) {
    const prompt = this.buildPrompt(symbol, profile, marketContext);
    
    // Query all available AIs in parallel
    const providers = Object.keys(this.apiKeys).filter(k => this.apiKeys[k]);
    if (providers.length === 0) {
      return { action: 'HOLD', confidence: 0, reason: 'No AI APIs configured', agreement: 0 };
    }

    const results = await Promise.all(
      providers.map(p => this.queryAI(p, prompt))
    );
    
    const valid = results.filter(r => r !== null);
    if (valid.length === 0) {
      return { action: 'HOLD', confidence: 0, reason: 'All AI calls failed', agreement: 0 };
    }

    // Count votes
    const votes = { LONG: 0, SHORT: 0, HOLD: 0 };
    const reasons = [];
    let totalConf = 0;

    for (const r of valid) {
      const action = r.action === 'BUY' ? 'LONG' : r.action === 'SELL' ? 'SHORT' : r.action;
      votes[action] = (votes[action] || 0) + 1;
      totalConf += r.confidence;
      reasons.push(`${r.provider}: ${r.action}(${r.confidence}) "${r.reason}"`);
    }

    // Determine consensus
    const totalVotes = valid.length;
    const avgConf = totalConf / totalVotes;
    let consensusAction = 'HOLD';
    let agreement = 0;

    if (votes.LONG > votes.SHORT && votes.LONG > votes.HOLD) {
      consensusAction = 'LONG';
      agreement = votes.LONG / totalVotes;
    } else if (votes.SHORT > votes.LONG && votes.SHORT > votes.HOLD) {
      consensusAction = 'SHORT';
      agreement = votes.SHORT / totalVotes;
    } else {
      consensusAction = 'HOLD';
      agreement = votes.HOLD / totalVotes;
    }

    // Grief protocol: if no clear majority, it's confusion
    const isGrief = agreement < 0.5 || 
      (votes.LONG > 0 && votes.SHORT > 0 && Math.abs(votes.LONG - votes.SHORT) <= 1);

    const consensus = {
      action: isGrief ? 'GRIEF' : consensusAction,
      confidence: isGrief ? 0 : avgConf,
      agreement: agreement,
      reason: isGrief 
        ? `AI DISAGREEMENT: ${reasons.join(' vs ')}`
        : `${Math.round(agreement * 100)}% consensus: ${reasons.join(' | ')}`,
      votes,
      details: valid,
      isGrief
    };

    // Log
    const emoji = consensus.action === 'LONG' ? '🟢' :
                  consensus.action === 'SHORT' ? '🔴' :
                  consensus.action === 'GRIEF' ? '⚠️' : '⚪';
    this.clog(
      `${emoji} ${symbol} AI: ${consensus.action} (${Math.round(agreement*100)}% agree, conf:${avgConf.toFixed(0)})`,
      consensus.isGrief ? 'log-grief' : 'log-bond'
    );

    // Store
    this.lastConsensus[symbol] = consensus;
    profile.lastAIAnalysis = consensus;
    profile.consensusHistory.push({ time: Date.now(), ...consensus });
    if (profile.consensusHistory.length > 50) profile.consensusHistory.shift();

    return consensus;
  }

  // ── Convert Consensus to Warmth Modifier ──────────────────────
  getWarmthModifier(symbol) {
    const c = this.lastConsensus[symbol];
    if (!c) return 0;

    // Strong agreement boosts warmth, grief reduces it
    if (c.isGrief) return -0.5; // cool down the node
    
    const directionMultiplier = c.action === 'LONG' ? 1 : c.action === 'SHORT' ? -1 : 0;
    return directionMultiplier * c.agreement * (c.confidence / 10) * 0.5;
  }

  getStatus() {
    return {
      calls: this.callCount,
      cost: this.costEstimate,
      providers: Object.keys(this.apiKeys).filter(k => this.apiKeys[k]).length,
      profiles: Object.keys(this.profiles).length,
      lastConsensus: { ...this.lastConsensus }
    };
  }
}

if (typeof module !== 'undefined') module.exports = { AIConsensusEngine };
