#!/usr/bin/env node
/**
 * scripts/read-feedback.mjs
 *
 * Fetches tester feedback and bug reports from the live Cloudflare D1 /api/feedback endpoint
 * and writes a formatted markdown report to `docs/TESTER_FEEDBACK.md` so the AI agent and
 * developers can review, triage, and implement tester suggestions immediately.
 */

import fs from 'node:fs';
import path from 'node:path';

const API_URL =
  process.env.SEOLITH_FEEDBACK_URL ||
  'https://seolith-tiles.seolith-com.workers.dev/api/feedback?limit=100';

async function syncTesterFeedback() {
  console.log(`[feedback-sync] Fetching tester feedback from ${API_URL} ...`);
  const res = await fetch(API_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const items = data.items || [];

  const lines = [
    `# Tester Feedback & Bug Triage Log`,
    ``,
    `- **Last Synced**: \`${new Date().toISOString()}\``,
    `- **Live App Version**: \`v${data.version || '1.1.0'}\``,
    `- **Total Reports Retrieved**: \`${items.length}\``,
    ``,
    `| ID | Status | Severity | Category | Version | Level | Tester | Location | Feedback / Suggestion | Submitted At |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const item of items) {
    const msg = String(item.message || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const loc = `${item.region || ''}, ${item.country || 'GL'}`.replace(/^,\s*/, '');
    lines.push(
      `| #${item.id} | \`${item.status}\` | **${item.severity}** | \`${item.category}\` | v${item.version} | L${item.levelId} | ${item.testerName} | ${loc} | ${msg} | ${item.createdAt} |`
    );
  }

  const outPath = path.join(process.cwd(), 'docs', 'TESTER_FEEDBACK.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`[feedback-sync] Saved ${items.length} feedback item(s) to ${outPath}`);
}

syncTesterFeedback().catch((err) => {
  console.error('[feedback-sync] Error:', err.message);
  process.exit(1);
});
