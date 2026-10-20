// src/main.js
// Main orchestrator connecting Rust WebAssembly Physics (v1.1.0), Three.js InstancedMesh Renderer,
// Procedural WebAudio ASMR Synth, LocalStorage Auto-Save/Resume, Tester Feedback Collector,
// Release Notes & Dev Guide, Viral Social Referral Engine, and Geo Leaderboards.

import { LEVEL_PRESETS, VISUAL_THEMES } from './levels.js';
import { APP_VERSION, RELEASE_NOTES } from './releases.js';
import { SeolithRenderer } from './renderer.js';
import { SeolithAudio } from './audio.js';
import { SeolithStorage, MONETIZATION_FREE_PLAYS_LIMIT } from './storage.js';
import { SeolithRecorder } from './recorder.js';
import { SeolithLeaderboard } from './leaderboard.js';
import { SeolithPWA } from './pwa.js';

const VAULT_LEFT = 0.04;
const VAULT_RIGHT = 0.96;
const VAULT_BOTTOM = 0.42;
const VAULT_TOP = 1.30;

class SeolithTilesGame {
  constructor() {
    this.wasm = null;
    this.settings = SeolithStorage.getSettings();
    this.stats = SeolithStorage.getStats();
    this.audio = new SeolithAudio();
    this.leaderboard = new SeolithLeaderboard();
    this.pwa = new SeolithPWA(this);

    this.currentLevelId = 0;
    this.aimAngleRad = (LEVEL_PRESETS[0].recommendedAimDeg * Math.PI) / 180;
    this.isEditorMode = false;
    this.paintBrushVal = 0;
    this.isPointerDown = false;
    this.lastStatus = 0;
    this.lastSaveAt = 0;

    this.lbState = {
      period: 'daily',
      scope: 'global',
      sortBy: 'time',
    };

    // Persistent anonymous visitor session ID for geo-analytics
    try {
      this.sessionId =
        localStorage.getItem('seolith_session_id') ||
        'sess_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem('seolith_session_id', this.sessionId);
    } catch (_) {
      this.sessionId = 'sess_' + Math.random().toString(36).slice(2, 10);
    }
    this.refTag = '';
  }

  trackEvent(eventType, levelId = this.currentLevelId) {
    try {
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          playerName: this.settings.playerName || 'Anon',
          eventType,
          levelId,
          referrer: document.referrer || '',
          refTag: this.refTag || '',
        }),
      }).catch(() => {});
    } catch (_) {}
  }

  async init() {
    // 1. Load Rust WebAssembly physics engine
    const res = await fetch('/wasm/seolith_engine.wasm');
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    this.wasm = instance.exports;

    // 2. Setup Theme & Three.js Renderer
    const baseTheme =
      VISUAL_THEMES[this.settings.themeId] || VISUAL_THEMES.crimson_viral;
    this.activeTheme = {
      ...baseTheme,
      ...(this.settings.customColors || {}),
      tiltDeg: Number(this.settings.tiltDeg ?? baseTheme.tiltDeg ?? 0),
    };

    const canvas = document.getElementById('game-canvas');
    this.renderer = new SeolithRenderer(canvas, this.activeTheme);
    this.recorder = new SeolithRecorder(canvas);

    // 3. Apply Audio Settings
    this.audio.setSettings({
      sfxEnabled: this.settings.sfxEnabled,
      musicEnabled: this.settings.musicEnabled,
      soundProfile: this.settings.soundProfile,
    });

    // 4. Bind UI & Input Listeners
    this.setupUI();
    this.setupInputs(canvas);
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    // 5. Check URL for incoming Viral Social Challenge Referral (?ref=Handle&level=0&target=42.8)
    const initialLevel = this.checkIncomingChallengeUrl();

    // 6. Load Initial Level & check for auto-saved live game in LocalStorage
    this.loadLevel(initialLevel, false);
    this.checkSavedSnapshot();
    this.updateBoostBadge();

    // 7. Log Visitor Pageview, Initialize PWA & Reminders, & Fetch Edge Geo-Location in background
    this.pwa.init();
    this.trackEvent('pageview', initialLevel);
    this.leaderboard.fetchGeoAndTop({ levelId: initialLevel }).then((data) => {
      this.updateGeoBadge(data?.geo);
    });

    // 8. Start 60-120Hz Animation Loop
    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  checkIncomingChallengeUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('pro_unlocked') === '1') {
        SeolithStorage.unlockProPass();
        this.updateBoostBadge();
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (params.get('boost_pack') === '1') {
        this.rewardBonusBoosts(15);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (params.get('daily') === '1') {
        this._openDailyOnStart = true;
      }
      const ref = params.get('ref');
      const level = Number(params.get('level') || 0);
      const target = params.get('target');
      const pts = params.get('pts');
      if (ref) {
        this.refTag = ref;
        const banner = document.getElementById('challenge-banner');
        const modeLabel = params.get('daily') === '1' ? 'DAILY CHALLENGE' : 'CHALLENGE';
        banner.textContent = `🎯 ${modeLabel} FROM @${ref}: Beat ${target || '45.0'}s (${Number(pts || 60000).toLocaleString()} pts) on Vault #${level + 1}!`;
        banner.classList.remove('hidden');
        document.getElementById('select-level').value = String(level);
        return Math.max(0, Math.min(LEVEL_PRESETS.length - 1, level));
      }
    } catch (_) {}
    return 0;
  }

  updateGeoBadge(geo) {
    const badge = document.getElementById('geo-badge');
    const loc =
      geo && geo.country
        ? `${geo.city ? geo.city + ', ' : ''}${geo.country}`
        : 'Global Edge';
    const stats = SeolithStorage.getStats();
    const proTag = stats.proUnlocked ? ' • 👑 PRO' : '';
    const dailyTag = this.isDailyChallengeActive ? ' • 🎯 DAILY' : '';
    badge.textContent = `📍 ${loc} • Play #${(stats.totalPlays || 0) + 1}${proTag}${dailyTag}`;
  }

  updateBoostBadge() {
    const stats = SeolithStorage.getStats();
    const el = document.getElementById('boost-count');
    if (el) {
      el.textContent = stats.proUnlocked ? '∞' : String(stats.bonusCredits ?? 3);
    }
  }

  rewardBonusBoosts(amount = 3) {
    const stats = SeolithStorage.getStats();
    stats.bonusCredits = (stats.bonusCredits ?? 3) + amount;
    SeolithStorage.saveStats(stats);
    this.updateBoostBadge();
  }

  openMonetizationModal() {
    const stats = SeolithStorage.getStats();
    const plays = stats.totalPlays || 0;
    const left = Math.max(0, MONETIZATION_FREE_PLAYS_LIMIT - plays);
    document.getElementById('monetize-play-count').textContent = String(plays);
    document.getElementById('monetize-free-left').textContent = stats.proUnlocked
      ? 'UNLIMITED (PRO)'
      : String(left);
    document.getElementById('monetization-modal').classList.remove('hidden');
  }

  checkSavedSnapshot() {
    const snap = SeolithStorage.getLiveSnapshot();
    if (snap && snap.status === 1 && snap.balls && snap.balls.length > 0) {
      const toast = document.getElementById('resume-toast');
      toast.classList.remove('hidden');

      document.getElementById('btn-resume-saved').onclick = () => {
        toast.classList.add('hidden');
        this.currentLevelId = snap.levelId || 0;
        document.getElementById('select-level').value = String(this.currentLevelId);
        SeolithStorage.restoreSnapshotIntoWasm(this.wasm, snap);
        this.lastStatus = 1;
        document.getElementById('aim-banner').style.opacity = '0';
      };

      document.getElementById('btn-discard-saved').onclick = () => {
        toast.classList.add('hidden');
        SeolithStorage.clearLiveSnapshot();
      };
    }
  }

  loadLevel(levelId, countAsNewPlay = false, options = {}) {
    if (countAsNewPlay && SeolithStorage.isMonetizationGateActive()) {
      this.openMonetizationModal();
      return;
    }

    this.isDailyChallengeActive = Boolean(options.isDaily);
    this.currentRunBoostsUsed = 0;
    this.currentLevelId = Number(levelId);
    const preset = LEVEL_PRESETS[this.currentLevelId] || LEVEL_PRESETS[0];

    if (!this.settings.customColors) {
      const autoTheme =
        this.currentLevelId === 1
          ? VISUAL_THEMES.sunset_amber
          : VISUAL_THEMES[this.settings.themeId] || VISUAL_THEMES.crimson_viral;
      this.activeTheme = {
        ...autoTheme,
        tiltDeg: Number(this.settings.tiltDeg ?? 0),
      };
      this.renderer.applyTheme(this.activeTheme);
    }

    const grid = Number(options.gridSize) || Number(this.settings.gridSize) || preset.defaultGrid || 64;
    const seed =
      options.seed !== undefined
        ? Number(options.seed) >>> 0
        : (Date.now() & 0xffffffff) >>> 0;
    this.wasm.build_preset_level(this.currentLevelId, grid, grid, seed);

    if (this.currentLevelId === 0 || this.currentLevelId === 5) {
      this.wasm.set_paddle_x(0.74);
      this.aimAngleRad = -0.02;
    } else if (this.currentLevelId === 1 || this.currentLevelId === 4) {
      this.wasm.set_paddle_x(0.50);
      this.aimAngleRad = -0.02;
    } else if (this.currentLevelId === 2) {
      this.wasm.set_paddle_x(0.27);
      this.aimAngleRad = 0.0;
    } else {
      this.wasm.set_paddle_x(0.50);
      this.aimAngleRad = 0.0;
    }
    this.wasm.set_aim_angle(this.aimAngleRad);

    this.lastStatus = 0;
    document.getElementById('result-modal').classList.add('hidden');
    const aimBanner = document.getElementById('aim-banner');
    aimBanner.textContent = this.isDailyChallengeActive
      ? `🎯 DAILY CHALLENGE (${this.dailyChallengeData?.challenge?.dayKey || 'Today'}) — Par ${(
          (this.dailyChallengeData?.challenge?.targetTimeMs || 45000) / 1000
        ).toFixed(1)}s • Launch now!`
      : `${preset.name} — Move to aim • Tap / Click or Space to launch!`;
    aimBanner.style.opacity = '1';
    this.updateGeoBadge(this.leaderboard?.geo);
  }

  getSharePayload() {
    const elapsedSec = Math.max(1.0, this.wasm.get_elapsed_ms() / 1000).toFixed(1);
    const score = this.wasm.get_score() || this.stats.bestScore || 64200;
    const peakBalls = Math.max(3, this.wasm.get_peak_balls_count() || 810);
    const stars = elapsedSec < 60 ? 3 : elapsedSec < 95 ? 2 : 1;
    return {
      playerName: this.settings.playerName || 'SeolithPlayer',
      levelName: LEVEL_PRESETS[this.currentLevelId]?.name || 'Seolith Vault',
      levelId: this.currentLevelId,
      score,
      clearTimeSec: elapsedSec,
      peakBalls,
      stars,
      locationLabel: this.leaderboard.geo?.country || 'Global',
    };
  }

  setupUI() {
    // Version & Release Notes Modal
    const versionBtn = document.getElementById('btn-version-notes');
    versionBtn.textContent = `v${APP_VERSION}`;
    const releaseModal = document.getElementById('release-modal');
    const notesContainer = document.getElementById('tab-content-notes');

    notesContainer.innerHTML = RELEASE_NOTES.map(
      (r) => `
      <div style="margin-bottom:12px;">
        <h4>v${r.version} — ${r.title} <span style="color:#94a3b8;font-weight:400;">(${r.date})</span></h4>
        <ul>${r.highlights.map((h) => `<li>${h}</li>`).join('')}</ul>
      </div>
    `
    ).join('');

    versionBtn.addEventListener('click', () => {
      releaseModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-release').addEventListener('click', () => {
      releaseModal.classList.add('hidden');
    });

    document.querySelectorAll('#release-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#release-tabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('tab-content-notes').classList.toggle('hidden', tab !== 'notes');
        document.getElementById('tab-content-devpost').classList.toggle('hidden', tab !== 'devpost');
      });
    });

    // Tester Feedback Collector Modal
    const fbModal = document.getElementById('feedback-modal');
    document.getElementById('fb-name').value = this.settings.playerName || '';

    document.getElementById('btn-feedback').addEventListener('click', () => {
      fbModal.classList.remove('hidden');
      this.refreshFeedbackList();
    });
    document.getElementById('btn-close-feedback').addEventListener('click', () => {
      fbModal.classList.add('hidden');
    });

    document.getElementById('btn-submit-feedback').addEventListener('click', async () => {
      const msgEl = document.getElementById('fb-message');
      const statusEl = document.getElementById('fb-status-msg');
      const message = msgEl.value.trim();
      if (message.length < 3) {
        statusEl.style.color = '#fca5a5';
        statusEl.textContent = 'Please enter at least 3 characters describing your feedback.';
        return;
      }

      statusEl.style.color = '#7dd3fc';
      statusEl.textContent = 'Submitting to Cloudflare D1 agent queue...';

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            testerName: document.getElementById('fb-name').value.trim() || this.settings.playerName,
            category: document.getElementById('fb-category').value,
            severity: document.getElementById('fb-severity').value,
            version: APP_VERSION,
            levelId: this.currentLevelId,
            message,
            deviceInfo: `${window.innerWidth}x${window.innerHeight} ${navigator.userAgent.slice(0, 80)}`,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.style.color = '#a3e635';
          statusEl.textContent = '✅ Feedback saved! Thank you — we added +2 Free ⚡ x3 Boosts to your account!';
          msgEl.value = '';
          this.rewardBonusBoosts(2);
          this.refreshFeedbackList();
        } else {
          statusEl.style.color = '#fca5a5';
          statusEl.textContent = data.error || 'Submission failed.';
        }
      } catch (_) {
        statusEl.style.color = '#a3e635';
        statusEl.textContent = '✅ Feedback cached locally (+2 Free Boosts awarded)!';
        msgEl.value = '';
        this.rewardBonusBoosts(2);
      }
    });

    // Level Selector & Reset
    const levelSelect = document.getElementById('select-level');
    LEVEL_PRESETS.forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = String(lvl.id);
      opt.textContent = lvl.name;
      levelSelect.appendChild(opt);
    });

    levelSelect.addEventListener('change', (e) => {
      this.loadLevel(Number(e.target.value), false);
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      SeolithStorage.clearLiveSnapshot();
      this.loadLevel(this.currentLevelId, false);
    });

    // Instant x3 Cascade Boost button (consumes 1 Boost credit or unlimited for Pro, opens Monetization Shop when 0!)
    document.getElementById('btn-boost-x3').addEventListener('click', () => {
      const stats = SeolithStorage.getStats();
      if (!stats.proUnlocked && (stats.bonusCredits ?? 3) <= 0) {
        this.openMonetizationModal();
        return;
      }

      if (!stats.proUnlocked) {
        stats.bonusCredits = Math.max(0, (stats.bonusCredits ?? 3) - 1);
        SeolithStorage.saveStats(stats);
        this.updateBoostBadge();
      }
      this.currentRunBoostsUsed = (this.currentRunBoostsUsed || 0) + 1;

      this.audio.ensureContext();
      if (this.wasm.get_status() === 0) {
        this.launchBallNow();
      }
      this.wasm.trigger_bonus_capsule(1); // CAPSULE_MUL3 (x3)
      this.wasm.trigger_bonus_capsule(5); // CAPSULE_STAR (safety floor)
      this.audio.playPowerup(1);
    });

    // Pro Shop Header Button
    document.getElementById('btn-pro-shop').addEventListener('click', () => {
      this.openMonetizationModal();
    });

    // Top Share Button
    document.getElementById('btn-share-top').addEventListener('click', async () => {
      const payload = this.getSharePayload();
      const res = await this.recorder.shareRun(payload);
      this.rewardBonusBoosts(3);
      const btn = document.getElementById('btn-share-top');
      btn.textContent = res.method === 'clipboard' ? '✅ Link Copied (+3⚡)' : '✅ Shared (+3⚡)';
      setTimeout(() => {
        btn.textContent = '📤 Share';
      }, 2500);
    });

    // Social Share Buttons inside Result & Monetization Modals
    document.getElementById('btn-share-x').addEventListener('click', () => {
      this.recorder.shareToX(this.getSharePayload());
      this.rewardBonusBoosts(3);
    });
    document.getElementById('btn-share-wa').addEventListener('click', () => {
      this.recorder.shareToWhatsApp(this.getSharePayload());
      this.rewardBonusBoosts(3);
    });
    document.getElementById('btn-share-reddit').addEventListener('click', () => {
      this.recorder.shareToReddit(this.getSharePayload());
      this.rewardBonusBoosts(3);
    });
    document.getElementById('btn-share-for-boosts').addEventListener('click', () => {
      this.recorder.shareToX(this.getSharePayload());
      this.rewardBonusBoosts(3);
      document.getElementById('monetization-modal').classList.add('hidden');
    });

    // Audio toggles
    const sfxBtn = document.getElementById('btn-sfx');
    const musicBtn = document.getElementById('btn-music');
    sfxBtn.classList.toggle('active', this.settings.sfxEnabled);
    musicBtn.classList.toggle('active', this.settings.musicEnabled);

    sfxBtn.addEventListener('click', () => {
      this.settings.sfxEnabled = !this.settings.sfxEnabled;
      sfxBtn.classList.toggle('active', this.settings.sfxEnabled);
      this.audio.setSettings({ sfxEnabled: this.settings.sfxEnabled });
      SeolithStorage.saveSettings(this.settings);
    });

    musicBtn.addEventListener('click', () => {
      this.audio.ensureContext();
      this.settings.musicEnabled = !this.settings.musicEnabled;
      musicBtn.classList.toggle('active', this.settings.musicEnabled);
      this.audio.setSettings({ musicEnabled: this.settings.musicEnabled });
      SeolithStorage.saveSettings(this.settings);
    });

    // Level Paint Editor toggle
    const editorBtn = document.getElementById('btn-editor-toggle');
    editorBtn.addEventListener('click', () => {
      this.isEditorMode = !this.isEditorMode;
      editorBtn.classList.toggle('active', this.isEditorMode);
      const aimBanner = document.getElementById('aim-banner');
      aimBanner.textContent = this.isEditorMode
        ? '✏️ Paint Mode Active: Drag on the vault to carve tunnels or place Gold Trigger bricks!'
        : 'Move to aim • Tap / Click or Space to launch!';
      aimBanner.style.opacity = '1';
    });

    // Video Recording button
    const recBtn = document.getElementById('btn-record');
    recBtn.addEventListener('click', async () => {
      if (!this.recorder.isRecording) {
        const started = this.recorder.startRecording(this.audio.ctx);
        if (started) {
          recBtn.classList.add('recording');
          recBtn.textContent = '⏹ Stop';
        }
      } else {
        await this.recorder.stopRecording();
        recBtn.classList.remove('recording');
        recBtn.textContent = '⏺ Rec';
        this.recorder.downloadLastVideo(LEVEL_PRESETS[this.currentLevelId]?.name);
      }
    });

    // Customize Modal
    const custModal = document.getElementById('customize-modal');
    document.getElementById('input-player-name').value = this.settings.playerName || '';
    document.getElementById('select-theme').value = this.settings.themeId || 'crimson_viral';
    document.getElementById('select-grid-size').value = String(this.settings.gridSize || 64);
    document.getElementById('select-tilt').value = String(this.settings.tiltDeg || 0);
    document.getElementById('select-sound-profile').value =
      this.settings.soundProfile || 'asmr-wood';

    document.getElementById('btn-customize').addEventListener('click', () => {
      custModal.classList.remove('hidden');
    });

    document.getElementById('select-theme').addEventListener('change', (e) => {
      const t = VISUAL_THEMES[e.target.value];
      if (t) {
        document.getElementById('color-primary').value = t.primaryBrickHex;
        document.getElementById('color-gold').value = t.goldBrickHex;
        document.getElementById('color-paddle').value = t.paddleHex;
      }
    });

    document.getElementById('btn-close-customize').addEventListener('click', () => {
      const prevGrid = this.settings.gridSize;
      this.settings.playerName =
        document.getElementById('input-player-name').value.trim() || 'SeolithPlayer';
      this.settings.themeId = document.getElementById('select-theme').value;
      this.settings.gridSize = Number(document.getElementById('select-grid-size').value);
      this.settings.tiltDeg = Number(document.getElementById('select-tilt').value);
      this.settings.soundProfile = document.getElementById('select-sound-profile').value;
      this.paintBrushVal = Number(document.getElementById('select-paint-brush').value);

      const baseT = VISUAL_THEMES[this.settings.themeId] || VISUAL_THEMES.crimson_viral;
      this.settings.customColors = {
        primaryBrickHex: document.getElementById('color-primary').value,
        goldBrickHex: document.getElementById('color-gold').value,
        paddleHex: document.getElementById('color-paddle').value,
      };

      this.activeTheme = {
        ...baseT,
        ...this.settings.customColors,
        tiltDeg: this.settings.tiltDeg,
      };

      SeolithStorage.saveSettings(this.settings);
      this.renderer.applyTheme(this.activeTheme);
      this.audio.setSettings({ soundProfile: this.settings.soundProfile });

      if (prevGrid !== this.settings.gridSize && this.wasm.get_status() === 0) {
        this.loadLevel(this.currentLevelId, false);
      }
      custModal.classList.add('hidden');
    });

    // Leaderboard Modal
    const lbModal = document.getElementById('leaderboard-modal');
    document.getElementById('btn-leaderboard').addEventListener('click', () => {
      lbModal.classList.remove('hidden');
      this.refreshLeaderboardTable();
    });
    document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
      lbModal.classList.add('hidden');
    });

    document.querySelectorAll('#lb-period-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .querySelectorAll('#lb-period-tabs button')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.lbState.period = btn.dataset.period;
        this.refreshLeaderboardTable();
      });
    });

    document.querySelectorAll('#lb-scope-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .querySelectorAll('#lb-scope-tabs button')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.lbState.scope = btn.dataset.scope;
        this.refreshLeaderboardTable();
      });
    });

    document.querySelectorAll('#lb-sort-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .querySelectorAll('#lb-sort-tabs button')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.lbState.sortBy = btn.dataset.sort;
        this.refreshLeaderboardTable();
      });
    });

    // Result Modal Buttons
    document.getElementById('btn-play-again').addEventListener('click', () => {
      this.loadLevel(this.currentLevelId, true);
    });

    document.getElementById('btn-next-level').addEventListener('click', () => {
      const next = (this.currentLevelId + 1) % LEVEL_PRESETS.length;
      document.getElementById('select-level').value = String(next);
      this.loadLevel(next, true);
    });

    document.getElementById('btn-share-run').addEventListener('click', async () => {
      const shareBtn = document.getElementById('btn-share-run');
      shareBtn.textContent = '⏳ Preparing...';
      const result = await this.recorder.shareRun(this.getSharePayload());
      this.rewardBonusBoosts(3);
      shareBtn.textContent =
        result.method === 'clipboard' ? '✅ Copied (+3⚡)!' : '📤 Shared (+3⚡)!';
      setTimeout(() => {
        shareBtn.textContent = '📤 Card / Copy Link';
      }, 2500);
    });

    document.getElementById('btn-download-video').addEventListener('click', () => {
      this.recorder.downloadLastVideo(LEVEL_PRESETS[this.currentLevelId]?.name);
    });

    // Monetization & Pro Shop Modal Actions (/api/checkout & /api/monetization)
    document.getElementById('btn-unlock-pro').addEventListener('click', () => {
      this.startEdgeCheckout('pro_pass');
    });

    const buyBoostBtn = document.getElementById('btn-buy-boost-pack');
    if (buyBoostBtn) {
      buyBoostBtn.addEventListener('click', () => {
        this.startEdgeCheckout('boost_pack_15');
      });
    }

    document.getElementById('btn-watch-rewarded').addEventListener('click', () => {
      this.runSponsorSpotCountdown();
    });

    document.getElementById('btn-close-monetize').addEventListener('click', () => {
      document.getElementById('monetization-modal').classList.add('hidden');
    });

    // Protected Admin Geo-Analytics Dashboard Modal
    const adminModal = document.getElementById('admin-modal');
    const savedAdminEmail = localStorage.getItem('seolith_admin_email') || 'admin@seolith.com';
    const savedAdminKey = localStorage.getItem('seolith_admin_key') || '';
    document.getElementById('admin-email-input').value = savedAdminEmail;
    document.getElementById('admin-key-input').value = savedAdminKey;

    document.getElementById('btn-admin-analytics').addEventListener('click', () => {
      adminModal.classList.remove('hidden');
      if (localStorage.getItem('seolith_admin_key')) {
        this.loadAdminAnalytics();
      }
    });

    document.getElementById('btn-close-admin').addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });

    document.getElementById('btn-admin-login').addEventListener('click', () => {
      this.loadAdminAnalytics();
    });

    // Competitive Daily Challenge & Tester QA Modal
    const dailyModal = document.getElementById('daily-modal');
    document.getElementById('btn-daily-challenge').addEventListener('click', () => {
      dailyModal.classList.remove('hidden');
      this.loadDailyChallengeHub();
    });

    document.getElementById('btn-close-daily').addEventListener('click', () => {
      dailyModal.classList.add('hidden');
    });

    document.getElementById('btn-launch-daily').addEventListener('click', () => {
      this.startDailyChallengeRun();
    });

    document.getElementById('btn-share-daily-x').addEventListener('click', () => {
      this.shareDailyChallenge('x');
    });

    document.getElementById('btn-share-daily-wa').addEventListener('click', () => {
      this.shareDailyChallenge('wa');
    });

    document.getElementById('btn-share-daily-copy').addEventListener('click', () => {
      this.shareDailyChallenge('copy');
    });

    document.getElementById('btn-submit-daily-approval').addEventListener('click', () => {
      this.submitDailyTesterApproval();
    });

    if (this._openDailyOnStart) {
      setTimeout(() => {
        dailyModal.classList.remove('hidden');
        this.loadDailyChallengeHub();
      }, 300);
    }

    // PWA Install & Daily Reminders Modal
    const pwaModal = document.getElementById('pwa-modal');
    const pwaBtn = document.getElementById('btn-pwa-reminders');
    if (pwaBtn && pwaModal) {
      pwaBtn.addEventListener('click', () => {
        this.pwa.syncModalUI();
        pwaModal.classList.remove('hidden');
      });
    }

    document.getElementById('btn-close-pwa')?.addEventListener('click', () => {
      pwaModal.classList.add('hidden');
    });

    document.getElementById('btn-install-pwa-now')?.addEventListener('click', () => {
      this.pwa.promptInstall();
    });

    document.getElementById('btn-save-reminders')?.addEventListener('click', async () => {
      const reminderTime = document.getElementById('pwa-reminder-time')?.value || '19:00';
      const dailyChallengeAlert = Boolean(document.getElementById('pwa-chk-daily')?.checked);
      const streakSaverAlert = Boolean(document.getElementById('pwa-chk-streak')?.checked);
      const rankOvertakeAlert = Boolean(document.getElementById('pwa-chk-rank')?.checked);

      this.pwa.saveConfig({
        reminderTime,
        dailyChallengeAlert,
        streakSaverAlert,
        rankOvertakeAlert,
      });
      await this.pwa.requestNotificationPermission();
    });

    document.getElementById('btn-test-notification')?.addEventListener('click', async () => {
      const c = this.dailyChallengeData?.challenge;
      const title = c
        ? `🎯 ${c.title}`
        : '🎯 Seolith Daily Challenge & Streak Reminder!';
      const body = c
        ? `Vault: ${c.levelName} • Beat ${(c.targetTimeMs / 1000).toFixed(1)}s Par Time to claim +3 Free ⚡ Boosts!`
        : 'Your daily micro-tile vault is ready! Tap to launch a 1,600-ball cascade & keep your streak alive!';
      const sent = await this.pwa.sendNotification({
        title,
        body,
        tag: 'seolith-test-notification',
        url: '/?daily=1&ref=TestReminder',
      });
      const statusEl = document.getElementById('pwa-status-msg');
      if (statusEl && sent) {
        statusEl.style.color = '#a3e635';
        statusEl.textContent = '✅ Live notification dispatched! Check your system notification tray.';
      }
    });
  }

  async loadDailyChallengeHub() {
    const testerInput = document.getElementById('dc-tester-name');
    if (testerInput && !testerInput.value) {
      testerInput.value = this.settings.playerName || 'SeolithTester';
    }

    try {
      const res = await fetch('/api/daily-challenge');
      const data = await res.json();
      if (!data.ok) return;
      this.dailyChallengeData = data;
      const c = data.challenge;
      const st = data.stats || {};

      document.getElementById('dc-title').textContent = c.title;
      document.getElementById('dc-vault').textContent = `${c.levelName.slice(0, 18)} (${c.gridSize}²)`;
      document.getElementById('dc-target-time').textContent = `${(c.targetTimeMs / 1000).toFixed(1)}s`;
      document.getElementById('dc-target-score').textContent = Number(c.targetScore).toLocaleString();
      document.getElementById('dc-seed').textContent = `#${(c.seed >>> 0).toString(16).toUpperCase()}`;
      document.getElementById('dc-rule-box').textContent = `${c.ruleText} • ${st.totalRuns || 0} Runs Logged Today (${st.targetBeats || 0} Par Beats)`;

      const qaBadge = document.getElementById('dc-qa-badge');
      if (st.qaCertified) {
        qaBadge.style.background = 'rgba(163,230,53,0.14)';
        qaBadge.style.color = '#a3e635';
        qaBadge.textContent = `✅ QA CERTIFIED BY TESTERS (${st.approvedCount} Approved • Fun ${st.avgFun}/5)`;
      } else {
        qaBadge.style.background = 'rgba(250,204,21,0.14)';
        qaBadge.style.color = '#facc15';
        qaBadge.textContent = `🧪 AWAITING TESTER QA SIGN-OFF (${st.approvedCount || 0} Approved)`;
      }

      document.getElementById('dc-approval-summary').textContent =
        `${st.approvedCount || 0} Approved • Diff ${st.avgDifficulty || 5.0}/5 • Fun ${st.avgFun || 5.0}/5`;

      const runsTbody = document.getElementById('dc-runs-tbody');
      const entries = data.entries || [];
      runsTbody.innerHTML = entries.length
        ? entries
            .map((e, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
              const timeSec = ((e.elapsedMs || 45000) / 1000).toFixed(2) + 's';
              const star = Number(e.beatTarget) === 1 ? '⭐' : '';
              const loc = e.city ? `${e.city}, ${e.country}` : e.country || 'GL';
              return `<tr>
                <td><strong>${medal}</strong></td>
                <td>${this.escapeHtml(e.playerName)} ${star}</td>
                <td style="color:#a3e635;font-weight:700;">${timeSec}</td>
                <td>${Number(e.score || 0).toLocaleString()}</td>
                <td>${Number(e.peakBalls || 1)}x</td>
                <td>${Number(e.aimDeg || 0).toFixed(1)}° / ${Number(e.boostsUsed || 0)}⚡</td>
                <td>${this.escapeHtml(loc)}</td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">No Daily Challenge runs yet today — click Launch to set the #1 record!</td></tr>';

      const appList = document.getElementById('dc-approvals-list');
      const approvals = data.approvals || [];
      appList.innerHTML = approvals.length
        ? approvals
            .map(
              (a) =>
                `<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                  <strong>${a.verdict === 'approved' ? '✅' : '🔧'} ${this.escapeHtml(a.testerName)}</strong>
                  (Diff ${a.difficultyRating}/5, Fun ${a.funRating}/5, ${this.escapeHtml(a.country || 'GL')}):
                  <em>${this.escapeHtml(a.comment || 'Verified smooth 60FPS gameplay & par target.')}</em>
                </div>`
            )
            .join('')
        : '<div>No tester sign-offs yet today — test the vault and submit your QA verdict above!</div>';
    } catch (_) {}
  }

  startDailyChallengeRun() {
    const c = this.dailyChallengeData?.challenge || {
      dayKey: new Date().toISOString().slice(0, 10),
      seed: 0x20261018,
      levelId: 0,
      gridSize: 64,
      targetTimeMs: 44000,
    };
    document.getElementById('daily-modal').classList.add('hidden');
    document.getElementById('select-level').value = String(c.levelId);
    this.loadLevel(c.levelId, true, {
      isDaily: true,
      seed: c.seed,
      gridSize: c.gridSize,
    });
    this.trackEvent('daily_start', c.levelId);
  }

  async submitDailyTesterApproval() {
    const testerName = document.getElementById('dc-tester-name').value.trim() || this.settings.playerName || 'Tester';
    const verdict = document.getElementById('dc-verdict').value;
    const difficultyRating = Number(document.getElementById('dc-diff-rating').value || 5);
    const funRating = Number(document.getElementById('dc-fun-rating').value || 5);
    const comment = document.getElementById('dc-tester-comment').value.trim();
    const msgEl = document.getElementById('dc-approval-msg');
    msgEl.style.color = '#7dd3fc';
    msgEl.textContent = 'Submitting Tester QA Sign-Off to Cloudflare D1...';

    try {
      const res = await fetch('/api/daily-challenge/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testerName,
          verdict,
          difficultyRating,
          funRating,
          comment,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        msgEl.style.color = '#a3e635';
        msgEl.textContent = `${data.message} (+2 Free ⚡ Boosts credited!)`;
        document.getElementById('dc-tester-comment').value = '';
        this.rewardBonusBoosts(2);
        this.loadDailyChallengeHub();
      }
    } catch (_) {
      msgEl.style.color = '#fca5a5';
      msgEl.textContent = 'Could not reach edge approval endpoint.';
    }
  }

  shareDailyChallenge(channel = 'copy') {
    const c = this.dailyChallengeData?.challenge || {
      dayKey: new Date().toISOString().slice(0, 10),
      seed: 0x20261018,
      levelId: this.currentLevelId,
      levelName: LEVEL_PRESETS[this.currentLevelId]?.name || 'Vault #1',
      targetTimeMs: 44000,
      targetScore: 60000,
    };
    const handle = encodeURIComponent(this.settings.playerName || 'SeolithPlayer');
    const parSec = (c.targetTimeMs / 1000).toFixed(1);
    const shareUrl = `${window.location.origin}/?daily=1&ref=${handle}&level=${c.levelId}&target=${parSec}&pts=${c.targetScore}`;
    const text = `🎯 SEOLITH DAILY CHALLENGE (${c.dayKey}, Seed #${(c.seed >>> 0).toString(16).toUpperCase()}): Can you beat the ${parSec}s Par Time (${Number(c.targetScore).toLocaleString()} pts) on "${c.levelName}"? QA Certified! Play free in your browser:`;

    const statusEl = document.getElementById('dc-share-status');
    this.rewardBonusBoosts(3);
    this.trackEvent('daily_share', c.levelId);

    if (channel === 'x') {
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
        '_blank',
        'noopener,noreferrer'
      );
      statusEl.textContent = '✅ Opened X Share (+3 Free ⚡ Boosts credited!)';
    } else if (channel === 'wa') {
      window.open(
        `https://api.whatsapp.com/send?text=${encodeURIComponent(text + ' ' + shareUrl)}`,
        '_blank',
        'noopener,noreferrer'
      );
      statusEl.textContent = '✅ Opened WhatsApp Share (+3 Free ⚡ Boosts credited!)';
    } else {
      navigator.clipboard?.writeText(`${text} ${shareUrl}`);
      statusEl.textContent = '✅ Daily Challenge Link Copied to Clipboard (+3 Free ⚡ Boosts credited!)';
    }
  }

  async startEdgeCheckout(plan = 'pro_pass') {
    const msgEl = document.getElementById('checkout-status-msg');
    const emailInput = document.getElementById('checkout-email-input');
    const email = emailInput ? emailInput.value.trim() : '';
    msgEl.style.color = '#7dd3fc';
    msgEl.textContent =
      plan === 'pro_pass'
        ? 'Connecting to Cloudflare Edge Checkout ($2.99 Pro Pass)...'
        : 'Connecting to Cloudflare Edge Checkout ($0.99 +15x Boosts)...';

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          playerName: this.settings.playerName || 'SeolithPlayer',
          email,
          sessionId: this.sessionId,
        }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        msgEl.textContent = 'Redirecting to secure Stripe Checkout...';
        window.location.href = data.checkoutUrl;
        return;
      }

      if (data.ok && (data.instantUnlock || data.mode === 'edge_instant' || data.unlockToken)) {
        if (plan === 'pro_pass') {
          SeolithStorage.unlockProPass();
          msgEl.style.color = '#a3e635';
          msgEl.textContent = `✅ ${data.message || 'Seolith Pro Pass Activated!'}`;
        } else {
          this.rewardBonusBoosts(15);
          msgEl.style.color = '#a3e635';
          msgEl.textContent = `✅ +15x Cascade Boost Pack Activated!`;
        }
        this.updateBoostBadge();
        this.updateGeoBadge(this.leaderboard.geo);
        this.trackEvent(plan === 'pro_pass' ? 'checkout_pro' : 'checkout_boosts', this.currentLevelId);
        setTimeout(() => {
          document.getElementById('monetization-modal').classList.add('hidden');
          this.loadLevel(this.currentLevelId, false);
        }, 1100);
      }
    } catch (_) {
      // Offline fallback so player is never blocked
      if (plan === 'pro_pass') {
        SeolithStorage.unlockProPass();
      } else {
        this.rewardBonusBoosts(15);
      }
      this.updateBoostBadge();
      this.updateGeoBadge(this.leaderboard.geo);
      document.getElementById('monetization-modal').classList.add('hidden');
    }
  }

  async runSponsorSpotCountdown() {
    if (this._sponsorRunning) return;
    this._sponsorRunning = true;

    const box = document.getElementById('sponsor-player-box');
    const nameEl = document.getElementById('sponsor-name');
    const headlineEl = document.getElementById('sponsor-headline');
    const ctaEl = document.getElementById('sponsor-cta-link');
    const timerBadge = document.getElementById('sponsor-timer-badge');
    const rewardStatus = document.getElementById('sponsor-reward-status');
    box.classList.remove('hidden');

    try {
      const res = await fetch('/api/monetization');
      const cfg = await res.json();
      if (cfg && cfg.sponsorSpot) {
        nameEl.textContent = `⚡ ${cfg.sponsorSpot.brand || cfg.sponsorSpot.sponsorName || 'Seolith Cloud Edge'}`;
        headlineEl.textContent = cfg.sponsorSpot.headline;
        ctaEl.textContent = `${cfg.sponsorSpot.ctaText} ↗`;
        ctaEl.href = cfg.sponsorSpot.ctaUrl;
      }
    } catch (_) {}

    let remaining = 5;
    timerBadge.textContent = `${remaining}s`;
    rewardStatus.textContent = `Rewarding in ${remaining}s...`;

    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        timerBadge.textContent = `${remaining}s`;
        rewardStatus.textContent = `Rewarding in ${remaining}s...`;
      } else {
        clearInterval(interval);
        timerBadge.textContent = 'DONE';
        rewardStatus.style.color = '#a3e635';
        rewardStatus.textContent = '✅ +3 Boosts & +5 Plays Credited!';
        const stats = SeolithStorage.getStats();
        stats.totalPlays = Math.max(0, (stats.totalPlays || 0) - 5);
        stats.bonusCredits = (stats.bonusCredits ?? 3) + 3;
        SeolithStorage.saveStats(stats);
        this.updateBoostBadge();
        this.updateGeoBadge(this.leaderboard.geo);
        this.trackEvent('sponsor_watch', this.currentLevelId);
        this._sponsorRunning = false;
        setTimeout(() => {
          box.classList.add('hidden');
          document.getElementById('monetization-modal').classList.add('hidden');
        }, 1200);
      }
    }, 1000);
  }

  async loadAdminAnalytics() {
    const email = document.getElementById('admin-email-input').value.trim();
    const key = document.getElementById('admin-key-input').value.trim();
    const msgEl = document.getElementById('admin-auth-msg');
    msgEl.style.color = '#7dd3fc';
    msgEl.textContent = 'Authenticating & fetching live Cloudflare D1 geo-analytics...';

    try {
      const res = await fetch('/api/admin/analytics', {
        headers: {
          'X-Admin-Email': email,
          'X-Admin-Key': key,
          Accept: 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        msgEl.style.color = '#fca5a5';
        msgEl.textContent = data.error || 'Unauthorized Admin Account or Access Key.';
        return;
      }

      localStorage.setItem('seolith_admin_email', email);
      localStorage.setItem('seolith_admin_key', key);

      msgEl.style.color = '#a3e635';
      msgEl.textContent = `✅ Authenticated as ${data.adminEmail} (${data.authMethod})`;
      document.getElementById('admin-dashboard-content').classList.remove('hidden');

      const s = data.summary || {};
      const rev = data.revenue || {};
      document.getElementById('adm-unique').textContent = Number(s.uniqueVisitors || 0).toLocaleString();
      document.getElementById('adm-views').textContent = Number(s.pageviews || 0).toLocaleString();
      document.getElementById('adm-plays').textContent = `${Number(s.playsStarted || 0)} / ${Number(s.totalWins || 0)}`;
      document.getElementById('adm-devices').textContent = `${Number(s.mobileEvents || 0)} / ${Number(s.desktopEvents || 0)}`;
      const revEl = document.getElementById('adm-revenue');
      if (revEl) {
        const dollars = ((Number(rev.totalRevenueCents || 0)) / 100).toFixed(2);
        revEl.textContent = `$${dollars} (${Number(rev.totalOrders || 0)})`;
      }

      const locTbody = document.getElementById('adm-locations-tbody');
      const locs = data.byLocation || [];
      locTbody.innerHTML = locs.length
        ? locs
            .map(
              (l) => `<tr>
              <td><strong>${this.escapeHtml(l.country || 'GL')}</strong></td>
              <td>${this.escapeHtml(l.region || '-')}</td>
              <td>${this.escapeHtml(l.city || '-')}</td>
              <td>${Number(l.visits || 0).toLocaleString()}</td>
              <td style="color:#a3e635;font-weight:700;">${Number(l.uniqueSessions || 0).toLocaleString()}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" style="text-align:center;">No location records yet.</td></tr>';

      const recTbody = document.getElementById('adm-recent-tbody');
      const recent = data.recentVisitors || [];
      recTbody.innerHTML = recent.length
        ? recent
            .map(
              (r) => `<tr>
              <td><span style="color:#facc15;">${this.escapeHtml(r.eventType)}</span></td>
              <td>${this.escapeHtml(r.playerName)}</td>
              <td>${this.escapeHtml(r.city ? `${r.city}, ${r.country}` : r.country)} (${this.escapeHtml(r.colo || 'CF')})</td>
              <td>${this.escapeHtml(r.deviceType)}</td>
              <td>${this.escapeHtml(r.refTag ? `@${r.refTag}` : r.referrer ? r.referrer.slice(0, 24) : 'direct')}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" style="text-align:center;">No recent events yet.</td></tr>';
    } catch (err) {
      msgEl.style.color = '#fca5a5';
      msgEl.textContent = 'Error connecting to edge analytics endpoint.';
    }
  }

  async refreshFeedbackList() {
    const tbody = document.getElementById('fb-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading feedback...</td></tr>';
    try {
      const res = await fetch('/api/feedback?limit=15');
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">No feedback entries yet — submit the first above!</td></tr>';
        return;
      }
      tbody.innerHTML = items
        .map(
          (item) => `<tr>
          <td>v${this.escapeHtml(item.version || '1.1.0')}</td>
          <td><span style="color:#facc15;">${this.escapeHtml(item.category)}</span></td>
          <td>${this.escapeHtml(item.testerName)}</td>
          <td>${this.escapeHtml(item.message)}</td>
        </tr>`
        )
        .join('');
    } catch (_) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Feedback endpoint ready on edge.</td></tr>';
    }
  }

  async refreshLeaderboardTable() {
    const tbody = document.getElementById('lb-tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading ranks...</td></tr>';

    const data = await this.leaderboard.fetchGeoAndTop({
      period: this.lbState.period,
      scope: this.lbState.scope,
      levelId: this.currentLevelId,
      sortBy: this.lbState.sortBy,
    });

    const entries = data.entries || [];
    if (entries.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">No records for this window yet — be the #1 topper!</td></tr>';
      return;
    }

    tbody.innerHTML = entries
      .map((e, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        const timeSec = ((e.elapsedMs || e.elapsed_ms || 45000) / 1000).toFixed(2) + 's';
        const score = Number(e.score || 0).toLocaleString();
        const balls = Number(e.peakBalls || e.peak_balls || 1).toLocaleString();
        const loc = e.city ? `${e.city}, ${e.country}` : e.country || 'GL';
        return `<tr>
          <td><strong>${medal}</strong></td>
          <td>${this.escapeHtml(e.playerName || e.player_name || 'Player')}</td>
          <td style="color:#a3e635;font-weight:700;">${timeSec}</td>
          <td>${score}</td>
          <td>${balls}x</td>
          <td>${this.escapeHtml(loc)}</td>
        </tr>`;
      })
      .join('');
  }

  escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  paintVaultAtWorld(wx, wy) {
    if (wx < VAULT_LEFT || wx > VAULT_RIGHT || wy < VAULT_BOTTOM || wy > VAULT_TOP) return;
    const gw = this.wasm.get_grid_w();
    const gh = this.wasm.get_grid_h();
    const col = Math.floor(((wx - VAULT_LEFT) / (VAULT_RIGHT - VAULT_LEFT)) * gw);
    const row = Math.floor(((wy - VAULT_BOTTOM) / (VAULT_TOP - VAULT_BOTTOM)) * gh);

    for (let dr = 0; dr <= 1; dr++) {
      for (let dc = 0; dc <= 1; dc++) {
        this.wasm.set_custom_tile(col + dc, row + dr, this.paintBrushVal);
      }
    }
  }

  launchBallNow() {
    if (this.wasm.get_status() !== 0) return;
    this.audio.ensureContext();
    this.wasm.set_aim_angle(this.aimAngleRad);
    this.wasm.launch_ball();
    document.getElementById('aim-banner').style.opacity = '0';
    const stats = SeolithStorage.incrementPlayCount();
    this.updateGeoBadge(this.leaderboard.geo);
    this.trackEvent('play_start', this.currentLevelId);
    if (stats.proUnlocked) {
      this.wasm.trigger_bonus_capsule(5);
    }
  }

  setupInputs(canvas) {
    const handlePointerMove = (clientX, clientY) => {
      const world = this.renderer.screenToWorld(clientX, clientY);
      if (this.isEditorMode && this.isPointerDown) {
        this.paintVaultAtWorld(world.x, world.y);
        return;
      }

      if (this.wasm.get_status() === 0) {
        if (world.y > 0.28) {
          const px = this.wasm.get_paddle_x();
          const py = this.wasm.get_paddle_y();
          this.aimAngleRad = Math.atan2(world.x - px, Math.max(0.15, world.y - py));
          this.wasm.set_aim_angle(this.aimAngleRad);
        } else {
          this.wasm.set_paddle_x(world.x);
        }
      } else {
        this.wasm.set_paddle_x(world.x);
      }
    };

    canvas.addEventListener('pointerdown', (e) => {
      this.audio.ensureContext();
      this.isPointerDown = true;
      const world = this.renderer.screenToWorld(e.clientX, e.clientY);
      if (this.isEditorMode) {
        this.paintVaultAtWorld(world.x, world.y);
        return;
      }
      handlePointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('pointermove', (e) => {
      if (e.target === canvas || this.isPointerDown) {
        handlePointerMove(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (this.isPointerDown && !this.isEditorMode && e.target === canvas) {
        if (this.wasm.get_status() === 0) {
          this.launchBallNow();
        }
      }
      this.isPointerDown = false;
    });

    this.keys = {};
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.wasm.get_status() === 0) {
          e.preventDefault();
          this.launchBallNow();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.wasm) {
        SeolithStorage.saveLiveSnapshot(this.wasm, this.currentLevelId);
      }
    });
  }

  handleResize() {
    const frame = document.getElementById('canvas-frame');
    if (!frame || !this.renderer) return;
    const rect = frame.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
  }

  renderCapsuleTextOverlay(capsules) {
    const container = document.getElementById('capsule-labels');
    if (capsules.length === 0) {
      if (container.childElementCount > 0) container.innerHTML = '';
      return;
    }

    const labels = {
      1: '×3',
      2: '+3',
      3: '↔',
      4: '−',
      5: '★',
    };

    container.innerHTML = capsules
      .map((c) => {
        const pos = this.renderer.worldToCssPercent(c.x, c.y);
        return `<span class="cap-badge" style="left:${pos.xPct.toFixed(1)}%;top:${pos.yPct.toFixed(1)}%;">${labels[c.kind] || '×3'}</span>`;
      })
      .join('');
  }

  onGameEnd(status) {
    SeolithStorage.clearLiveSnapshot();
    this.trackEvent(status === 2 ? 'win' : 'lose', this.currentLevelId);
    const elapsedMs = this.wasm.get_elapsed_ms();
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    const score = this.wasm.get_score();
    const peakBalls = this.wasm.get_peak_balls_count();

    const modal = document.getElementById('result-modal');
    const title = document.getElementById('result-title');
    const subtitle = document.getElementById('result-subtitle');
    const starsEl = document.getElementById('result-stars');

    document.getElementById('res-time').textContent = `${elapsedSec}s`;
    document.getElementById('res-score').textContent = score.toLocaleString();
    document.getElementById('res-balls').textContent = peakBalls.toLocaleString();

    if (this.recorder.isRecording) {
      this.recorder.stopRecording().then(() => {
        document.getElementById('btn-record').classList.remove('recording');
        document.getElementById('btn-record').textContent = '⏺ Rec';
        document.getElementById('btn-download-video').classList.remove('hidden');
      });
    } else if (this.recorder.lastVideoUrl) {
      document.getElementById('btn-download-video').classList.remove('hidden');
    }

    if (status === 2) {
      this.audio.playVictoryFanfare();
      const stars = elapsedMs < 60000 ? 3 : elapsedMs < 95000 ? 2 : 1;
      title.textContent = 'Congratulations';
      subtitle.textContent = 'You win!';
      starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);

      SeolithStorage.recordWin({
        levelId: this.currentLevelId,
        score,
        elapsedMs,
        peakBalls,
        stars,
      });

      const proof = this.wasm.compute_run_proof(
        this.currentLevelId,
        score,
        Math.round(elapsedMs),
        peakBalls
      );
      this.leaderboard.submitScore({
        playerName: this.settings.playerName,
        levelId: this.currentLevelId,
        score,
        elapsedMs,
        peakBalls,
        proof,
      });

      if (this.isDailyChallengeActive) {
        const aimDeg = Number(((this.aimAngleRad * 180) / Math.PI).toFixed(1));
        fetch('/api/daily-challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerName: this.settings.playerName || 'SeolithPlayer',
            score,
            elapsedMs: Math.round(elapsedMs),
            peakBalls,
            aimDeg,
            boostsUsed: this.currentRunBoostsUsed || 0,
            proof,
          }),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.ok) {
              const bonus = res.beatTarget ? 3 : 1;
              this.rewardBonusBoosts(bonus);
              subtitle.textContent = res.beatTarget
                ? `🎯 DAILY CHALLENGE PAR BEATEN! (+${bonus} ⚡ Boosts Earned!)`
                : `🎯 Daily Challenge Cleared! (+${bonus} ⚡ Boost Earned!)`;
            }
          })
          .catch(() => {});
      }
    } else {
      title.textContent = 'Vault Breach Lost';
      subtitle.textContent = `${this.wasm.get_remaining_bricks().toLocaleString()} micro-tiles remaining`;
      starsEl.textContent = '☆☆☆';
    }

    modal.classList.remove('hidden');
  }

  loop(now) {
    const dt = Math.min(0.033, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (this.keys['ArrowLeft'] || this.keys['KeyA']) {
      this.wasm.set_paddle_x(this.wasm.get_paddle_x() - 0.65 * dt);
    }
    if (this.keys['ArrowRight'] || this.keys['KeyD']) {
      this.wasm.set_paddle_x(this.wasm.get_paddle_x() + 0.65 * dt);
    }
    if (this.keys['ArrowUp'] || this.keys['KeyW']) {
      this.aimAngleRad = Math.max(-1.05, this.aimAngleRad - 1.2 * dt);
      this.wasm.set_aim_angle(this.aimAngleRad);
    }
    if (this.keys['ArrowDown'] || this.keys['KeyS']) {
      this.aimAngleRad = Math.min(1.05, this.aimAngleRad + 1.2 * dt);
      this.wasm.set_aim_angle(this.aimAngleRad);
    }

    this.wasm.step_physics(dt);

    const brickHits = this.wasm.get_frame_brick_hits();
    const paddleHits = this.wasm.get_frame_paddle_hits();
    const wallHits = this.wasm.get_frame_wall_hits();
    const powerupKind = this.wasm.get_frame_powerup_collected();

    if (brickHits > 0) {
      this.audio.playBrickHits(brickHits, this.wasm.get_last_hit_row_norm(), brickHits);
    } else if (paddleHits > 0) {
      this.audio.playWallOrPaddle(true);
    } else if (wallHits > 0 && this.wasm.get_active_balls_count() < 12) {
      this.audio.playWallOrPaddle(false);
    }

    if (powerupKind > 0) {
      this.audio.playPowerup(powerupKind);
    }

    const activeCaps = this.renderer.renderFrame(this.wasm, this.aimAngleRad);
    this.renderCapsuleTextOverlay(activeCaps);

    const remBricks = this.wasm.get_remaining_bricks();
    const initBricks = Math.max(1, this.wasm.get_initial_bricks());
    const activeBalls = this.wasm.get_active_balls_count();
    const elapsedSec = (this.wasm.get_elapsed_ms() / 1000).toFixed(1);
    const score = this.wasm.get_score();

    this.audio.activeBallsRef = activeBalls;

    document.getElementById('hud-bricks').textContent = remBricks.toLocaleString();
    document.getElementById('hud-balls').textContent = activeBalls.toLocaleString();
    document.getElementById('hud-time').textContent = `${elapsedSec}s`;
    document.getElementById('hud-score').textContent = score.toLocaleString();

    const pct = Math.min(100, Math.max(0, ((initBricks - remBricks) / initBricks) * 100));
    document.getElementById('hud-progress').style.width = `${pct.toFixed(1)}%`;

    const status = this.wasm.get_status();
    if (status === 1 && now - this.lastSaveAt > 2500) {
      this.lastSaveAt = now;
      SeolithStorage.saveLiveSnapshot(this.wasm, this.currentLevelId);
    }

    if (status !== this.lastStatus) {
      if (status === 2 || status === 3) {
        this.onGameEnd(status);
      }
      this.lastStatus = status;
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const game = new SeolithTilesGame();
  game.init();
});
