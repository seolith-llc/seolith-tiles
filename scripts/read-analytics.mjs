#!/usr/bin/env node
/**
 * scripts/read-analytics.mjs
 *
 * Queries the protected `/api/admin/analytics` endpoint using an authorized Admin Email
 * and Admin Key, and saves a comprehensive markdown report of visitor locations,
 * referral sources, and live events into `docs/ADMIN_ANALYTICS_REPORT.md`.
 */

import fs from 'node:fs';
import path from 'node:path';

// Automatically load git-ignored .env.admin.local if present
const localEnvPath = path.join(process.cwd(), '.env.admin.local');
if (fs.existsSync(localEnvPath)) {
  const lines = fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

const API_URL =
  process.env.SEOLITH_ADMIN_ANALYTICS_URL ||
  'https://seolith-tiles.seolith-com.workers.dev/api/admin/analytics';
const ADMIN_EMAIL = process.env.SEOLITH_ADMIN_EMAIL || 'admin@seolith.com';
const ADMIN_KEY = process.env.SEOLITH_ADMIN_KEY || '';
if (!ADMIN_KEY) {
  console.error('[analytics-sync] SEOLITH_ADMIN_KEY is required (no default key is shipped).');
  process.exit(1);
}

async function syncAdminAnalytics() {
  console.log(`[analytics-sync] Fetching live geo-analytics as ${ADMIN_EMAIL} ...`);
  const res = await fetch(API_URL, {
    headers: {
      'X-Admin-Email': ADMIN_EMAIL,
      'X-Admin-Key': ADMIN_KEY,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const s = data.summary || {};
  const rev = data.revenue || {};
  const byLoc = data.byLocation || [];
  const recent = data.recentVisitors || [];
  const revenueUsd = ((Number(rev.totalRevenueCents || 0)) / 100).toFixed(2);

  const lines = [
    `# Admin Geo-Analytics & Visitor Telemetry Report`,
    ``,
    `- **Generated At**: \`${new Date().toISOString()}\``,
    `- **Authenticated Admin**: \`${data.adminEmail}\` (\`${data.authMethod}\`)`,
    `- **Unique Visitor Sessions**: **${s.uniqueVisitors || 0}**`,
    `- **Total Pageviews**: **${s.pageviews || 0}**`,
    `- **Plays Started / Wins**: **${s.playsStarted || 0}** / **${s.totalWins || 0}**`,
    `- **Device Split (Mobile / Desktop)**: **${s.mobileEvents || 0}** / **${s.desktopEvents || 0}**`,
    `- **Monetization Orders / Revenue**: **${rev.totalOrders || 0} orders** (**$${revenueUsd} USD**)`,
    ``,
    `## 🌍 Top Visitor Locations (Country • Region • City)`,
    ``,
    `| Country | Region / State | City | Total Events | Unique Visitors |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    ...byLoc.map(
      (l) =>
        `| **${l.country || 'GL'}** | ${l.region || '-'} | ${l.city || '-'} | ${l.visits || 0} | ${l.uniqueSessions || 0} |`
    ),
    ``,
    `## ⚡ Recent Live Visitor Stream`,
    ``,
    `| ID | Event | Player | Country / City (Edge Colo) | Device | Ref / Source | Timestamp |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
    ...recent.map(
      (r) =>
        `| #${r.id} | \`${r.eventType}\` | ${r.playerName} | ${r.city ? `${r.city}, ` : ''}${r.country} (\`${r.colo}\`) | ${r.deviceType} | ${r.refTag ? `@${r.refTag}` : r.referrer || 'direct'} | ${r.createdAt} |`
    ),
  ];

  const outPath = path.join(process.cwd(), 'docs', 'ADMIN_ANALYTICS_REPORT.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`[analytics-sync] Saved admin geo-analytics report to ${outPath}`);
}

syncAdminAnalytics().catch((err) => {
  console.error('[analytics-sync] Error:', err.message);
  process.exit(1);
});
