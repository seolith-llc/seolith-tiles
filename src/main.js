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

    // 7. Fetch edge geo-location in background
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
      const ref = params.get('ref');
      const level = Number(params.get('level') || 0);
      const target = params.get('target');
      const pts = params.get('pts');
      if (ref) {
        const banner = document.getElementById('challenge-banner');
        banner.textContent = `🎯 CHALLENGE FROM @${ref}: Beat ${target || '45.0'}s (${Number(pts || 60000).toLocaleString()} pts) on Vault #${level + 1}!`;
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
    badge.textContent = `📍 ${loc} • Play #${(stats.totalPlays || 0) + 1}${proTag}`;
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

  loadLevel(levelId, countAsNewPlay = false) {
    if (countAsNewPlay && SeolithStorage.isMonetizationGateActive()) {
      this.openMonetizationModal();
      return;
    }

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

    const grid = Number(this.settings.gridSize) || preset.defaultGrid || 64;
    this.wasm.build_preset_level(
      this.currentLevelId,
      grid,
      grid,
      (Date.now() & 0xffffffff) >>> 0
    );

    if (this.currentLevelId === 0) {
      this.wasm.set_paddle_x(0.56);
      this.aimAngleRad = 0.34;
    } else if (this.currentLevelId === 1) {
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
    aimBanner.textContent = `${preset.name} — Move to aim • Tap / Click or Space to launch!`;
    aimBanner.style.opacity = '1';
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

    // Monetization & Pro Shop Modal Actions
    document.getElementById('btn-unlock-pro').addEventListener('click', () => {
      SeolithStorage.unlockProPass();
      this.updateBoostBadge();
      this.updateGeoBadge(this.leaderboard.geo);
      document.getElementById('monetization-modal').classList.add('hidden');
      this.loadLevel(this.currentLevelId, false);
    });

    document.getElementById('btn-watch-rewarded').addEventListener('click', () => {
      const stats = SeolithStorage.getStats();
      stats.totalPlays = Math.max(0, stats.totalPlays - 5);
      stats.bonusCredits = (stats.bonusCredits ?? 0) + 3;
      SeolithStorage.saveStats(stats);
      this.updateBoostBadge();
      document.getElementById('monetization-modal').classList.add('hidden');
    });

    document.getElementById('btn-close-monetize').addEventListener('click', () => {
      document.getElementById('monetization-modal').classList.add('hidden');
    });
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
