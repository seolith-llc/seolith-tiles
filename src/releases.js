// src/releases.js
// Version Registry & Release Notes History for Seolith Tiles

export const APP_VERSION = '1.6.0';

export const RELEASE_NOTES = [
  {
    version: '1.6.0',
    date: '2026-10-19',
    title: 'Standalone PWA Support, Offline WASM Caching & Daily Challenge Notifications / Reminders',
    highlights: [
      '📲 Full Progressive Web App (PWA): Added /manifest.webmanifest, /sw.js Service Worker (offline-first WASM & Three.js caching), 192x192 & 512x512 icons, and 1-click Home Screen / Desktop installation (+5 Free ⚡ Boosts).',
      '🔔 Notifications & Custom Daily Reminders (/api/reminders & src/pwa.js): Players can enable Web Notifications, schedule their local Daily Reminder Time (e.g. 19:00), track their 🔥 Daily Streak, and test live system tray notifications inside the 🔔 Remind modal (+3 Free ⚡ Boosts).',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-18',
    title: 'Competitive Daily Challenge Hub, Detailed Telemetry, Tester QA Sign-Off & Viral Daily Share',
    highlights: [
      '🎯 Deterministic Daily Challenge (/api/daily-challenge): Generates a daily seed, featured vault, grid density, Par Clear Time, and Target Score so all players worldwide compete on the exact same vault layout.',
      '📊 Detailed Competitive Run Telemetry: Collects Clear Time, Score, Peak Balls, Aim Angle (deg), Boosts Used, Device Type, and Geo-Location in daily_challenge_runs.',
      '🧪 Tester QA Approval & Certification (/api/daily-challenge/approve): Testers can rate Difficulty (1-5), Fun (1-5), and certify today\'s Daily Challenge directly inside the 🎯 Daily modal (+2 Free Boosts reward).',
      '📤 Shareable Daily Challenge Links (?daily=1): 1-click X, WhatsApp, and Clipboard links that open the Daily Challenge Hub automatically for invited friends.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-18',
    title: 'Published Engineering & Monetization Blog (/blog) + Multi-Platform Syndication (Dev.to, Medium & Blogger)',
    highlights: [
      '📖 Live Website Engineering & Monetization Blog (/blog): Published full deep-dive article with embedded 60FPS videos, architecture diagrams, and 4-tier monetization breakdown at https://seolith-tiles.seolith-com.workers.dev/blog.',
      '🚀 Multi-Platform Publisher (npm run blog:publish): Added scripts/publish-blog.mjs and docs/BLOG_POST_GROUND_UP_AND_MONETIZATION.md for Dev.to, Medium, and Blogger/Blogspot.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-18',
    title: 'Edge Checkout & Monetization Engine, Interactive 5s Sponsor Spot & 6 Viral Vaults',
    highlights: [
      '💳 Live Edge Checkout Engine (/api/checkout & /api/monetization): Supports Stripe Checkout Sessions, Payment Links, and Instant Edge Founding Supporter Pass ($2.99 Pro Pass & $0.99 +15x Boost Pack) logged in Cloudflare D1 (monetization_orders).',
      '🎬 Interactive 5-Second Sponsor Spot: Players can watch a live 5-second countdown sponsor card with clickable partner CTA to earn +3 x3 Boosts & +5 Free Plays.',
      '🧱 2 New High-Dopamine Viral Vaults: Added 05. The Hourglass Funnel and 06. The Golden Spiral Vault in the Rust WASM engine.',
      '📊 Admin Revenue Telemetry: Added Total Orders & Revenue ($) metrics to the protected 📊 Admin dashboard.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-18',
    title: 'Admin Geo-Analytics Dashboard, Visitor Telemetry & Autonomous 60FPS Video Showcase',
    highlights: [
      '📊 Protected Admin Geo-Analytics Dashboard: Added real-time visitor & gameplay telemetry (/api/analytics & /api/admin/analytics) backed by Cloudflare D1 and request.cf edge metadata (Country, Region/State, City, Edge Colo, Timezone, Device Type, and ?ref= Viral Referral Tags).',
      '🔐 Multi-Admin Access Control: Supports Cloudflare Access Zero-Trust headers (Cf-Access-Authenticated-User-Email) as well as Admin Account Email + Secret Key sign-in directly inside the app (📊 Admin button).',
      '🎬 Autonomous 60FPS Gameplay Videos: Added scripts/generate-viral-videos.mjs and hosted 60FPS vertical MP4 showcase clips with synthesized ASMR audio.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-17',
    title: 'Watertight Steel Physics, Tester Feedback Hub, Viral Social Referral & Dev Story',
    highlights: [
      '🧱 Fixed Hard-Lined Brick Bleeding: Upgraded Rust WASM physics engine to multi-pass Circle-vs-AABB closest-point collision with 16x sub-stepping and watertight 2-tile-thick diagonal steel walls.',
      '💬 Live Tester Feedback Collector: Added in-app Feedback & Bug Triage drawer backed by Cloudflare D1 (/api/feedback) so testers can submit bugs/ideas and the AI agent can read & resolve them directly.',
      '🏷️ Version Badge & Release Notes: Added interactive version badge in the header with full changelog history.',
      '📖 Novice Developer Guide & Diagrams: Added an in-app & markdown "How It Was Built" Engineering Post with Architecture & Sequence diagrams.',
      '🚀 Viral Social Sharing & Early Monetization: Added 1-click X (Twitter), WhatsApp, Reddit, and Challenge Referral Link sharing (?ref=handle) that rewards sharers with instant x3 Cascade Boosts & Pro Pass unlocks.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-17',
    title: 'Initial Viral Launch — Rust WASM + Three.js + Cloudflare Edge',
    highlights: [
      '⚡ Built zero-copy Rust WebAssembly physics engine supporting 6,400 micro-tiles and 1,600 simultaneous balls at 60–120 FPS.',
      '🎨 Three.js InstancedMesh renderer with 4 vault presets (inspired by @iwhale viral posts), custom themes, 3D tilt, and level paint editor.',
      '🔊 Procedural WebAudio ASMR woodblock/marimba pop synthesizer and dynamic synthwave music.',
      '💾 LocalStorage auto-save/resume snapshot engine and 60FPS canvas video recorder.',
      '🏆 Cloudflare D1 Daily, Weekly, Monthly, and Yearly leaderboards with Country & Region geo-filtering.',
    ],
  },
];
