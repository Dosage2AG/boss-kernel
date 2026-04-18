/* ══════════════════════════════════════════════════════════════════════
   TELEGRAM MINI APP WRAPPER — B.O.S.S. Trading Bot
   
   Integrates with Telegram WebApp API for:
   - User authentication
   - TON wallet connection (native Telegram wallet)
   - In-app payments via Telegram Stars or TON
   - Push notifications for trade signals
   ══════════════════════════════════════════════════════════════════════ */

class BossTelegramApp {
  constructor(clog) {
    this.clog = clog || console.log;
    this.tg = window.Telegram?.WebApp || null;
    this.user = null;
    this.ready = false;
  }

  init() {
    if (!this.tg) {
      this.clog('📱 Not in Telegram — running standalone', 'log-sys');
      return false;
    }

    // Telegram WebApp initialization
    this.tg.ready();
    this.tg.expand(); // Full screen
    this.tg.enableClosingConfirmation();

    // Get user data
    this.user = this.tg.initDataUnsafe?.user || null;
    if (this.user) {
      this.clog(`📱 Telegram: ${this.user.first_name} connected`, 'log-bond');
    }

    // Set theme to match B.O.S.S.
    this.tg.setHeaderColor('#050a06');
    this.tg.setBackgroundColor('#050a06');

    // Main button for trading
    this.tg.MainButton.setText('⚡ START TRADING');
    this.tg.MainButton.color = '#003322';
    this.tg.MainButton.textColor = '#00ffcc';
    
    this.ready = true;
    return true;
  }

  // Show trading button
  showTradeButton(callback) {
    if (!this.tg) return;
    this.tg.MainButton.show();
    this.tg.MainButton.onClick(callback);
  }

  // Request TON payment via Telegram
  async requestPayment(amount, description) {
    if (!this.tg) return null;
    
    // Telegram native invoice
    try {
      // This uses Telegram's built-in payment system
      this.tg.openInvoice(`boss_trade_deposit_${amount}`, (status) => {
        if (status === 'paid') {
          this.clog(`💰 Payment received: ${amount} Stars`, 'log-bond');
        }
      });
    } catch(e) {
      this.clog(`💰 Payment error: ${e.message}`, 'log-err');
    }
  }

  // Send notification back to chat
  sendData(data) {
    if (!this.tg) return;
    this.tg.sendData(JSON.stringify(data));
  }

  // Haptic feedback for trades
  hapticTrade(success) {
    if (!this.tg) return;
    if (success) {
      this.tg.HapticFeedback.notificationOccurred('success');
    } else {
      this.tg.HapticFeedback.notificationOccurred('error');
    }
  }

  // Show trade confirmation popup
  showConfirm(message, callback) {
    if (!this.tg) {
      callback(confirm(message));
      return;
    }
    this.tg.showConfirm(message, callback);
  }
}

if (typeof module !== 'undefined') module.exports = { BossTelegramApp };
