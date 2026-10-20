// worker/index.js
// Cloudflare Worker serving static assets + Edge Geo-Location & Time-Windowed Leaderboards (D1)
// + Tester Feedback & Bug Reporting API (/api/feedback)
// + Visitor Geo-Analytics & Admin Dashboard API (/api/analytics, /api/admin/analytics)
// + Monetization & Stripe Checkout / Payment Link + Sponsor Vault Engine (/api/checkout, /api/verify-checkout, /api/monetization)

const APP_VERSION = '1.6.0';

const DEFAULT_ADMIN_EMAILS = [
  'seolith.com@gmail.com',
  'admin@seolith.com',
  'raghu@seolith.com',
];
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

const DAILY_VAULT_NAMES = [
  '01. The Diagonal Chimney',
  '02. The Center Bent Pipe',
  '03. Twin Helix Reactor',
  '04. Seolith Citadel',
  '05. The Hourglass Funnel',
  '06. The Golden Spiral Vault',
];

const DAILY_MODIFIERS = [
  {
    code: 'SPEED_BLITZ',
    title: '⚡ Speed Blitz Cascade',
    rule: 'Beat the Par Clear Time using the deterministic daily seed to earn the 3-Star Crown + 3 Bonus Boosts!',
  },
  {
    code: 'PRECISION_CHIMNEY',
    title: '🎯 Precision Threading',
    rule: 'Thread the primary shaft on your first launch and trigger a 500+ ball cascade under Par Time!',
  },
  {
    code: 'GOLD_RUSH',
    title: '💎 Gold Vein Rush',
    rule: 'Detonate the inner gold multiplier chambers to exceed the Target Score and claim #1 on the Daily Board!',
  },
];

function computeDailyChallengeConfig(dayKey) {
  let hash = 0x811c9dc5 >>> 0;
  for (let i = 0; i < dayKey.length; i++) {
    hash ^= dayKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const levelId = hash % 6;
  const gridOptions = [56, 64, 64, 72];
  const gridSize = gridOptions[(hash >>> 4) % gridOptions.length];
  const mod = DAILY_MODIFIERS[(hash >>> 8) % DAILY_MODIFIERS.length];
  const targetTimeMs = 38000 + ((hash >>> 12) % 14) * 1000; // 38.0s - 51.0s
  const targetScore = 52000 + ((hash >>> 16) % 25) * 1000;
  const targetPeakBalls = 600 + ((hash >>> 20) % 7) * 100;

  return {
    dayKey,
    seed: hash >>> 0,
    levelId,
    levelName: DAILY_VAULT_NAMES[levelId] || DAILY_VAULT_NAMES[0],
    gridSize,
    modifierCode: mod.code,
    title: `${dayKey} • ${mod.title}`,
    ruleText: mod.rule,
    targetTimeMs,
    targetScore,
    targetPeakBalls,
    rewardBoosts: 3,
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
          version TEXT NOT NULL DEFAULT '1.5.0',
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

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS monetization_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          player_name TEXT NOT NULL DEFAULT 'Player',
          email TEXT NOT NULL DEFAULT '',
          sku TEXT NOT NULL DEFAULT 'pro_pass_299',
          amount_cents INTEGER NOT NULL DEFAULT 299,
          status TEXT NOT NULL DEFAULT 'completed',
          provider TEXT NOT NULL DEFAULT 'stripe_or_edge',
          stripe_session_id TEXT NOT NULL DEFAULT '',
          unlock_token TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          created_at TEXT NOT NULL
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS daily_challenge_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_key TEXT NOT NULL,
          seed INTEGER NOT NULL,
          level_id INTEGER NOT NULL,
          player_name TEXT NOT NULL DEFAULT 'Player',
          score INTEGER NOT NULL,
          elapsed_ms INTEGER NOT NULL,
          peak_balls INTEGER NOT NULL DEFAULT 1,
          beat_target INTEGER NOT NULL DEFAULT 0,
          aim_deg REAL NOT NULL DEFAULT 0,
          boosts_used INTEGER NOT NULL DEFAULT 0,
          device_type TEXT NOT NULL DEFAULT 'desktop',
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          city TEXT NOT NULL DEFAULT '',
          proof INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS daily_challenge_approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_key TEXT NOT NULL,
          seed INTEGER NOT NULL,
          tester_name TEXT NOT NULL DEFAULT 'Tester',
          verdict TEXT NOT NULL DEFAULT 'approved',
          difficulty_rating INTEGER NOT NULL DEFAULT 5,
          fun_rating INTEGER NOT NULL DEFAULT 5,
          comment TEXT NOT NULL DEFAULT '',
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          created_at TEXT NOT NULL
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS reminder_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          player_name TEXT NOT NULL DEFAULT 'Player',
          reminder_time TEXT NOT NULL DEFAULT '19:00',
          timezone_offset_min INTEGER NOT NULL DEFAULT 0,
          daily_challenge_alert INTEGER NOT NULL DEFAULT 1,
          streak_saver_alert INTEGER NOT NULL DEFAULT 1,
          rank_overtake_alert INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1,
          country TEXT NOT NULL DEFAULT 'GL',
          region TEXT NOT NULL DEFAULT 'Global',
          updated_at TEXT NOT NULL
        )`
      )
      .run();

    schemaInitialized = true;
  } catch (_) {}
}

function isAuthorizedAdmin(request, env) {
  const url = new URL(request.url);

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

function generateUnlockToken(sessionId, sku) {
  let h = 0x9e3779b9 >>> 0;
  const str = `${sessionId}:${sku}:seolith_pro_2026`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `seo_pro_${h.toString(16)}_${Date.now().toString(36)}`;
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
          updatedAt: '2026-10-18T12:45:00-04:00',
          geo,
        },
        { headers: SECURITY_HEADERS }
      );
    }

    // 2. Monetization Config & Sponsor Spot Endpoint (GET /api/monetization)
    if (url.pathname === '/api/monetization' && request.method === 'GET') {
      return Response.json(
        {
          ok: true,
          stripeConfigured: Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_PAYMENT_LINK),
          proPriceUsd: 2.99,
          boostPackPriceUsd: 0.99,
          sponsorSpot: {
            brand: env.SPONSOR_BRAND || 'Seolith Cloud AI & Edge Games',
            headline:
              env.SPONSOR_HEADLINE ||
              '⚡ Build 120FPS Rust + WASM + Three.js Apps on Cloudflare Edge',
            ctaText: env.SPONSOR_CTA_TEXT || 'Explore Seolith @ GitHub',
            ctaUrl: env.SPONSOR_CTA_URL || 'https://github.com/seolith-llc/seolith-tiles',
            durationSec: 5,
            rewardBoosts: 3,
            rewardFreePlays: 5,
          },
        },
        { headers: SECURITY_HEADERS }
      );
    }

    // 3. Checkout Session Creation Endpoint (POST /api/checkout)
    // Automatically uses live Stripe API if STRIPE_SECRET_KEY is set, or STRIPE_PAYMENT_LINK if set,
    // or records an instant Edge Founding Supporter order in D1 and returns a verified unlock token!
    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      await ensureSchema(env.DB);
      try {
        const body = await request.json();
        const sessionId = String(body.sessionId || 'anon').slice(0, 48);
        const playerName =
          String(body.playerName || 'Player')
            .replace(/[^\w\-\s.@]/g, '')
            .trim()
            .slice(0, 24) || 'Player';
        const email = String(body.email || '').trim().slice(0, 80);
        const sku = body.sku === 'boost_pack_099' ? 'boost_pack_099' : 'pro_pass_299';
        const amountCents = sku === 'boost_pack_099' ? 99 : 299;
        const unlockToken = generateUnlockToken(sessionId, sku);

        // Mode A: Live Stripe REST API Checkout Session (Zero SDK bloat!)
        if (env.STRIPE_SECRET_KEY) {
          const origin = url.origin;
          const successUrl = `${origin}/?pro_unlocked=1&sku=${sku}&token=${encodeURIComponent(unlockToken)}&session_id={CHECKOUT_SESSION_ID}`;
          const cancelUrl = `${origin}/?checkout_cancelled=1`;

          const form = new URLSearchParams();
          form.set('mode', 'payment');
          form.set('success_url', successUrl);
          form.set('cancel_url', cancelUrl);
          if (email && email.includes('@')) {
            form.set('customer_email', email);
          }
          form.set('line_items[0][price_data][currency]', 'usd');
          form.set('line_items[0][price_data][unit_amount]', String(amountCents));
          form.set(
            'line_items[0][price_data][product_data][name]',
            sku === 'boost_pack_099'
              ? 'Seolith Tiles — +15 x3 Cascade Boost Pack'
              : 'Seolith Tiles — Lifetime Pro Pass + Unlimited Plays & 25x Boosts'
          );
          form.set('line_items[0][quantity]', '1');

          const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          });

          const stripeData = await stripeRes.json();
          if (stripeRes.ok && stripeData.url) {
            if (env.DB) {
              await env.DB.prepare(
                `INSERT INTO monetization_orders (
                  session_id, player_name, email, sku, amount_cents, status, provider, stripe_session_id, unlock_token, country, region, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending_stripe', 'stripe_api', ?6, ?7, ?8, ?9, ?10)`
              )
                .bind(
                  sessionId,
                  playerName,
                  email,
                  sku,
                  amountCents,
                  stripeData.id || '',
                  unlockToken,
                  geo.country,
                  geo.region,
                  new Date().toISOString()
                )
                .run();
            }
            return Response.json(
              { ok: true, mode: 'stripe_redirect', checkoutUrl: stripeData.url, unlockToken },
              { headers: SECURITY_HEADERS }
            );
          }
        }

        // Mode B: Direct Stripe Payment Link Redirect
        if (env.STRIPE_PAYMENT_LINK) {
          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO monetization_orders (
                session_id, player_name, email, sku, amount_cents, status, provider, stripe_session_id, unlock_token, country, region, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, 'redirected_link', 'stripe_link', '', ?6, ?7, ?8, ?9)`
            )
              .bind(
                sessionId,
                playerName,
                email,
                sku,
                amountCents,
                unlockToken,
                geo.country,
                geo.region,
                new Date().toISOString()
              )
              .run();
          }
          return Response.json(
            { ok: true, mode: 'payment_link', checkoutUrl: env.STRIPE_PAYMENT_LINK, unlockToken },
            { headers: SECURITY_HEADERS }
          );
        }

        // Mode C: Instant Edge Self-Hosted Checkout (Records Founding Supporter Order in D1 & Unlocks Immediately)
        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO monetization_orders (
              session_id, player_name, email, sku, amount_cents, status, provider, stripe_session_id, unlock_token, country, region, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'completed', 'edge_instant', '', ?6, ?7, ?8, ?9)`
          )
            .bind(
              sessionId,
              playerName,
              email,
              sku,
              amountCents,
              unlockToken,
              geo.country,
              geo.region,
              new Date().toISOString()
            )
            .run();
        }

        return Response.json(
          {
            ok: true,
            mode: 'edge_instant',
            sku,
            unlockToken,
            message: 'Pro Pass & Boosts activated and logged to Cloudflare D1!',
          },
          { headers: SECURITY_HEADERS }
        );
      } catch (err) {
        return Response.json(
          { ok: false, error: err.message },
          { status: 400, headers: SECURITY_HEADERS }
        );
      }
    }

    // 4. Visitor Geo-Analytics Ingestion Endpoint (POST /api/analytics)
    if (url.pathname === '/api/analytics' && request.method === 'POST') {
      await ensureSchema(env.DB);
      try {
        const body = await request.json();
        const sessionId = String(body.sessionId || 'anon').slice(0, 48);
        const playerName =
          String(body.playerName || 'Anon')
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
          'pro_unlock',
          'sponsor_watch',
          'feedback',
        ].includes(body.eventType)
          ? body.eventType
          : 'pageview';
        const levelId = Math.max(0, Math.min(20, Number(body.levelId) || 0));
        const referrer = String(body.referrer || request.headers.get('Referer') || '').slice(
          0,
          180
        );
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
        return Response.json(
          { ok: false, error: err.message },
          { status: 400, headers: SECURITY_HEADERS }
        );
      }
    }

    // 5. Protected Admin Geo-Analytics & Revenue Dashboard Endpoint (GET /api/admin/analytics)
    if (url.pathname === '/api/admin/analytics' && request.method === 'GET') {
      await ensureSchema(env.DB);
      const auth = isAuthorizedAdmin(request, env);
      if (!auth.authorized) {
        return Response.json(
          {
            ok: false,
            error:
              'Unauthorized Admin Account. Please provide a valid Admin Email and Admin Key.',
          },
          { status: 401, headers: SECURITY_HEADERS }
        );
      }

      if (!env.DB) {
        return Response.json(
          { ok: true, summary: {}, revenue: {}, byLocation: [], recentVisitors: [] },
          { headers: SECURITY_HEADERS }
        );
      }

      try {
        const totalsStmt = await env.DB.prepare(
          `SELECT
            COUNT(*) AS totalEvents,
            COUNT(DISTINCT session_id) AS uniqueVisitors,
            SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
            SUM(CASE WHEN event_type = 'play_start' THEN 1 ELSE 0 END) AS playsStarted,
            SUM(CASE WHEN event_type = 'win' THEN 1 ELSE 0 END) AS totalWins,
            SUM(CASE WHEN event_type = 'share' THEN 1 ELSE 0 END) AS totalShares,
            SUM(CASE WHEN event_type = 'sponsor_watch' THEN 1 ELSE 0 END) AS sponsorWatches,
            SUM(CASE WHEN device_type = 'mobile' THEN 1 ELSE 0 END) AS mobileEvents,
            SUM(CASE WHEN device_type = 'desktop' THEN 1 ELSE 0 END) AS desktopEvents
           FROM visitor_events`
        ).first();

        const revenueStmt = await env.DB.prepare(
          `SELECT
            COUNT(*) AS totalOrders,
            COALESCE(SUM(amount_cents), 0) AS totalRevenueCents
           FROM monetization_orders`
        ).first();

        const { results: byCountry } = await env.DB.prepare(
          `SELECT country, region, city, COUNT(*) AS visits, COUNT(DISTINCT session_id) AS uniqueSessions
           FROM visitor_events
           GROUP BY country, region, city
           ORDER BY visits DESC
           LIMIT 25`
        ).all();

        const { results: byReferral } = await env.DB.prepare(
          `SELECT ref_tag AS refTag, referrer, COUNT(*) AS count
           FROM visitor_events
           WHERE ref_tag != '' OR referrer != ''
           GROUP BY ref_tag, referrer
           ORDER BY count DESC
           LIMIT 15`
        ).all();

        const { results: recentVisitors } = await env.DB.prepare(
          `SELECT id, session_id AS sessionId, player_name AS playerName, event_type AS eventType, level_id AS levelId,
                  country, region, city, colo, timezone, device_type AS deviceType, ref_tag AS refTag, referrer, created_at AS createdAt
           FROM visitor_events
           ORDER BY id DESC
           LIMIT 40`
        ).all();

        const { results: recentOrders } = await env.DB.prepare(
          `SELECT id, player_name AS playerName, email, sku, amount_cents AS amountCents, status, provider, country, created_at AS createdAt
           FROM monetization_orders
           ORDER BY id DESC
           LIMIT 15`
        ).all();

        return Response.json(
          {
            ok: true,
            adminEmail: auth.adminEmail,
            authMethod: auth.method,
            summary: totalsStmt || {},
            revenue: revenueStmt || { totalOrders: 0, totalRevenueCents: 0 },
            orders: recentOrders || [],
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

    // 6. Tester Feedback & Bug Reporting Endpoint
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

    // 7. Leaderboards Endpoint
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

    // 8. Daily Challenge & Tester Approval Endpoints (/api/daily-challenge & /api/daily-challenge/approve)
    if (url.pathname === '/api/daily-challenge') {
      await ensureSchema(env.DB);
      const keys = getTimeKeys(new Date());
      const requestedDay = url.searchParams.get('day') || keys.dayKey;
      const challenge = computeDailyChallengeConfig(requestedDay);

      if (request.method === 'GET') {
        let entries = [];
        let approvals = [];
        let stats = {
          totalRuns: 0,
          targetBeats: 0,
          approvedCount: 0,
          needsTuningCount: 0,
          avgDifficulty: 5.0,
          avgFun: 5.0,
          qaCertified: false,
        };

        if (env.DB) {
          try {
            const { results: runRows } = await env.DB.prepare(
              `SELECT id, player_name AS playerName, score, elapsed_ms AS elapsedMs, peak_balls AS peakBalls,
                      beat_target AS beatTarget, aim_deg AS aimDeg, boosts_used AS boostsUsed,
                      device_type AS deviceType, country, region, city, created_at AS createdAt
               FROM daily_challenge_runs
               WHERE day_key = ?1
               ORDER BY elapsed_ms ASC, score DESC
               LIMIT 25`
            )
              .bind(challenge.dayKey)
              .all();
            entries = runRows || [];

            const { results: appRows } = await env.DB.prepare(
              `SELECT id, tester_name AS testerName, verdict, difficulty_rating AS difficultyRating,
                      fun_rating AS funRating, comment, country, region, created_at AS createdAt
               FROM daily_challenge_approvals
               WHERE day_key = ?1
               ORDER BY created_at DESC
               LIMIT 20`
            )
              .bind(challenge.dayKey)
              .all();
            approvals = appRows || [];

            const approvedCount = approvals.filter((a) => a.verdict === 'approved').length;
            const needsTuningCount = approvals.filter((a) => a.verdict !== 'approved').length;
            const avgDifficulty = approvals.length
              ? Number(
                  (
                    approvals.reduce((acc, a) => acc + Number(a.difficultyRating || 5), 0) /
                    approvals.length
                  ).toFixed(1)
                )
              : 5.0;
            const avgFun = approvals.length
              ? Number(
                  (
                    approvals.reduce((acc, a) => acc + Number(a.funRating || 5), 0) /
                    approvals.length
                  ).toFixed(1)
                )
              : 5.0;

            stats = {
              totalRuns: entries.length,
              targetBeats: entries.filter((e) => Number(e.beatTarget) === 1).length,
              approvedCount,
              needsTuningCount,
              avgDifficulty,
              avgFun,
              qaCertified: approvedCount >= 1 && approvedCount >= needsTuningCount,
            };
          } catch (_) {}
        }

        return Response.json(
          {
            ok: true,
            geo,
            challenge,
            stats,
            entries,
            approvals,
          },
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
          const score = Math.max(0, Math.min(2_000_000, Math.round(Number(body.score) || 0)));
          const elapsedMs = Math.max(
            3000,
            Math.min(3_600_000, Math.round(Number(body.elapsedMs) || 60000))
          );
          const peakBalls = Math.max(1, Math.min(1600, Math.round(Number(body.peakBalls) || 1)));
          const aimDeg = Number(Number(body.aimDeg || 0).toFixed(1));
          const boostsUsed = Math.max(0, Math.min(99, Math.round(Number(body.boostsUsed) || 0)));
          const proof = (Number(body.proof) || 0) >>> 0;
          const ua = request.headers.get('user-agent') || '';
          const deviceType = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';

          const expected = computeExpectedProof(challenge.levelId, score, elapsedMs, peakBalls);
          if (proof !== expected) {
            return Response.json(
              { ok: false, error: 'Invalid daily challenge run proof signature' },
              { status: 400, headers: SECURITY_HEADERS }
            );
          }

          const beatTarget =
            elapsedMs <= challenge.targetTimeMs || score >= challenge.targetScore ? 1 : 0;

          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO daily_challenge_runs (
                day_key, seed, level_id, player_name, score, elapsed_ms, peak_balls,
                beat_target, aim_deg, boosts_used, device_type, country, region, city, proof, created_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
            )
              .bind(
                challenge.dayKey,
                challenge.seed,
                challenge.levelId,
                playerName,
                score,
                elapsedMs,
                peakBalls,
                beatTarget,
                aimDeg,
                boostsUsed,
                deviceType,
                geo.country,
                geo.region,
                geo.city,
                proof,
                new Date().toISOString()
              )
              .run();
          }

          return Response.json(
            {
              ok: true,
              dayKey: challenge.dayKey,
              beatTarget: Boolean(beatTarget),
              rewardBoosts: beatTarget ? challenge.rewardBoosts : 1,
            },
            { headers: SECURITY_HEADERS }
          );
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Invalid daily challenge run payload' },
            { status: 400, headers: SECURITY_HEADERS }
          );
        }
      }
    }

    if (url.pathname === '/api/daily-challenge/approve' && request.method === 'POST') {
      await ensureSchema(env.DB);
      const keys = getTimeKeys(new Date());
      const challenge = computeDailyChallengeConfig(keys.dayKey);
      try {
        const body = await request.json();
        const testerName =
          String(body.testerName || 'Tester')
            .replace(/[^\w\-\s.@]/g, '')
            .trim()
            .slice(0, 28) || 'Tester';
        const verdict = body.verdict === 'needs_tuning' ? 'needs_tuning' : 'approved';
        const difficultyRating = Math.max(1, Math.min(5, Math.round(Number(body.difficultyRating) || 5)));
        const funRating = Math.max(1, Math.min(5, Math.round(Number(body.funRating) || 5)));
        const comment = String(body.comment || '')
          .trim()
          .slice(0, 500);

        if (env.DB) {
          await env.DB.prepare(
            `INSERT INTO daily_challenge_approvals (
              day_key, seed, tester_name, verdict, difficulty_rating, fun_rating, comment, country, region, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
          )
            .bind(
              challenge.dayKey,
              challenge.seed,
              testerName,
              verdict,
              difficultyRating,
              funRating,
              comment,
              geo.country,
              geo.region,
              new Date().toISOString()
            )
            .run();
        }

        return Response.json(
          {
            ok: true,
            dayKey: challenge.dayKey,
            verdict,
            message:
              verdict === 'approved'
                ? '✅ Daily Challenge approved & certified!'
                : '🔧 Tuning feedback recorded for Daily Challenge!',
          },
          { headers: SECURITY_HEADERS }
        );
      } catch (err) {
        return Response.json(
          { ok: false, error: 'Invalid tester approval payload' },
          { status: 400, headers: SECURITY_HEADERS }
        );
      }
    }

    // 9. PWA Notifications & Daily Reminder Subscriptions Endpoint (/api/reminders)
    if (url.pathname === '/api/reminders') {
      await ensureSchema(env.DB);
      if (request.method === 'GET') {
        const keys = getTimeKeys(new Date());
        const challenge = computeDailyChallengeConfig(keys.dayKey);
        return Response.json(
          {
            ok: true,
            dayKey: challenge.dayKey,
            notification: {
              title: `🎯 ${challenge.title}`,
              body: `Today's vault: ${challenge.levelName} • Beat ${(
                challenge.targetTimeMs / 1000
              ).toFixed(1)}s Par Time for +3 Free ⚡ Boosts!`,
              url: '/?daily=1&ref=EdgeReminder',
            },
          },
          { headers: SECURITY_HEADERS }
        );
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const sessionId = String(body.sessionId || 'anon').slice(0, 64);
          const playerName =
            String(body.playerName || 'Player')
              .replace(/[^\w\-\s.]/g, '')
              .trim()
              .slice(0, 24) || 'Player';
          const reminderTime = String(body.reminderTime || '19:00').slice(0, 8);
          const timezoneOffsetMin = Math.round(Number(body.timezoneOffsetMin) || 0);
          const dailyChallengeAlert = body.dailyChallengeAlert === false ? 0 : 1;
          const streakSaverAlert = body.streakSaverAlert === false ? 0 : 1;
          const rankOvertakeAlert = body.rankOvertakeAlert === false ? 0 : 1;
          const enabled = body.enabled === false ? 0 : 1;

          if (env.DB) {
            await env.DB.prepare(
              `INSERT INTO reminder_subscriptions (
                session_id, player_name, reminder_time, timezone_offset_min,
                daily_challenge_alert, streak_saver_alert, rank_overtake_alert,
                enabled, country, region, updated_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
            )
              .bind(
                sessionId,
                playerName,
                reminderTime,
                timezoneOffsetMin,
                dailyChallengeAlert,
                streakSaverAlert,
                rankOvertakeAlert,
                enabled,
                geo.country,
                geo.region,
                new Date().toISOString()
              )
              .run();
          }

          return Response.json(
            {
              ok: true,
              reminderTime,
              message: 'Reminder schedule saved to Cloudflare D1!',
            },
            { headers: SECURITY_HEADERS }
          );
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Invalid reminder subscription payload' },
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
