# B.O.S.S. Telegram Mini App — Setup Guide

## Step 1: Create your Telegram Bot

1. Open Telegram → search `@BotFather`
2. Send `/newbot`
3. Name it: `B.O.S.S. Universe`
4. Username: `boss_universe_bot` (or whatever is available)
5. BotFather gives you a **bot token** — save it (looks like `7123456789:AAF...`)

## Step 2: Create your B.O.S.S. Revenue Wallet

1. Install **Tonkeeper** or **MyTonWallet** on your phone
2. Create a NEW wallet — specifically for B.O.S.S. revenue (not your main wallet)
3. Copy the wallet address (starts with `UQ` or `EQ`)
4. Open `telegram/miniapp.html`
5. Find this line: `var REVENUE_WALLET = 'YOUR_BOSS_REVENUE_WALLET_ADDRESS_HERE';`
6. Replace with your actual address

## Step 3: Host the Mini App

The Mini App must be at a public HTTPS URL. Options:

**Easiest (free): GitHub Pages**
```bash
cd boss-kernel
git add telegram/
git commit -m "Add Telegram Mini App"
git push origin main
# Enable GitHub Pages in repo settings → source: main branch
# URL becomes: https://dosage2ag.github.io/boss-kernel/telegram/miniapp.html
```

**Alternative: Netlify**
- Drag the `boss-kernel` folder to netlify.com/drop
- Get instant HTTPS URL

## Step 4: Register Mini App with BotFather

```
/newapp  ← in BotFather
→ Select your bot
→ Title: B.O.S.S. Universe
→ Description: Biological trading intelligence
→ Photo: upload any image
→ Web App URL: https://dosage2ag.github.io/boss-kernel/telegram/miniapp.html
```

## Step 5: Add Launch Button to Bot

Send BotFather:
```
/setmenubutton
→ Select your bot
→ Button text: 🚀 Open B.O.S.S.
→ URL: https://dosage2ag.github.io/boss-kernel/telegram/miniapp.html
```

## Step 6: Configure Bot Commands (Optional)

```
/setcommands → your bot →
start - Open B.O.S.S. Universe
trade - View trading signals
wallet - Connect TON wallet
tier - Upgrade your tier
```

## How Payments Work

1. User opens Mini App → taps ACCOUNT tab → selects tier
2. If not connected: TON Connect wallet popup appears
3. User connects wallet (Tonkeeper, MyTonWallet, etc.)
4. Payment confirmation screen shows amount in TON
5. User approves → TON sent directly to your revenue wallet
6. Tier unlocked immediately, saved by wallet address

**Tier prices (set in miniapp.html `TIER_PRICES`):**
- Explorer: 5 TON/month (~€29)
- Trader: 16 TON/month (~€99)
- Strategist: 50 TON/month (~€299)

## What's Already Working

- ✅ Telegram WebApp SDK (theme, haptic, back button, main button)
- ✅ TON Connect wallet connection
- ✅ Binance WebSocket real-time prices
- ✅ Polymarket prediction market scanner
- ✅ B.O.S.S. signal generation (EMA crossover + warmth)
- ✅ Tier activation + localStorage persistence
- ✅ TON payment transaction builder
- ✅ Secure HTML escaping on all untrusted data

## What Still Needs Building

- [ ] Backend verification (currently tier unlocks client-side after payment — add a Node.js server to verify transactions on-chain for production)
- [ ] Recurring subscriptions (needs TON smart contract)
- [ ] Push notifications (Telegram Bot API → send signal alerts to subscribed users)
- [ ] STON.fi/DeDust actual swap execution for live trading

## Quick Test (No Bot Needed)

Open `telegram/miniapp.html` in Chrome mobile simulator:
- DevTools → Toggle device toolbar → select iPhone
- All features work except haptic feedback (Telegram only)
