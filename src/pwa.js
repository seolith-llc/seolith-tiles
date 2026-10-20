// src/pwa.js
// Progressive Web App (PWA) Installer, Service Worker Manager & Daily Challenge Notification Reminder Engine

const REMINDER_STORAGE_KEY = 'seolith_tiles_reminders_v1';

const DEFAULT_REMINDER_CONFIG = {
  enabled: false,
  reminderTime: '19:00', // 7:00 PM local time default
  dailyChallengeAlert: true,
  streakSaverAlert: true,
  rankOvertakeAlert: true,
  lastNotifiedDay: '',
  currentStreak: 1,
  lastPlayedDay: '',
};

export class SeolithPWA {
  constructor(app) {
    this.app = app;
    this.swRegistration = null;
    this.deferredInstallPrompt = null;
    this.config = this.loadConfig();
    this.timerId = null;
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_REMINDER_CONFIG };
      return { ...DEFAULT_REMINDER_CONFIG, ...JSON.parse(raw) };
    } catch (_) {
      return { ...DEFAULT_REMINDER_CONFIG };
    }
  }

  saveConfig(partial = {}) {
    this.config = { ...this.config, ...partial };
    try {
      localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(this.config));
    } catch (_) {}
    return this.config;
  }

  async init() {
    // 1. Update Daily Play Streak
    this.updateDailyStreak();

    // 2. Register Service Worker (/sw.js)
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'OPEN_DAILY_CHALLENGE') {
            const dailyModal = document.getElementById('daily-modal');
            if (dailyModal) {
              dailyModal.classList.remove('hidden');
              this.app.loadDailyChallengeHub();
            }
          }
        });
      } catch (_) {}
    }

    // 3. Listen for `beforeinstallprompt` so user can 1-click install the PWA
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.updateInstallUI(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      this.updateInstallUI(false, true);
      this.app.rewardBonusBoosts(5);
      this.app.trackEvent('pwa_installed', this.app.currentLevelId);
    });

    // 4. Start Local Reminder Scheduler Loop (checks every 30 seconds)
    this.startReminderScheduler();
    this.syncModalUI();
  }

  updateDailyStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (this.config.lastPlayedDay === today) {
      return;
    }
    if (this.config.lastPlayedDay === yesterday) {
      this.saveConfig({
        currentStreak: (this.config.currentStreak || 1) + 1,
        lastPlayedDay: today,
      });
    } else {
      this.saveConfig({
        currentStreak: 1,
        lastPlayedDay: today,
      });
    }
  }

  updateInstallUI(canInstall, installed = false) {
    const headerInstallBtn = document.getElementById('btn-pwa-reminders');
    const modalInstallBtn = document.getElementById('btn-install-pwa-now');
    const installStatusEl = document.getElementById('pwa-install-status');

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      installed;

    if (installStatusEl) {
      if (isStandalone) {
        installStatusEl.style.color = '#a3e635';
        installStatusEl.textContent = '✅ Installed as Native Standalone PWA App';
      } else if (canInstall) {
        installStatusEl.style.color = '#facc15';
        installStatusEl.textContent = '📲 Ready for 1-Click Home Screen / Desktop Install (+5 ⚡ Boosts!)';
      } else {
        installStatusEl.style.color = '#94a3b8';
        installStatusEl.textContent =
          '📲 Installable via Browser Menu ("Add to Home Screen" / "Install Seolith Tiles")';
      }
    }

    if (modalInstallBtn) {
      modalInstallBtn.textContent = isStandalone
        ? '✅ App Installed on Device'
        : '📲 Install App to Home Screen / Desktop (+5 ⚡ Boosts)';
      modalInstallBtn.disabled = isStandalone;
    }

    if (headerInstallBtn && canInstall && !isStandalone) {
      headerInstallBtn.classList.add('gold-btn');
    }
  }

  async promptInstall() {
    const statusEl = document.getElementById('pwa-status-msg');
    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      const { outcome } = await this.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        this.deferredInstallPrompt = null;
        this.updateInstallUI(false, true);
        if (statusEl) {
          statusEl.style.color = '#a3e635';
          statusEl.textContent = '✅ Seolith Tiles installed! +5 Free ⚡ Boosts credited!';
        }
      }
      return;
    }

    // Provide platform-aware guidance if browser hasn't fired beforeinstallprompt (e.g. iOS Safari or already installed)
    if (statusEl) {
      statusEl.style.color = '#7dd3fc';
      statusEl.textContent =
        '💡 On iOS/Mobile: Tap Share (⬆️) → "Add to Home Screen". On Desktop Chrome/Edge: Click the Install icon in the address bar!';
    }
  }

  async requestNotificationPermission() {
    const statusEl = document.getElementById('pwa-status-msg');
    if (!('Notification' in window)) {
      if (statusEl) {
        statusEl.style.color = '#fca5a5';
        statusEl.textContent = 'Notifications are not supported in this browser.';
      }
      return false;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      if (statusEl) {
        statusEl.style.color = '#fca5a5';
        statusEl.textContent =
          '⚠️ Notification permission denied by browser. Enable notifications in site settings to receive reminders.';
      }
      return false;
    }

    const firstEnable = !this.config.enabled;
    this.saveConfig({ enabled: true });

    // Register Periodic Background Sync if supported
    if (this.swRegistration && 'periodicSync' in this.swRegistration) {
      try {
        await this.swRegistration.periodicSync.register('seolith-daily-challenge-sync', {
          minInterval: 12 * 60 * 60 * 1000, // 12 hours
        });
      } catch (_) {}
    }

    // Sync subscription preference to Cloudflare D1
    try {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.app.sessionId,
          playerName: this.app.settings.playerName || 'SeolithPlayer',
          reminderTime: this.config.reminderTime,
          timezoneOffsetMin: new Date().getTimezoneOffset(),
          dailyChallengeAlert: this.config.dailyChallengeAlert,
          streakSaverAlert: this.config.streakSaverAlert,
          rankOvertakeAlert: this.config.rankOvertakeAlert,
          enabled: true,
        }),
      });
    } catch (_) {}

    if (firstEnable) {
      this.app.rewardBonusBoosts(3);
    }

    this.syncModalUI();
    if (statusEl) {
      statusEl.style.color = '#a3e635';
      statusEl.textContent = firstEnable
        ? `✅ Notifications & Daily Reminders enabled for ${this.config.reminderTime}! (+3 Free ⚡ Boosts credited!)`
        : `✅ Reminder schedule updated for ${this.config.reminderTime}!`;
    }
    return true;
  }

  async sendNotification({ title, body, tag = 'seolith-reminder', url = '/?daily=1' }) {
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') {
      const ok = await this.requestNotificationPermission();
      if (!ok) return false;
    }

    if (this.swRegistration && this.swRegistration.active) {
      this.swRegistration.active.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        body,
        tag,
        url,
      });
      return true;
    }

    try {
      const n = new Notification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
      });
      n.onclick = () => {
        window.focus();
        const dailyModal = document.getElementById('daily-modal');
        if (dailyModal) {
          dailyModal.classList.remove('hidden');
          this.app.loadDailyChallengeHub();
        }
      };
      return true;
    } catch (_) {
      return false;
    }
  }

  startReminderScheduler() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => this.checkScheduledReminders(), 30000);
  }

  async checkScheduledReminders() {
    if (!this.config.enabled || !('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    if (this.config.lastNotifiedDay === todayKey) return;

    const [targetH, targetM] = String(this.config.reminderTime || '19:00')
      .split(':')
      .map((n) => Number(n) || 0);

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = targetH * 60 + targetM;

    if (nowMinutes >= targetMinutes && nowMinutes <= targetMinutes + 30) {
      this.saveConfig({ lastNotifiedDay: todayKey });
      const c = this.app.dailyChallengeData?.challenge;
      const vaultTitle = c ? `${c.levelName} (Par ${(c.targetTimeMs / 1000).toFixed(1)}s)` : 'Today’s Daily Vault';
      await this.sendNotification({
        title: `🎯 Seolith Daily Challenge & ${this.config.currentStreak || 1}-Day Streak!`,
        body: `${vaultTitle} is waiting! Keep your ${this.config.currentStreak || 1}-day streak alive and claim +3 Free ⚡ Boosts!`,
        tag: `daily-scheduled-${todayKey}`,
        url: '/?daily=1&ref=ScheduledReminder',
      });
    }
  }

  syncModalUI() {
    const permBadge = document.getElementById('pwa-perm-badge');
    const timeInput = document.getElementById('pwa-reminder-time');
    const chkDaily = document.getElementById('pwa-chk-daily');
    const chkStreak = document.getElementById('pwa-chk-streak');
    const chkRank = document.getElementById('pwa-chk-rank');
    const streakVal = document.getElementById('pwa-streak-val');

    if (streakVal) {
      streakVal.textContent = `🔥 ${this.config.currentStreak || 1} Day${
        (this.config.currentStreak || 1) === 1 ? '' : 's'
      }`;
    }

    if (permBadge) {
      const perm = 'Notification' in window ? Notification.permission : 'unsupported';
      if (perm === 'granted' && this.config.enabled) {
        permBadge.style.background = 'rgba(163,230,53,0.14)';
        permBadge.style.color = '#a3e635';
        permBadge.textContent = `🔔 Notifications Active (Daily at ${this.config.reminderTime})`;
      } else if (perm === 'denied') {
        permBadge.style.background = 'rgba(248,113,113,0.14)';
        permBadge.style.color = '#fca5a5';
        permBadge.textContent = '🔕 Notifications Blocked in Browser Settings';
      } else {
        permBadge.style.background = 'rgba(250,204,21,0.14)';
        permBadge.style.color = '#facc15';
        permBadge.textContent = '🔔 Enable Reminders for +3 Free ⚡ Boosts';
      }
    }

    if (timeInput) timeInput.value = this.config.reminderTime || '19:00';
    if (chkDaily) chkDaily.checked = Boolean(this.config.dailyChallengeAlert);
    if (chkStreak) chkStreak.checked = Boolean(this.config.streakSaverAlert);
    if (chkRank) chkRank.checked = Boolean(this.config.rankOvertakeAlert);

    this.updateInstallUI(Boolean(this.deferredInstallPrompt));
  }
}
