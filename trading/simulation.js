/* ══════════════════════════════════════════════════════════════════════
   B.O.S.S. TRADING SIMULATION — Run with real market data, fake money
   Node.js script — run from terminal
   ══════════════════════════════════════════════════════════════════════ */

const https = require('https');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────
const INITIAL_BALANCE = 28.5; // ~50 EUR in TON at current rates
const TICK_INTERVAL = 15000;  // 15 seconds
const SIM_DURATION = 600000;  // 10 minutes simulation

// ── Simple fetch ────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'BOSS/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Market Data ─────────────────────────────────────────────────────
const priceHistory = {};

async function fetchCrypto() {
  const coins = 'bitcoin,ethereum,solana,dogecoin,cardano,ripple,polkadot,avalanche-2,chainlink,toncoin';
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
  const data = await fetchJSON(url);
  
  const results = {};
  for (const [id, info] of Object.entries(data)) {
    if (typeof info !== "object" || !info.usd) continue;
    const symbol = id.toUpperCase();
    const price = info.usd || 0;
    const change = info.usd_24h_change || 0;
    const volume = info.usd_24h_vol || 0;
    const momentum = Math.abs(change) / 10;

    // Track micro-movements
    if (!priceHistory[symbol]) priceHistory[symbol] = [];
    priceHistory[symbol].push(price);
    if (priceHistory[symbol].length > 20) priceHistory[symbol].shift();

    // Calculate short-term momentum from last 3 ticks
    let shortMomentum = 0;
    const h = priceHistory[symbol];
    if (h.length >= 3) {
      const recent = (h[h.length-1] - h[h.length-3]) / h[h.length-3] * 100;
      shortMomentum = Math.abs(recent);
    }

    results[symbol] = {
      symbol, price, change, volume, momentum,
      shortMomentum,
      direction: change > 0 ? 'BULL' : 'BEAR',
      warmth: momentum + shortMomentum
    };
  }
  return results;
}

// ── Simulation State ────────────────────────────────────────────────
let balance = INITIAL_BALANCE;
const positions = {};
const trades = [];
let totalTrades = 0;
let wins = 0;
let losses = 0;
let griefActive = false;
let griefUntil = 0;
let tradesThisHour = 0;
let lastTradeTime = 0;

const CONFIG = {
  maxPositionPct: 0.20,
  maxTotalExposure: 0.60,
  stopLossPct: 0.05,
  takeProfitPct: 0.10,
  dailyLossLimit: 0.10,
  minWarmth: 0.1,
  maxTradesPerHour: 6,
  minTimeBetweenTrades: 30000,
  griefCooldown: 120000,
};

// ── Trading Logic ───────────────────────────────────────────────────
function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${msg}`);
}

function checkPositions(markets) {
  for (const [symbol, pos] of Object.entries(positions)) {
    const market = markets[symbol];
    if (!market) continue;

    const pnlPct = (market.price - pos.entryPrice) / pos.entryPrice;
    const pnlTON = pos.amount * pnlPct;

    // Stop loss
    if (pnlPct <= -CONFIG.stopLossPct) {
      log(`🔴 STOP LOSS: ${symbol} ${(pnlPct*100).toFixed(1)}% → ${pnlTON.toFixed(3)} TON`);
      balance += pos.amount + pnlTON;
      trades.push({ symbol, type: 'SELL', reason: 'stop_loss', pnl: pnlTON, pnlPct });
      losses++;
      totalTrades++;
      delete positions[symbol];
      continue;
    }

    // Take profit
    if (pnlPct >= CONFIG.takeProfitPct) {
      log(`🟢 TAKE PROFIT: ${symbol} +${(pnlPct*100).toFixed(1)}% → +${pnlTON.toFixed(3)} TON`);
      balance += pos.amount + pnlTON;
      trades.push({ symbol, type: 'SELL', reason: 'take_profit', pnl: pnlTON, pnlPct });
      wins++;
      totalTrades++;
      delete positions[symbol];
      continue;
    }

    // Warmth decay — signal cooling, lock profits
    if (market.warmth < 0.3 && pnlPct > 0.02) {
      log(`🟡 WARMTH EXIT: ${symbol} cooling, locking +${(pnlPct*100).toFixed(1)}%`);
      balance += pos.amount + pnlTON;
      trades.push({ symbol, type: 'SELL', reason: 'warmth_decay', pnl: pnlTON, pnlPct });
      wins++;
      totalTrades++;
      delete positions[symbol];
      continue;
    }
  }
}

function scanOpportunities(markets) {
  const now = Date.now();

  if (griefActive && now < griefUntil) return;
  if (tradesThisHour >= CONFIG.maxTradesPerHour) return;
  if (now - lastTradeTime < CONFIG.minTimeBetweenTrades) return;

  // Daily loss check — include position value
  const totalValue = balance + Object.values(positions).reduce((s, p) => s + p.amount, 0);
  if (totalValue < INITIAL_BALANCE * (1 - CONFIG.dailyLossLimit)) {
    log('🛑 DAILY LOSS LIMIT — engine stopped');
    return;
  }

  // Check for contradictions (grief)
  const bulls = Object.values(markets).filter(m => m.direction === 'BULL' && m.warmth > 1);
  const bears = Object.values(markets).filter(m => m.direction === 'BEAR' && m.warmth > 1);
  if (bulls.length > 3 && bears.length > 3) {
    griefActive = true;
    griefUntil = now + CONFIG.griefCooldown;
    log(`⚠️ GRIEF PROTOCOL: ${bulls.length} bull vs ${bears.length} bear — conflicting signals. Pausing 2min.`);
    // Close all positions
    for (const [symbol, pos] of Object.entries(positions)) {
      const market = markets[symbol];
      if (market) {
        const pnlPct = (market.price - pos.entryPrice) / pos.entryPrice;
        const pnlTON = pos.amount * pnlPct;
        balance += pos.amount + pnlTON;
        trades.push({ symbol, type: 'SELL', reason: 'grief', pnl: pnlTON, pnlPct });
        if (pnlTON > 0) wins++; else losses++;
        totalTrades++;
      }
      delete positions[symbol];
    }
    return;
  }
  griefActive = false;

  // Total exposure check
  const totalExposure = Object.values(positions).reduce((s, p) => s + p.amount, 0);
  if (totalExposure >= balance * CONFIG.maxTotalExposure) return;

  // Find best opportunity
  const candidates = Object.values(markets)
    .filter(m => m.direction === 'BULL' && m.warmth >= CONFIG.minWarmth && !positions[m.symbol])
    .sort((a, b) => b.warmth - a.warmth);

  if (candidates.length > 0) {
    const best = candidates[0];
    const posSize = balance * CONFIG.maxPositionPct;

    log(`🟢 BUY: ${best.symbol} — warmth:${best.warmth.toFixed(2)} change:${best.change.toFixed(1)}% @ $${best.price.toFixed(2)}`);
    
    positions[best.symbol] = {
      amount: posSize,
      entryPrice: best.price,
      timestamp: now
    };
    
    balance -= posSize;
    lastTradeTime = now;
    tradesThisHour++;
    trades.push({ symbol: best.symbol, type: 'BUY', amount: posSize, price: best.price });
  }
}

// ── Print Status ────────────────────────────────────────────────────
function printStatus(markets) {
  const openPnL = Object.entries(positions).reduce((sum, [sym, pos]) => {
    const market = markets[sym];
    if (!market) return sum;
    return sum + pos.amount * ((market.price - pos.entryPrice) / pos.entryPrice);
  }, 0);

  const totalValue = balance + Object.values(positions).reduce((s, p) => s + p.amount, 0) + openPnL;
  const netPnL = totalValue - INITIAL_BALANCE;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(0) : 0;

  console.log('\n' + '═'.repeat(60));
  console.log(`  B.O.S.S. TRADING SIMULATION`);
  console.log('─'.repeat(60));
  console.log(`  Balance:     ${balance.toFixed(3)} TON`);
  console.log(`  Open pos:    ${Object.keys(positions).length}`);
  console.log(`  Open P&L:    ${openPnL >= 0 ? '+' : ''}${openPnL.toFixed(3)} TON`);
  console.log(`  Total value: ${totalValue.toFixed(3)} TON`);
  console.log(`  Net P&L:     ${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(3)} TON (${((netPnL/INITIAL_BALANCE)*100).toFixed(1)}%)`);
  console.log(`  Trades:      ${totalTrades} (W:${wins} L:${losses} WR:${winRate}%)`);
  console.log(`  Grief:       ${griefActive ? 'ACTIVE' : 'clear'}`);
  
  // Show open positions
  if (Object.keys(positions).length > 0) {
    console.log('─'.repeat(60));
    for (const [sym, pos] of Object.entries(positions)) {
      const market = markets[sym];
      const pnl = market ? ((market.price - pos.entryPrice) / pos.entryPrice * 100).toFixed(1) : '?';
      console.log(`  📊 ${sym}: ${pos.amount.toFixed(2)} TON @ $${pos.entryPrice.toFixed(2)} (${pnl}%)`);
    }
  }

  // Top 5 warmest markets
  console.log('─'.repeat(60));
  console.log('  🔥 Hottest signals:');
  Object.values(markets)
    .sort((a, b) => b.warmth - a.warmth)
    .slice(0, 5)
    .forEach(m => {
      const dir = m.direction === 'BULL' ? '↑' : '↓';
      console.log(`     ${dir} ${m.symbol.padEnd(15)} warmth:${m.warmth.toFixed(2)} change:${m.change.toFixed(1)}%`);
    });
  console.log('═'.repeat(60) + '\n');
}

// ── Main Loop ───────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  B.O.S.S. TRADING SIMULATION');
  console.log(`  Starting balance: ${INITIAL_BALANCE} TON (~50 EUR)`);
  console.log(`  Duration: ${SIM_DURATION/60000} minutes`);
  console.log(`  Risk: ${CONFIG.maxPositionPct*100}% max pos, ${CONFIG.stopLossPct*100}% SL, ${CONFIG.takeProfitPct*100}% TP`);
  console.log('═'.repeat(60) + '\n');

  const startTime = Date.now();
  let tick = 0;

  const interval = setInterval(async () => {
    tick++;
    
    if (Date.now() - startTime > SIM_DURATION) {
      clearInterval(interval);
      log('⏱️ Simulation complete');
      const markets = await fetchCrypto();
      printStatus(markets);
      
      // Final summary
      const totalValue = balance + Object.values(positions).reduce((s, p) => s + p.amount, 0);
      const netPnL = totalValue - INITIAL_BALANCE;
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  FINAL RESULT: ${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(3)} TON (${((netPnL/INITIAL_BALANCE)*100).toFixed(2)}%)`);
      console.log(`${'═'.repeat(60)}\n`);
      return;
    }

    try {
      const markets = await fetchCrypto();
      checkPositions(markets);
      scanOpportunities(markets);
      
      // Print status every 5 ticks
      if (tick % 4 === 0) printStatus(markets);
    } catch(e) {
      log(`Error: ${e.message}`);
    }
  }, TICK_INTERVAL);
}

main();
