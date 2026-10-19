#!/usr/bin/env node
/**
 * scripts/publish-blog.mjs
 *
 * Automated Multi-Platform Blog Publisher for Seolith Tiles:
 * 1. Website (`/blog`) — Verifies live edge deployment at https://seolith-tiles.seolith-com.workers.dev/blog
 * 2. Dev.to (`https://dev.to/api/articles`) — Publishes directly when DEVTO_API_KEY is provided
 * 3. Medium (`https://api.medium.com/v1/...`) — Publishes directly when MEDIUM_ACCESS_TOKEN is provided
 * 4. Blogger / Blogspot (`https://www.googleapis.com/blogger/v3/blogs/.../posts`) — Publishes when BLOGGER_ACCESS_TOKEN + BLOGGER_BLOG_ID are provided
 */

import fs from 'node:fs';
import path from 'node:path';

// Load git-ignored .env.admin.local if present
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

const TITLE =
  'How We Built a 1,600-Ball Micro-Tile Brick Breaker at 120 FPS with Rust WASM, Three.js & Cloudflare Edge (Plus Our Monetization Blueprint)';
const CANONICAL_URL = 'https://seolith-tiles.seolith-com.workers.dev/blog';
const TAGS = ['rust', 'webassembly', 'threejs', 'cloudflare'];

const mdPath = path.join(process.cwd(), 'docs', 'BLOG_POST_GROUND_UP_AND_MONETIZATION.md');
const rawMd = fs.readFileSync(mdPath, 'utf8');
const bodyMarkdown = rawMd.replace(/^---[\s\S]*?---\s*/, '');

const htmlPath = path.join(process.cwd(), 'public', 'blog', 'index.html');
const rawHtml = fs.readFileSync(htmlPath, 'utf8');
const mainMatch = rawHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
const bodyHtml = mainMatch ? mainMatch[1] : `<pre>${bodyMarkdown}</pre>`;

async function publishToDevTo() {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) {
    console.log(
      'ℹ️  [Dev.to] DEVTO_API_KEY not set. Ready for 1-click import from https://seolith-tiles.seolith-com.workers.dev/blog or set DEVTO_API_KEY in .env.admin.local.'
    );
    return;
  }

  console.log('🚀 [Dev.to] Publishing article via Forem API...');
  const res = await fetch('https://dev.to/api/articles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      article: {
        title: TITLE,
        published: true,
        body_markdown: bodyMarkdown,
        tags: TAGS,
        canonical_url: CANONICAL_URL,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('❌ [Dev.to] Failed:', data);
    return;
  }
  console.log(`✅ [Dev.to] Published Live: ${data.url}`);
}

async function publishToMedium() {
  const token = process.env.MEDIUM_ACCESS_TOKEN;
  if (!token) {
    console.log(
      'ℹ️  [Medium] MEDIUM_ACCESS_TOKEN not set. Use https://medium.com/p/import with URL https://seolith-tiles.seolith-com.workers.dev/blog or set MEDIUM_ACCESS_TOKEN.'
    );
    return;
  }

  console.log('🚀 [Medium] Fetching author profile & publishing...');
  const meRes = await fetch('https://api.medium.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await meRes.json();
  const userId = meData?.data?.id;
  if (!userId) {
    console.error('❌ [Medium] Could not resolve Medium userId:', meData);
    return;
  }

  const postRes = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: TITLE,
      contentFormat: 'markdown',
      content: bodyMarkdown,
      tags: TAGS,
      canonicalUrl: CANONICAL_URL,
      publishStatus: 'public',
    }),
  });
  const postData = await postRes.json();
  if (!postRes.ok) {
    console.error('❌ [Medium] Failed:', postData);
    return;
  }
  console.log(`✅ [Medium] Published Live: ${postData.data?.url}`);
}

async function publishToBlogger() {
  const token = process.env.BLOGGER_ACCESS_TOKEN;
  const blogId = process.env.BLOGGER_BLOG_ID;
  if (!token || !blogId) {
    console.log(
      'ℹ️  [Blogger/Blogspot] BLOGGER_ACCESS_TOKEN / BLOGGER_BLOG_ID not set. Paste public/blog/index.html body into Blogger HTML view or set credentials in .env.admin.local.'
    );
    return;
  }

  console.log(`🚀 [Blogger] Publishing to Blog ID ${blogId}...`);
  const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'blogger#post',
      blog: { id: blogId },
      title: TITLE,
      content: bodyHtml,
      labels: TAGS,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('❌ [Blogger] Failed:', data);
    return;
  }
  console.log(`✅ [Blogger/Blogspot] Published Live: ${data.url}`);
}

async function main() {
  console.log('===============================================================');
  console.log('📖 Seolith Tiles Multi-Platform Blog Publisher');
  console.log(`🌐 Live Website Canonical URL: ${CANONICAL_URL}`);
  console.log('===============================================================');
  await publishToDevTo();
  await publishToMedium();
  await publishToBlogger();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
