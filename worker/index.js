// worker/index.js
// Cloudflare Worker serving static assets + Edge Geo-Location & Time-Windowed Leaderboards (D1)

function computeExpectedProof(levelId, score, elapsedMs, peakBalls) {
  let h = 0x811c9dc5 >>> 0;
  const words = [
    (levelId ^ 0x5e011740) >>> 0,
    Math.imul(score >>> 0, 31) >>> 0,
    Math.imul(elapsedMs >>> 0, 17) >>> 0,
    Math.imul(peakBalls >>> 0, 131) >>> 0,
    0xcafebabe >>> 0,
  ];
  for (const w of words) {
    for (let shift = 0; shift <= 24; shift += 8) {
      h ^= (w >>> shift) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

function getTimeKeys(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  // ISO week calculation
  const tmp = new Date(Date.UTC(yyyy, date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);

  return {
    dayKey: `${yyyy}-${mm}-${dd}`,
    weekKey: `${yyyy}-W${String(weekNo).padStart(2, '0')}`,
    monthKey: `${yyyy}-${mm}`,
    yearKey: `${yyyy}`,
  };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cf = request.cf || {};
    const geo = {
      country: cf.country || 'US',
      region: cf.region || 'Global',
      city: cf.city || '',
      continent: cf.continent || 'NA',
    };

    if (url.pathname === '/api/leaderboard') {
      if (request.method === 'GET') {
        const period = url.searchParams.get('period') || 'daily'; // daily | weekly | monthly | yearly
        const scope = url.searchParams.get('scope') || 'global';  // global | country | region
        const levelId = Number(url.searchParams.get('levelId') || 0);
        const sortBy = url.searchParams.get('sortBy') === 'score' ? 'score' : 'time';

        const keys = getTimeKeys(new Date());
        let whereClause = 'WHERE level_id = ?1';
        const params = [levelId];

        if (period === 'daily') {
          whereClause += ` AND day_key = ?${params.length + 1}`;
          params.push(keys.dayKey);
        } else if (period === 'weekly') {
          whereClause += ` AND week_key = ?${params.length + 1}`;
          params.push(keys.weekKey);
        } else if (period === 'monthly') {
          whereClause += ` AND month_key = ?${params.length + 1}`;
          params.push(keys.monthKey);
        } else if (period === 'yearly') {
          whereClause += ` AND year_key = ?${params.length + 1}`;
          params.push(keys.yearKey);
        }

        if (scope === 'country') {
          whereClause += ` AND country = ?${params.length + 1}`;
          params.push(geo.country);
        } else if (scope === 'region') {
          whereClause += ` AND country = ?${params.length + 1} AND region = ?${params.length + 2}`;
          params.push(geo.country, geo.region);
        }

        const orderBy =
          sortBy === 'score'
            ? 'ORDER BY score DESC, elapsed_ms ASC'
            : 'ORDER BY elapsed_ms ASC, score DESC';

        if (env.DB) {
          try {
            const stmt = env.DB.prepare(
              `SELECT player_name AS playerName, level_id AS levelId, score, elapsed_ms AS elapsedMs, peak_balls AS peakBalls, country, region, city, created_at AS createdAt
               FROM leaderboard_runs
               ${whereClause}
               ${orderBy}
               LIMIT 25`
            ).bind(...params);

            const { results } = await stmt.all();
            return Response.json(
              { geo, period, scope, sortBy, entries: results || [] },
              { headers: SECURITY_HEADERS }
            );
          } catch (err) {
            return Response.json(
              { geo, period, scope, entries: [], error: err.message },
              { headers: SECURITY_HEADERS }
            );
          }
        }

        return Response.json(
          { geo, period, scope, entries: [] },
          { headers: SECURITY_HEADERS }
        );
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const playerName = String(body.playerName || 'Player')
            .replace(/[^\w\-\s.]/g, '')
            .trim()
            .slice(0, 20) || 'Player';
          const levelId = Math.max(0, Math.min(10, Number(body.levelId) || 0));
          const score = Math.max(0, Math.min(2_000_000, Math.round(Number(body.score) || 0)));
          const elapsedMs = Math.max(3000, Math.min(3_600_000, Math.round(Number(body.elapsedMs) || 60000)));
          const peakBalls = Math.max(1, Math.min(1600, Math.round(Number(body.peakBalls) || 1)));
          const proof = (Number(body.proof) || 0) >>> 0;

          // Verify deterministic WASM run proof to prevent spoofed scores
          const expected = computeExpectedProof(levelId, score, elapsedMs, peakBalls);
          if (proof !== expected) {
            return Response.json(
              { ok: false, error: 'Invalid run proof signature' },
              { status: 400, headers: SECURITY_HEADERS }
            );
          }

          const keys = getTimeKeys(new Date());
          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO leaderboard_runs (
                player_name, level_id, score, elapsed_ms, peak_balls, proof,
                country, region, city, day_key, week_key, month_key, year_key, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
            )
              .bind(
                playerName,
                levelId,
                score,
                elapsedMs,
                peakBalls,
                proof,
                geo.country,
                geo.region,
                geo.city,
                keys.dayKey,
                keys.weekKey,
                keys.monthKey,
                keys.yearKey,
                new Date().toISOString()
              )
              .run();
          }

          return Response.json({ ok: true, geo }, { headers: SECURITY_HEADERS });
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Invalid payload' },
            { status: 400, headers: SECURITY_HEADERS }
          );
        }
      }
    }

    // Serve static frontend assets (Vite dist/)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Seolith Tiles Edge Worker Active', {
      headers: SECURITY_HEADERS,
    });
  },
};
