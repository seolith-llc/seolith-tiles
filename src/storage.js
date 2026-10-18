// src/storage.js
// Handles LocalStorage Auto-Save/Resume of live WASM game states, User Customization Settings,
// Personal Best Records, and the 100-Play Monetization Gate.

const KEYS = {
  SNAPSHOT: 'seolith_tiles_live_snapshot_v1',
  SETTINGS: 'seolith_tiles_settings_v1',
  STATS: 'seolith_tiles_stats_v1',
  CUSTOM_LEVEL: 'seolith_tiles_custom_level_v1',
};

export const MONETIZATION_FREE_PLAYS_LIMIT = 100;

export class SeolithStorage {
  static getSettings() {
    try {
      const raw = localStorage.getItem(KEYS.SETTINGS);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      playerName: 'Player-' + Math.floor(1000 + Math.random() * 9000),
      themeId: 'crimson_viral',
      customColors: null,
      gridSize: 64,
      tiltDeg: 0,
      sfxEnabled: true,
      musicEnabled: false,
      soundProfile: 'asmr-wood',
      aspectMode: 'portrait', // 'portrait' | 'wide'
    };
  }

  static saveSettings(settings) {
    try {
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
    } catch (_) {}
  }

  static getStats() {
    try {
      const raw = localStorage.getItem(KEYS.STATS);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      totalPlays: 0,
      totalWins: 0,
      bestScore: 0,
      bestTimeMs: null,
      proUnlocked: false,
      bonusCredits: 3,
      history: [],
    };
  }

  static saveStats(stats) {
    try {
      localStorage.setItem(KEYS.STATS, JSON.stringify(stats));
    } catch (_) {}
  }

  static incrementPlayCount() {
    const stats = this.getStats();
    stats.totalPlays = (stats.totalPlays || 0) + 1;
    this.saveStats(stats);
    return stats;
  }

  static recordWin({ levelId, score, elapsedMs, peakBalls, stars }) {
    const stats = this.getStats();
    stats.totalWins = (stats.totalWins || 0) + 1;
    if (score > (stats.bestScore || 0)) {
      stats.bestScore = score;
    }
    if (!stats.bestTimeMs || elapsedMs < stats.bestTimeMs) {
      stats.bestTimeMs = Math.round(elapsedMs);
    }
    stats.history = [
      {
        ts: new Date().toISOString(),
        levelId,
        score,
        elapsedMs: Math.round(elapsedMs),
        peakBalls,
        stars,
      },
      ...(stats.history || []).slice(0, 24),
    ];
    this.saveStats(stats);
    return stats;
  }

  static isMonetizationGateActive() {
    const stats = this.getStats();
    return stats.totalPlays >= MONETIZATION_FREE_PLAYS_LIMIT && !stats.proUnlocked;
  }

  static unlockProPass() {
    const stats = this.getStats();
    stats.proUnlocked = true;
    stats.bonusCredits = (stats.bonusCredits || 0) + 25;
    this.saveStats(stats);
    return stats;
  }

  // Save live WASM game state to LocalStorage so the player can close the browser and resume anytime!
  static saveLiveSnapshot(wasm, currentLevelId) {
    try {
      const status = wasm.get_status();
      // Only persist if game is actively playing and bricks remain
      if (status !== 1) {
        this.clearLiveSnapshot();
        return;
      }

      const gridW = wasm.get_grid_w();
      const gridH = wasm.get_grid_h();
      const totalCells = gridW * gridH;
      const tilesView = new Uint8Array(wasm.memory.buffer, wasm.get_tiles_ptr(), totalCells);

      // Base64 encode the tile array for compact storage
      let binary = '';
      for (let i = 0; i < totalCells; i++) {
        binary += String.fromCharCode(tilesView[i]);
      }
      const tilesB64 = btoa(binary);

      // Save up to 250 active balls so resuming mid-cascade is instant and lightweight
      const maxBalls = wasm.get_max_balls();
      const ballsFloats = new Float32Array(wasm.memory.buffer, wasm.get_balls_ptr(), maxBalls * 6);
      const savedBalls = [];
      for (let i = 0; i < maxBalls && savedBalls.length < 250; i++) {
        const base = i * 6;
        if (ballsFloats[base + 4] > 0.5) {
          savedBalls.push([
            Number(ballsFloats[base].toFixed(4)),
            Number(ballsFloats[base + 1].toFixed(4)),
            Number(ballsFloats[base + 2].toFixed(4)),
            Number(ballsFloats[base + 3].toFixed(4)),
            ballsFloats[base + 5],
          ]);
        }
      }

      const snapshot = {
        savedAt: Date.now(),
        levelId: currentLevelId,
        gridW,
        gridH,
        status,
        score: wasm.get_score(),
        elapsedMs: wasm.get_elapsed_ms(),
        paddleX: wasm.get_paddle_x(),
        paddleW: wasm.get_paddle_w(),
        safetyFloorTimer: wasm.get_safety_floor_timer(),
        peakBalls: wasm.get_peak_balls_count(),
        tilesB64,
        balls: savedBalls,
      };

      localStorage.setItem(KEYS.SNAPSHOT, JSON.stringify(snapshot));
    } catch (_) {}
  }

  static getLiveSnapshot() {
    try {
      const raw = localStorage.getItem(KEYS.SNAPSHOT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  static restoreSnapshotIntoWasm(wasm, snapshot) {
    if (!snapshot) return false;
    try {
      wasm.init_engine(snapshot.gridW, snapshot.gridH, Date.now() & 0xffffffff);
      const totalCells = snapshot.gridW * snapshot.gridH;
      const tilesView = new Uint8Array(wasm.memory.buffer, wasm.get_tiles_ptr(), totalCells);
      const bin = atob(snapshot.tilesB64);
      for (let i = 0; i < totalCells && i < bin.length; i++) {
        tilesView[i] = bin.charCodeAt(i);
      }

      const maxBalls = wasm.get_max_balls();
      const ballsFloats = new Float32Array(wasm.memory.buffer, wasm.get_balls_ptr(), maxBalls * 6);
      ballsFloats.fill(0);

      const balls = snapshot.balls || [];
      for (let i = 0; i < balls.length && i < maxBalls; i++) {
        const b = balls[i];
        const base = i * 6;
        ballsFloats[base] = b[0];
        ballsFloats[base + 1] = b[1];
        ballsFloats[base + 2] = b[2];
        ballsFloats[base + 3] = b[3];
        ballsFloats[base + 4] = 1.0;
        ballsFloats[base + 5] = b[4] || 0;
      }

      wasm.restore_snapshot(
        1, // STATUS_PLAYING
        snapshot.score || 0,
        snapshot.elapsedMs || 0,
        snapshot.paddleX || 0.5,
        snapshot.paddleW || 0.18,
        snapshot.safetyFloorTimer || 0,
        balls.length,
        Math.max(snapshot.peakBalls || 1, balls.length)
      );
      return true;
    } catch (e) {
      console.error('Failed to restore snapshot:', e);
      return false;
    }
  }

  static clearLiveSnapshot() {
    try {
      localStorage.removeItem(KEYS.SNAPSHOT);
    } catch (_) {}
  }
}
