/* ══════════════════════════════════════════════════════════════════
   B.O.S.S. AI TIERS — Freemium + BYOK Model
   
   Free:     Math-only signals (warmth, EMA, RSI). No AI thinking.
   Premium:  B.O.S.S. shared AI pool (we pay, included in subscription)
   BYOK:     User provides own API keys. Unlimited AI calls.
   ══════════════════════════════════════════════════════════════════ */

const AI_TIERS = {
  
  free: {
    name: '🆓 FREE — Math Engine Only',
    description: 'Warmth × Match signals, EMA crossovers, RSI filter. No AI reasoning.',
    aiCalls: 0,
    features: ['Real-time market data', 'B.O.S.S. warmth physics', 'Grief protocol', 'Basic signals'],
    limitations: ['No AI thinking', 'No behavioral profiles', 'No consensus engine'],
    price: 0
  },

  premium: {
    name: '⭐ PREMIUM — B.O.S.S. AI Pool',
    description: 'Shared AI thinking. B.O.S.S. handles API costs. Limited calls per day.',
    aiCallsPerDay: 50,    // ~50 calls/day = covers 25 coin checks × 2 per day
    features: [
      'Everything in Free',
      'AI behavioral profiles per coin',
      'Consensus engine (2 AI models)',
      'MiroFish pattern recognition',
      'Macro context analysis',
      '50 AI calls/day included'
    ],
    limitations: ['2 AI models (not 3)', '50 calls/day cap', 'Shared pool — may be slower in peak hours'],
    price: 29, // EUR/month — included in subscription
    models: ['claude-haiku-4-5-20251001', 'gemini-2.0-flash']
  },

  byok: {
    name: '🔑 BYOK — Bring Your Own Keys',
    description: 'User provides their own API keys. Unlimited calls. All 3 AI models.',
    aiCallsPerDay: Infinity,
    features: [
      'Everything in Premium',
      'ALL 3 AI models (Claude + GPT + Gemini)',
      'Unlimited AI calls',
      'Full consensus engine (3/3 voting)',
      'Priority analysis',
      'Custom model selection',
      'User pays their own API costs (~$20-50/mo)'
    ],
    limitations: ['User manages own API keys and costs'],
    price: 0, // No extra charge — they're paying API providers directly
    models: ['claude-haiku-4-5-20251001', 'gpt-4o-mini', 'gemini-2.0-flash'],
    upgradableModels: {
      anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
      openai: ['gpt-4o-mini', 'gpt-4o'],
      google: ['gemini-2.0-flash', 'gemini-2.5-pro']
    }
  }
};

class AITierManager {
  constructor(consensusEngine, clog) {
    this.engine = consensusEngine;
    this.clog = clog;
    this.currentTier = 'free';
    this.dailyCalls = 0;
    this.dayStart = Date.now();
    this.userKeys = {};   // BYOK keys stored locally, never sent to our servers
  }

  setTier(tier) {
    if (!AI_TIERS[tier]) return false;
    this.currentTier = tier;
    this.clog(`🧠 AI Tier: ${AI_TIERS[tier].name}`, 'log-bond');
    return true;
  }

  // BYOK — user provides their own key
  setUserKey(provider, key) {
    this.userKeys[provider] = key;
    this.engine.setKey(provider, key);
    this.currentTier = 'byok';
    this.clog(`🔑 ${provider} key set — BYOK mode active`, 'log-bond');
    
    // Store encrypted in localStorage (never leaves the device)
    try {
      const stored = JSON.parse(localStorage.getItem('BOSS_BYOK') || '{}');
      stored[provider] = btoa(key); // base64 encode (not true encryption — needs improvement)
      localStorage.setItem('BOSS_BYOK', JSON.stringify(stored));
    } catch(e) {}
  }

  // Load saved BYOK keys
  loadSavedKeys() {
    try {
      const stored = JSON.parse(localStorage.getItem('BOSS_BYOK') || '{}');
      let loaded = 0;
      for (const [provider, encoded] of Object.entries(stored)) {
        const key = atob(encoded);
        this.engine.setKey(provider, key);
        this.userKeys[provider] = key;
        loaded++;
      }
      if (loaded > 0) {
        this.currentTier = 'byok';
        this.clog(`🔑 Loaded ${loaded} saved API keys — BYOK mode`, 'log-sys');
      }
      return loaded;
    } catch(e) { return 0; }
  }

  // Check if AI call is allowed
  canCallAI() {
    const tier = AI_TIERS[this.currentTier];
    if (!tier) return false;
    if (tier.aiCalls === 0) return false;

    // Reset daily counter
    if (Date.now() - this.dayStart > 86400000) {
      this.dailyCalls = 0;
      this.dayStart = Date.now();
    }

    if (this.currentTier === 'byok') return true;
    if (this.currentTier === 'premium') return this.dailyCalls < tier.aiCallsPerDay;
    return false;
  }

  // Get consensus with tier-appropriate number of AIs
  async getConsensus(symbol, profile, context) {
    if (!this.canCallAI()) {
      return { action: 'HOLD', confidence: 0, reason: 'AI not available on current tier', agreement: 0 };
    }

    this.dailyCalls++;
    return await this.engine.getConsensus(symbol, profile, context);
  }

  getStatus() {
    const tier = AI_TIERS[this.currentTier];
    return {
      tier: this.currentTier,
      tierName: tier.name,
      dailyCalls: this.dailyCalls,
      dailyLimit: tier.aiCallsPerDay || 0,
      providers: Object.keys(this.userKeys).length,
      engineStatus: this.engine.getStatus()
    };
  }
}

if (typeof module !== 'undefined') module.exports = { AI_TIERS, AITierManager };
