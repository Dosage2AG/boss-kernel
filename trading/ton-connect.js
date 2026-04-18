/* ══════════════════════════════════════════════════════════════════════
   TON CONNECT — Wallet Integration for B.O.S.S. Trading
   
   Connects to user's TON wallet via TON Connect 2.0
   Enables deposits, withdrawals, and automated DEX swaps
   ══════════════════════════════════════════════════════════════════════ */

class BossTonWallet {
  constructor(clog) {
    this.clog = clog || console.log;
    this.connected = false;
    this.address = null;
    this.balance = 0;
    this.connector = null;
    this.manifest = {
      url: 'https://boss-kernel.app',
      name: 'B.O.S.S. Market Observer',
      iconUrl: 'https://boss-kernel.app/icon.png'
    };
  }

  async init() {
    // Load TON Connect SDK
    if (typeof TonConnectSDK === 'undefined') {
      this.clog('💰 Loading TON Connect...', 'log-sys');
      await this.loadScript('https://unpkg.com/@tonconnect/sdk@latest/dist/tonconnect-sdk.min.js');
    }

    try {
      this.connector = new TonConnectSDK.TonConnect({ manifestUrl: this.manifest.url });
      
      // Check for existing connection
      const wallets = await this.connector.getWallets();
      this.clog(`💰 ${wallets.length} wallets available`, 'log-sys');
      
      // Listen for connection changes
      this.connector.onStatusChange(wallet => {
        if (wallet) {
          this.connected = true;
          this.address = wallet.account.address;
          this.clog(`💰 Wallet connected: ${this.address.substring(0, 8)}...`, 'log-bond');
        } else {
          this.connected = false;
          this.address = null;
          this.clog('💰 Wallet disconnected', 'log-sys');
        }
      });

      return true;
    } catch(e) {
      this.clog(`💰 TON init error: ${e.message}`, 'log-err');
      return false;
    }
  }

  async connect() {
    if (!this.connector) await this.init();
    try {
      const walletsList = await this.connector.getWallets();
      // For Telegram, use Tonkeeper or embedded wallet
      const tonkeeper = walletsList.find(w => w.name === 'Tonkeeper') || walletsList[0];
      if (tonkeeper) {
        const universalLink = this.connector.connect({ jsBridgeKey: tonkeeper.jsBridgeKey });
        this.clog('💰 Open wallet to approve connection...', 'log-bond');
        return universalLink;
      }
    } catch(e) {
      this.clog(`💰 Connect error: ${e.message}`, 'log-err');
    }
    return null;
  }

  async getBalance() {
    if (!this.address) return 0;
    try {
      const resp = await fetch(`https://toncenter.com/api/v2/getAddressBalance?address=${this.address}`);
      const data = await resp.json();
      this.balance = parseInt(data.result || 0) / 1e9; // nanoTON to TON
      return this.balance;
    } catch(e) {
      return 0;
    }
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
}
