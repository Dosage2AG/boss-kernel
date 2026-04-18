# B.O.S.S. Trading Engine — v2 Upgrade Notes
**Date:** 2026-04-18  
**Source:** "AI-Powered Prediction Market Trading Bot Using Claude Skills" + boss-kernel v1

---

## What Changed and Why

### Problem with v1
v1 used a fixed `maxPositionPct = 0.20` for every trade. This is dangerous. A 70% win probability trade and a 51% win probability trade got the same size bet. That's not trading — it's gambling.

v1 also had no memory. Every loss was forgotten. The same bad trades could repeat forever.

### What v2 Adds

---

## New Files

### `trading/kelly.js` — Kelly Criterion Position Sizer
Replaces fixed % sizing with mathematically optimal bet sizing.

**Formula:**
```
f* = (p * b - q) / b   [Full Kelly]
f_use = f* × 0.25      [Quarter-Kelly, used by default]
```
- `p` = your win probability
- `b` = net odds (reward / risk)
- `q` = 1 - p

**Why Quarter-Kelly?** Full Kelly is theoretically optimal but creates violent drawdowns. Quarter-Kelly produces ~75% of the long-run growth with dramatically less variance. Most professional quant funds use fractional Kelly.

**Gates built in:**
- Edge must be > 4% or trade is blocked
- Expected value must be positive
- Drawdown > 8% blocks all new trades
- Open positions > 15 blocks new trades
- AI API cost > $50/day blocks new trades

---

### `trading/calibration.js` — Brier Score + Performance Tracker
Tracks every AI prediction against actual outcome. Tells you if your model is actually better than the market.

**Metrics tracked:**
| Metric | Formula | Target |
|--------|---------|--------|
| Brier Score | avg((predicted - outcome)²) | < 0.25 |
| Win Rate | wins / total trades | 60%+ |
| Sharpe Ratio | mean(pnl) / std(pnl) × √252 | > 2.0 |
| Profit Factor | gross profit / gross loss | > 1.5 |
| Max Drawdown | largest peak-to-trough | < 8% |

**Calibration Curve:** Groups predictions by decile (0-10%, 10-20%, etc.) and shows whether your 70% predictions actually win 70% of the time. A well-calibrated model tracks near the diagonal.

**Persists to:** `calibration_log.json`

---

### `trading/compound.js` — Post-Mortem Learning Engine
After every loss, automatically classifies what went wrong and saves a lesson. Future trades avoid the same patterns.

**Failure classes:**
1. `BAD_PREDICTION` — model probability was wrong (most common)
2. `BAD_TIMING` — right direction, entered too early
3. `BAD_EXECUTION` — slippage exceeded 2%, fills were bad
4. `EXTERNAL_SHOCK` — unforeseeable news event
5. `GRIEF_SPIRAL` — traded during active grief protocol (should never happen)

**Nightly consolidation:** Prunes expired forbidden patterns, escalates repeat offenders (same failure class 3+ times → 90-day ban instead of 30-day).

**Persists to:** `failure_log.json` + `knowledge_base.json`

---

### `trading/edge.js` — Market Edge Calculator
For prediction markets: the only reason to trade is when you know something the market doesn't.

**Core formula:**
```
edge = p_model - p_market
```
Only trade when `edge > 0.04` (4%).

**Weighted probability model** (inspired by ryanfrigo/kalshi-ai-trading-bot):
| Source | Weight | Role |
|--------|--------|------|
| B.O.S.S. Resonance | 30% | Warmth-based price intuition (proprietary) |
| Claude Sonnet | 20% | News analyst |
| GPT-4o-mini | 20% | Bull case advocate |
| Gemini Flash | 15% | Bear case advocate |
| Polymarket crowd | 15% | Cross-reference baseline |

**B.O.S.S. gets the highest weight** because the resonance field is your actual proprietary edge. The AIs are confirmation.

**Mispricing Z-score:**
```
delta = (p_model - p_market) / stdDev
```
Higher = stronger signal. Uses rolling 50-trade std dev of historical edges.

---

### `trading/trading-engine-v2.js` — Upgraded Engine
Drop-in upgrade from `trading-engine.js`. Same biological metaphors, all new internals.

**New safety systems:**

| Feature | Detail |
|---------|--------|
| Kill Switch | Create a file named `STOP` in the trading dir → halts immediately |
| Drawdown Block | > 8% drawdown → no new trades (calibration also tracks this) |
| Slippage Abort | Price moves > 2% between signal and fill → abort |
| AI Cost Cap | $50/day maximum on API calls |
| Prompt Injection Defense | All external data sanitized + clamped before use |
| Grief Protocol | Still works — closes all positions and cools down 5 min |

**Integration:**
```javascript
const { BossTraderV2 } = require('./trading/trading-engine-v2');
const { AIConsensusEngine } = require('./trading/ai-consensus');

const trader = new BossTraderV2(wallet, marketBridge, clog);
const ai = new AIConsensusEngine(clog);
ai.setKey('anthropic', process.env.ANTHROPIC_KEY);
ai.setKey('openai', process.env.OPENAI_KEY);
ai.setKey('google', process.env.GOOGLE_KEY);

trader.setAI(ai);
await trader.start(1000); // starting balance
```

---

## What Was NOT Changed

- `trading-engine.js` (v1) — left intact. v2 is additive, not destructive.
- `ai-consensus.js` — works as-is, now wired into v2
- `strategies.js` — still valid as config presets
- Backtest files — unchanged

---

## Reference Metrics (from PDF backtest)

The reference implementation from Anthropic's architecture guide achieved:
- **68.4% win rate**
- **2.14 Sharpe ratio**
- **-4.2% max drawdown**
- **312 trades over 90 days**

These are backtest numbers, not live trading. Use them as calibration targets, not guarantees.

---

## Next Steps (Still To Do)

1. **Kalshi integration** — `edge.js` is ready for prediction market p_market feeds, but needs the Kalshi REST API wired in
2. **Polymarket CLOB execution** — `POLYMARKET_OBSERVER.md` has the observer; actual trading requires EIP-712 signing
3. **Binance WebSocket** — millisecond data vs 30s polling (ROADMAP.md line 136)
4. **Paper trading mode** — run v2 in simulation for 2 weeks before going live with real funds
5. **AI consensus → universe.html** — wire Strategist/BOSS tier into the visual interface (ROADMAP.md line 91)

---

## Risk Warning

Do not trade real money until you have:
- [ ] 50+ paper trades with verified Brier Score < 0.25
- [ ] Calibration curve tracking near diagonal
- [ ] At least one full nightly consolidation cycle
- [ ] Kill switch tested (create STOP, verify halt)
- [ ] Started with ≤$500 max total exposure

*"The goal is not to get rich on the first day. The goal is to not blow up."*
