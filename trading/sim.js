/* B.O.S.S. Trading Simulation v2 — with Strategy Selector */
const https = require('https');
const { STRATEGIES } = require('./strategies.js');

// ── Strategy Selection ──────────────────────────────────────────────
const strategyName = process.argv[2] || 'scalp';
const CONFIG = STRATEGIES[strategyName];
if (!CONFIG) {
  console.log('Available strategies:', Object.keys(STRATEGIES).join(', '));
  process.exit(1);
}

const INITIAL_BALANCE = 28.5;
const TICK_INTERVAL = CONFIG.minTimeBetweenTrades || 15000;
const SIM_DURATION = 600000; // 10 minutes

// ── Fetch ───────────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BOSS/1.0' } }, res => {
      let d = ''; 
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const priceHistory = {};

async function fetchMarkets() {
  const coins = 'bitcoin,ethereum,solana,dogecoin,cardano,ripple,polkadot,avalanche-2,chainlink,toncoin';
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=usd&include_24hr_change=true`;
  const data = await fetchJSON(url);
  const results = {};

  for (const [id, info] of Object.entries(data)) {
    if (typeof info !== 'object' || !info.usd) continue;
    const symbol = id.toUpperCase();
    const price = info.usd;
    const change = info.usd_24h_change || 0;
    const momentum = Math.abs(change) / 10;

    if (!priceHistory[symbol]) priceHistory[symbol] = [];
    priceHistory[symbol].push(price);
    if (priceHistory[symbol].length > 30) priceHistory[symbol].shift();

    // Short-term micro momentum (last 3 ticks)
    let shortMom = 0;
    const h = priceHistory[symbol];
    if (h.length >= 2) {
      shortMom = Math.abs((h[h.length-1] - h[h.length-2]) / h[h.length-2] * 100);
    }

    results[symbol] = {
      symbol, price, change, momentum,
      shortMomentum: shortMom,
      direction: change > 0 ? 'BULL' : 'BEAR',
      warmth: momentum + shortMom * 5  // amplify short-term for scalping
    };
  }
  return results;
}

// ── State ───────────────────────────────────────────────────────────
let balance = INITIAL_BALANCE;
const positions = {};
const trades = [];
let wins = 0, losses = 0;
let griefUntil = 0;
let tradesThisHour = 0;
let lastTradeTime = 0;
let hourStart = Date.now();
let postGrief = false;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ── Check Positions ─────────────────────────────────────────────────
function checkPositions(markets) {
  for (const [symbol, pos] of Object.entries(positions)) {
    const m = markets[symbol];
    if (!m) continue;
    const pnlPct = (m.price - pos.entryPrice) / pos.entryPrice;
    const pnlTON = pos.amount * pnlPct;

    if (pnlPct <= -CONFIG.stopLossPct) {
      log(`🔴 STOP LOSS: ${symbol} ${(pnlPct*100).toFixed(2)}% → ${pnlTON.toFixed(3)} TON`);
      balance += pos.amount + pnlTON; losses++; 
      trades.push({ symbol, pnl: pnlTON, reason: 'SL' });
      delete positions[symbol]; continue;
    }
    if (pnlPct >= CONFIG.takeProfitPct) {
      log(`🟢 TAKE PROFIT: ${symbol} +${(pnlPct*100).toFixed(2)}% → +${pnlTON.toFixed(3)} TON`);
      balance += pos.amount + pnlTON; wins++;
      trades.push({ symbol, pnl: pnlTON, reason: 'TP' });
      delete positions[symbol]; continue;
    }
    if (m.warmth < CONFIG.warmthDecayExit && pnlPct > 0.005) {
      log(`🟡 WARMTH EXIT: ${symbol} +${(pnlPct*100).toFixed(2)}% (signal cooling)`);
      balance += pos.amount + pnlTON; wins++;
      trades.push({ symbol, pnl: pnlTON, reason: 'WD' });
      delete positions[symbol]; continue;
    }
  }
}

// ── Scan Opportunities ──────────────────────────────────────────────
function scanOpportunities(markets) {
  const now = Date.now();
  if (now < griefUntil) { postGrief = true; return; }
  if (now - hourStart > 3600000) { hourStart = now; tradesThisHour = 0; }
  if (tradesThisHour >= CONFIG.maxTradesPerHour) return;
  if (now - lastTradeTime < CONFIG.minTimeBetweenTrades) return;

  const totalVal = balance + Object.values(positions).reduce((s,p) => s + p.amount, 0);
  if (totalVal < INITIAL_BALANCE * (1 - CONFIG.dailyLossLimit)) {
    log('🛑 DAILY LOSS LIMIT'); return;
  }

  // Grief check
  const bulls = Object.values(markets).filter(m => m.direction === 'BULL' && m.warmth > 0.1);
  const bears = Object.values(markets).filter(m => m.direction === 'BEAR' && m.warmth > 0.1);
  if (bulls.length >= 4 && bears.length >= 4) {
    griefUntil = now + CONFIG.griefCooldown;
    log(`⚠️ GRIEF: ${bulls.length} bull vs ${bears.length} bear — pausing ${CONFIG.griefCooldown/1000}s`);
    return;
  }

  // Grief Hunter: only enter after grief
  if (CONFIG.griefEntryMode && !postGrief) return;

  const totalExposure = Object.values(positions).reduce((s,p) => s + p.amount, 0);
  if (totalExposure >= balance * CONFIG.maxTotalExposure) return;

  // Find candidates
  let candidates = Object.values(markets)
    .filter(m => m.warmth >= CONFIG.minWarmth && !positions[m.symbol]);
  
  if (!CONFIG.buyBearish) {
    candidates = candidates.filter(m => m.direction === 'BULL');
  }

  candidates.sort((a, b) => b.warmth - a.warmth);

  if (candidates.length > 0) {
    const best = candidates[0];
    const posSize = Math.min(balance * CONFIG.maxPositionPct, balance * 0.95);
    if (posSize < 0.1) return;

    log(`🟢 BUY: ${best.symbol} — w:${best.warmth.toFixed(3)} ${best.direction} ${best.change.toFixed(1)}% @ $${best.price.toFixed(2)}`);
    positions[best.symbol] = { amount: posSize, entryPrice: best.price, timestamp: now };
    balance -= posSize;
    lastTradeTime = now;
    tradesThisHour++;
    postGrief = false;
  }
}

// ── Status ──────────────────────────────────────────────────────────
function printStatus(markets) {
  const openPnL = Object.entries(positions).reduce((sum, [sym, pos]) => {
    const m = markets[sym];
    return m ? sum + pos.amount * ((m.price - pos.entryPrice) / pos.entryPrice) : sum;
  }, 0);
  const totalVal = balance + Object.values(positions).reduce((s,p) => s + p.amount, 0) + openPnL;
  const netPnL = totalVal - INITIAL_BALANCE;
  const totalTrades = wins + losses;
  const wr = totalTrades > 0 ? (wins/totalTrades*100).toFixed(0) : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${CONFIG.name}`);
  console.log('─'.repeat(60));
  console.log(`  Balance:     ${balance.toFixed(3)} TON (free)`);
  console.log(`  Positions:   ${Object.keys(positions).length} open`);
  console.log(`  Open P&L:    ${openPnL >= 0 ? '+' : ''}${openPnL.toFixed(4)} TON`);
  console.log(`  Total value: ${totalVal.toFixed(3)} TON`);
  console.log(`  Net P&L:     ${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(4)} TON (${((netPnL/INITIAL_BALANCE)*100).toFixed(2)}%)`);
  console.log(`  Trades:      ${totalTrades} (W:${wins} L:${losses} WR:${wr}%)`);
  console.log(`  Grief:       ${Date.now() < griefUntil ? 'ACTIVE' : 'clear'}`);

  for (const [sym, pos] of Object.entries(positions)) {
    const m = markets[sym];
    const pnl = m ? ((m.price - pos.entryPrice) / pos.entryPrice * 100).toFixed(2) : '?';
    console.log(`  📊 ${sym}: ${pos.amount.toFixed(2)} TON @ $${pos.entryPrice.toFixed(2)} (${pnl}%)`);
  }

  console.log('─'.repeat(60));
  const sorted = Object.values(markets).sort((a,b) => b.warmth - a.warmth).slice(0,5);
  sorted.forEach(m => {
    const dir = m.direction === 'BULL' ? '↑' : '↓';
    console.log(`  ${dir} ${m.symbol.padEnd(15)} w:${m.warmth.toFixed(3)} ${m.change.toFixed(1)}% $${m.price.toFixed(2)}`);
  });
  console.log('═'.repeat(60) + '\n');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(`  B.O.S.S. SIMULATION — ${CONFIG.name}`);
  console.log(`  ${CONFIG.description}`);
  console.log(`  Balance: ${INITIAL_BALANCE} TON | Duration: ${SIM_DURATION/60000}min`);
  console.log(`  SL:${(CONFIG.stopLossPct*100)}% TP:${(CONFIG.takeProfitPct*100)}% MaxPos:${(CONFIG.maxPositionPct*100)}%`);
  console.log('═'.repeat(60) + '\n');

  const start = Date.now();
  let tick = 0;

  const interval = setInterval(async () => {
    tick++;
    if (Date.now() - start > SIM_DURATION) {
      clearInterval(interval);
      log('⏱️ Simulation complete');
      const markets = await fetchMarkets();
      printStatus(markets);

      // Close remaining positions for final P&L
      for (const [sym, pos] of Object.entries(positions)) {
        const m = markets[sym];
        if (m) {
          const pnl = pos.amount * ((m.price - pos.entryPrice) / pos.entryPrice);
          balance += pos.amount + pnl;
          if (pnl > 0) wins++; else losses++;
          log(`📤 CLOSED: ${sym} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} TON (end of sim)`);
        }
        delete positions[sym];
      }

      const finalPnL = balance - INITIAL_BALANCE;
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  FINAL: ${finalPnL >= 0 ? '+' : ''}${finalPnL.toFixed(4)} TON (${((finalPnL/INITIAL_BALANCE)*100).toFixed(2)}%)`);
      console.log(`  Trades: ${wins+losses} | Wins: ${wins} | Losses: ${losses} | WR: ${wins+losses>0?(wins/(wins+losses)*100).toFixed(0):0}%`);
      console.log(`${'═'.repeat(60)}\n`);
      return;
    }

    try {
      const markets = await fetchMarkets();
      checkPositions(markets);
      scanOpportunities(markets);
      if (tick % 3 === 0) printStatus(markets);
    } catch(e) { log(`Error: ${e.message}`); }
  }, TICK_INTERVAL);
}

main();
