#!/usr/bin/env node
/**
 * scripts/consolidate-prompts.mjs
 *
 * Keeps `docs/prompts-history/` organized in a hierarchical `YYYY/MM/` folder structure.
 * Also supports consolidating completed months into `docs/prompts-history/YYYY/MM/YYYY-MM-consolidated.md`
 * whenever a new month starts (or when invoked via `npm run prompts:consolidate`).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HISTORY_DIR = path.join(ROOT, 'docs', 'prompts-history');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function consolidateCompletedMonths(currentYearMonth = null) {
  ensureDir(HISTORY_DIR);
  const now = new Date();
  const activeYM =
    currentYearMonth ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const years = fs
    .readdirSync(HISTORY_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort();

  for (const year of years) {
    const yearPath = path.join(HISTORY_DIR, year);
    const months = fs
      .readdirSync(yearPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort();

    for (const month of months) {
      const ym = `${year}-${month}`;
      const monthPath = path.join(yearPath, month);
      const consolidatedFile = path.join(monthPath, `${ym}-consolidated.md`);

      const entries = fs
        .readdirSync(monthPath)
        .filter(
          (f) =>
            f.endsWith('.md') &&
            !f.endsWith('-consolidated.md') &&
            f !== 'README.md'
        )
        .sort();

      if (entries.length === 0) continue;

      // Always generate/update consolidated rollup for past months, or if --all flag is passed
      const forceAll = process.argv.includes('--all');
      if (ym < activeYM || forceAll) {
        const blocks = [
          `# Consolidated Prompts History — ${ym}`,
          ``,
          `> Automatically consolidated from ${entries.length} session file(s) in \`docs/prompts-history/${year}/${month}/\`.`,
          ``,
        ];

        for (const file of entries) {
          const fullPath = path.join(monthPath, file);
          const content = fs.readFileSync(fullPath, 'utf8').trim();
          blocks.push(`---`, ``, `## Source: \`${file}\``, ``, content, ``);
        }

        fs.writeFileSync(consolidatedFile, blocks.join('\n'), 'utf8');
        console.log(`[prompts-history] Consolidated ${entries.length} files into ${consolidatedFile}`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('consolidate-prompts.mjs')) {
  consolidateCompletedMonths();
}
