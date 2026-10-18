// src/leaderboard.js
// Client for Daily, Weekly, Monthly, Yearly & Location-Scoped Leaderboards (Cloudflare Worker + D1)
// Includes local fallback caching so leaderboards work offline or during local development.

const LOCAL_LB_KEY = 'seolith_tiles_local_leaderboard_v1';

export class SeolithLeaderboard {
  constructor() {
    this.geo = {
      country: 'US',
      region: 'Local',
      city: 'Edge',
      label: 'Global Edge',
    };
  }

  async fetchGeoAndTop({ period = 'daily', scope = 'global', levelId = 0, sortBy = 'time' } = {}) {
    try {
      const params = new URLSearchParams({
        period,
        scope,
        levelId: String(levelId),
        sortBy,
      });
      const res = await fetch(`/api/leaderboard?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.geo) {
          this.geo = data.geo;
        }
        return data;
      }
    } catch (_) {}

    // Offline / local fallback
    return {
      geo: this.geo,
      period,
      scope,
      entries: this.getLocalEntries({ period, levelId, sortBy }),
    };
  }

  async submitScore({ playerName, levelId, score, elapsedMs, peakBalls, proof }) {
    const entry = {
      playerName: (playerName || 'Anon').slice(0, 20),
      levelId,
      score: Math.round(score),
      elapsedMs: Math.round(elapsedMs),
      peakBalls: Math.round(peakBalls),
      proof: proof >>> 0,
      country: this.geo.country || 'GL',
      region: this.geo.region || 'Global',
      city: this.geo.city || '',
      createdAt: new Date().toISOString(),
    };

    this.saveLocalEntry(entry);

    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return { ok: true, localOnly: true };
  }

  saveLocalEntry(entry) {
    try {
      const raw = localStorage.getItem(LOCAL_LB_KEY);
      const list = raw ? JSON.parse(raw) : this.getSeedEntries();
      list.push(entry);
      localStorage.setItem(LOCAL_LB_KEY, JSON.stringify(list.slice(-200)));
    } catch (_) {}
  }

  getSeedEntries() {
    const now = new Date().toISOString();
    return [
      {
        playerName: 'iwhale_fan',
        levelId: 0,
        score: 68420,
        elapsedMs: 42800,
        peakBalls: 980,
        country: 'TH',
        region: 'Bangkok',
        city: 'Bangkok',
        createdAt: now,
      },
      {
        playerName: 'SeolithMaster',
        levelId: 0,
        score: 64150,
        elapsedMs: 48200,
        peakBalls: 810,
        country: 'US',
        region: 'California',
        city: 'San Francisco',
        createdAt: now,
      },
      {
        playerName: 'HirokuBreaker',
        levelId: 0,
        score: 59800,
        elapsedMs: 54900,
        peakBalls: 729,
        country: 'JP',
        region: 'Tokyo',
        city: 'Tokyo',
        createdAt: now,
      },
      {
        playerName: 'VarrelCascade',
        levelId: 1,
        score: 57200,
        elapsedMs: 39400,
        peakBalls: 650,
        country: 'US',
        region: 'New York',
        city: 'New York',
        createdAt: now,
      },
    ];
  }

  getLocalEntries({ levelId = 0, sortBy = 'time' }) {
    try {
      const raw = localStorage.getItem(LOCAL_LB_KEY);
      const list = raw ? JSON.parse(raw) : this.getSeedEntries();
      const filtered = list.filter((x) => Number(x.levelId) === Number(levelId));
      if (sortBy === 'score') {
        filtered.sort((a, b) => b.score - a.score || a.elapsedMs - b.elapsedMs);
      } else {
        filtered.sort((a, b) => a.elapsedMs - b.elapsedMs || b.score - a.score);
      }
      return filtered.slice(0, 25);
    } catch (_) {
      return [];
    }
  }
}
