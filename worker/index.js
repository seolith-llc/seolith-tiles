// worker/index.js
// Cloudflare Worker serving static assets + Edge Geo-Location & Time-Windowed Leaderboards (D1)
// + Tester Feedback & Bug Reporting API (/api/feedback)
// + Visitor Geo-Analytics & Admin Dashboard API (/api/analytics, /api/admin/analytics)

const APP_VERSION = '1.2.0';

// Default Admin Accounts (override via Cloudflare Worker Secret `ADMIN_EMAILS`)
const DEFAULT_ADMIN_EMAILS = [
  'admin@seolith.com',
];
// Never hardcode a key: set `ADMIN_ACCESS_KEY` as a Cloudflare Worker secret.
const DEFAULT_ADMIN_KEY = '';

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

let schemaInitialized = false;
async function ensureSchema(db) {
  if (!db || schemaInitialized) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS tester_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tester_name TEXT NOT NULL DEFAULT 'Anonymous',
          category TEXT NOT NULL DEFAULT 'bug',
          severity TEXT NOT NULL DEFAULT 'normal',
          version TEXT NOT NULL DEFAULT '1.2.0',
          level_id INTEGER NOT NULL DEFAULT 0,
          message TEXT NOT NULL,
          device_info TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS visitor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          player_name TEXT NOT NULL DEFAULT 'Anon',
          event_type TEXT NOT NULL DEFAULT 'pageview',
          level_id INTEGER NOT NULL DEFAULT 0,
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          city TEXT NOT NULL DEFAULT '',
          continent TEXT NOT NULL DEFAULT '',
          timezone TEXT NOT NULL DEFAULT '',
          colo TEXT NOT NULL DEFAULT '',
          referrer TEXT NOT NULL DEFAULT '',
          ref_tag TEXT NOT NULL DEFAULT '',
          device_type TEXT NOT NULL DEFAULT 'desktop',
          user_agent TEXT NOT NULL DEFAULT '',
          day_key TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`
      )
      .run();

    schemaInitialized = true;
  } catch (_) {}
}

function isAuthorizedAdmin(request, env) {
  const url = new URL(request.url);

  // 1. Check Cloudflare Access Zero-Trust Header (if Cloudflare Access is enabled on the domain)
  const cfAccessEmail = (
    request.headers.get('Cf-Access-Authenticated-User-Email') || ''
  )
    .toLowerCase()
    .trim();

  const allowedEmails = (
    env.ADMIN_EMAILS ? env.ADMIN_EMAILS.split(',') : DEFAULT_ADMIN_EMAILS
  ).map((e) => e.toLowerCase().trim());

  if (cfAccessEmail && allowedEmails.includes(cfAccessEmail)) {
    return { authorized: true, adminEmail: cfAccessEmail, method: 'cloudflare-access' };
  }

  // 2. Check Admin Email + Admin Key via Header or Query Params
  const reqEmail = (
    request.headers.get('X-Admin-Email') ||
    url.searchParams.get('email') ||
    ''
  )
    .toLowerCase()
    .trim();
  const reqKey = (
    request.headers.get('X-Admin-Key') ||
    url.searchParams.get('key') ||
    ''
  ).trim();

  const expectedKey = (env.ADMIN_ACCESS_KEY || DEFAULT_ADMIN_KEY).trim();
  if (expectedKey.length > 0 && allowedEmails.includes(reqEmail) && reqKey === expectedKey) {
    return { authorized: true, adminEmail: reqEmail, method: 'admin-key' };
  }

  return { authorized: false, adminEmail: null, method: 'none' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cf = request.cf || {};
    const geo = {
      country: cf.country || 'US',
      region: cf.region || 'Global',
      city: cf.city || '',
      continent: cf.continent || 'NA',
      timezone: cf.timezone || 'UTC',
      colo: cf.colo || 'IAD',
    };

    // 1. Version Info Endpoint
    if (url.pathname === '/api/version') {
      return Response.json(
        {
          version: APP_VERSION,
          updatedAt: '2026-10-18T08:25:00-04:00',
          geo,
        },
        { headers: SECURITY_HEADERS }
      );
    }

    // 2. Visitor Geo-Analytics Ingestion Endpoint (POST /api/analytics)
    if (url.pathname === '/api/analytics' && request.method === 'POST') {
      await ensureSchema(env.DB);
      try {
        const body = await request.json();
        const sessionId = String(body.sessionId || 'anon').slice(0, 48);
        const playerName = String(body.playerName || 'Anon')
          .replace(/[^\w\-\s.@]/g, '')
          .trim()
          .slice(0, 24) || 'Anon';
        const eventType = [
          'pageview',
          'play_start',
          'win',
          'lose',
          'share',
          'pro_click',
          'feedback',
        ].includes(body.eventType)
          ? body.eventType
          : 'pageview';
        const levelId = Math.max(0, Math.min(20, Number(body.levelId) || 0));
        const referrer = String(body.referrer || request.headers.get('Referer') || '').slice(0, 180);
        const refTag = String(body.refTag || '').slice(0, 32);
        const ua = String(request.headers.get('User-Agent') || '').slice(0, 180);
        const deviceType = /Mobile|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
        const { dayKey } = getTimeKeys(new Date());

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO visitor_events (
              session_id, player_name, event_type, level_id,
              country, region, city, continent, timezone, colo,
              referrer, ref_tag, device_type, user_agent, day_key, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
          )
            .bind(
              sessionId,
              playerName,
              eventType,
              levelId,
              geo.country,
              geo.region,
              geo.city,
              geo.continent,
              geo.timezone,
              geo.colo,
              referrer,
              refTag,
              deviceType,
              ua,
              dayKey,
              new Date().toISOString()
            )
            .run();
        }
        return Response.json({ ok: true, geo }, { headers: SECURITY_HEADERS });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 400, headers: SECURITY_HEADERS });
      }
    }

    // 3. Protected Admin Geo-Analytics Dashboard Endpoint (GET /api/admin/analytics)
    if (url.pathname === '/api/admin/analytics' && request.method === 'GET') {
      await ensureSchema(env.DB);
      const auth = isAuthorizedAdmin(request, env);
      if (!auth.authorized) {
        return Response.json(
          {
            ok: false,
            error: 'Unauthorized Admin Account. Please provide a valid Admin Email (e.g. admin@seolith.com) and Admin Key.',
          },
          { status: 401, headers: SECURITY_HEADERS }
        );
      }

      if (!env.DB) {
        return Response.json({ ok: true, summary: {}, countries: [], cities: [], recent: [] }, { headers: SECURITY_HEADERS });
      }

      try {
        // Summary totals
        const totalsStmt = await env.DB.prepare(
          `SELECT
            COUNT(*) AS totalEvents,
            COUNT(DISTINCT session_id) AS uniqueVisitors,
            SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
            SUM(CASE WHEN event_type = 'play_start' THEN 1 ELSE 0 END) AS playsStarted,
            SUM(CASE WHEN event_type = 'win' THEN 1 ELSE 0 END) AS totalWins,
            SUM(CASE WHEN event_type = 'share' THEN 1 ELSE 0 END) AS totalShares,
            SUM(CASE WHEN device_type = 'mobile' THEN 1 ELSE 0 END) AS mobileEvents,
            SUM(CASE WHEN device_type = 'desktop' THEN 1 ELSE 0 END) AS desktopEvents
           FROM visitor_events`
        ).first();

        // Top Countries & Regions
        const { results: byCountry } = await env.DB.prepare(
          `SELECT country, region, city, COUNT(*) AS visits, COUNT(DISTINCT session_id) AS uniqueSessions
           FROM visitor_events
           GROUP BY country, region, city
           ORDER BY visits DESC
           LIMIT 25`
        ).all();

        // Top Referrers / Viral Challenge Tags (?ref=...)
        const { results: byReferral } = await env.DB.prepare(
          `SELECT ref_tag AS refTag, referrer, COUNT(*) AS count
           FROM visitor_events
           WHERE ref_tag != '' OR referrer != ''
           GROUP BY ref_tag, referrer
           ORDER BY count DESC
           LIMIT 15`
        ).all();

        // Recent Live Visitor Stream
        const { results: recentVisitors } = await env.DB.prepare(
          `SELECT id, session_id AS sessionId, player_name AS playerName, event_type AS eventType, level_id AS levelId,
                  country, region, city, colo, timezone, device_type AS deviceType, ref_tag AS refTag, referrer, created_at AS createdAt
           FROM visitor_events
           ORDER BY id DESC
           LIMIT 40`
        ).all();

        return Response.json(
          {
            ok: true,
            adminEmail: auth.adminEmail,
            authMethod: auth.method,
            summary: totalsStmt || {},
            byLocation: byCountry || [],
            byReferral: byReferral || [],
            recentVisitors: recentVisitors || [],
          },
          { headers: SECURITY_HEADERS }
        );
      } catch (err) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 500, headers: SECURITY_HEADERS }
        );
      }
    }

    // 4. Tester Feedback & Bug Reporting Endpoint
    if (url.pathname === '/api/feedback') {
      await ensureSchema(env.DB);
      if (request.method === 'GET') {
        const statusFilter = url.searchParams.get('status') || 'all';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

        if (env.DB) {
          try {
            let query = `SELECT id, tester_name AS testerName, category, severity, version, level_id AS levelId, message, device_info AS deviceInfo, country, region, status, created_at AS createdAt FROM tester_feedback`;
            const params = [];
            if (statusFilter !== 'all') {
              query += ` WHERE status = ?1`;
              params.push(statusFilter);
            }
            query += ` ORDER BY id DESC LIMIT ${limit}`;

            const stmt = params.length
              ? env.DB.prepare(query).bind(...params)
              : env.DB.prepare(query);
            const { results } = await stmt.all();
            return Response.json(
              { ok: true, version: APP_VERSION, count: (results || []).length, items: results || [] },
              { headers: SECURITY_HEADERS }
            );
          } catch (err) {
            return Response.json(
              { ok: false, error: err.message, items: [] },
              { headers: SECURITY_HEADERS }
            );
          }
        }
        return Response.json({ ok: true, items: [] }, { headers: SECURITY_HEADERS });
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const testerName =
            String(body.testerName || 'Tester')
              .replace(/[^\w\-\s.@]/g, '')
              .trim()
              .slice(0, 32) || 'Tester';
          const category = ['bug', 'improvement', 'physics', 'design', 'monetization'].includes(
            body.category
          )
            ? body.category
            : 'improvement';
          const severity = ['low', 'normal', 'high', 'critical'].includes(body.severity)
            ? body.severity
            : 'normal';
          const version = String(body.version || APP_VERSION).slice(0, 16);
          const levelId = Math.max(0, Math.min(20, Number(body.levelId) || 0));
          const message = String(body.message || '')
            .trim()
            .slice(0, 1200);
          const deviceInfo = String(body.deviceInfo || '')
            .trim()
            .slice(0, 240);

          if (!message || message.length < 3) {
            return Response.json(
              { ok: false, error: 'Please enter a feedback message (at least 3 characters).' },
              { status: 400, headers: SECURITY_HEADERS }
            );
          }

          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO tester_feedback (
                tester_name, category, severity, version, level_id, message, device_info, country, region, status, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10)`
            )
              .bind(
                testerName,
                category,
                severity,
                version,
                levelId,
                message,
                deviceInfo,
                geo.country,
                geo.region,
                new Date().toISOString()
              )
              .run();
          }

          return Response.json(
            { ok: true, message: 'Feedback logged to Cloudflare D1 for agent triage!' },
            { headers: SECURITY_HEADERS }
          );
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Invalid feedback payload' },
            { status: 400, headers: SECURITY_HEADERS }
          );
        }
      }
    }

    // 5. Leaderboards Endpoint
    if (url.pathname === '/api/leaderboard') {
      if (request.method === 'GET') {
        const period = url.searchParams.get('period') || 'daily';
        const scope = url.searchParams.get('scope') || 'global';
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
          const playerName =
            String(body.playerName || 'Player')
              .replace(/[^\w\-\s.]/g, '')
              .trim()
              .slice(0, 20) || 'Player';
          const levelId = Math.max(0, Math.min(10, Number(body.levelId) || 0));
          const score = Math.max(0, Math.min(2_000_000, Math.round(Number(body.score) || 0)));
          const elapsedMs = Math.max(
            3000,
            Math.min(3_600_000, Math.round(Number(body.elapsedMs) || 60000))
          );
          const peakBalls = Math.max(1, Math.min(1600, Math.round(Number(body.peakBalls) || 1)));
          const proof = (Number(body.proof) || 0) >>> 0;

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

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(`Seolith Tiles Edge Worker v${APP_VERSION} Active`, {
      headers: SECURITY_HEADERS,
    });
  },
};
