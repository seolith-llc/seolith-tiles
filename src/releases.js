// src/releases.js
// Version Registry & Release Notes History for Seolith Tiles

export const APP_VERSION = '1.1.0';

export const RELEASE_NOTES = [
  {
    version: '1.1.0',
    date: '2026-10-17',
    title: 'Watertight Steel Physics, Tester Feedback Hub, Viral Social Referral &Dev Story',
    highlights: [
      '🧱 Fixed Hard-Lined Brick Bleeding: Upgraded Rust WASM physics engine to multi-pass Circle-vs-AABB closest-point collision with 16x sub-stepping and watertight 2-tile-thick diagonal steel walls so balls never bleed or tunnel through narrow shafts.',
      '💬 Live Tester Feedback Collector: Added in-app Feedback & Bug Triage drawer backed by Cloudflare D1 (/api/feedback) so testers can submit bugs/ideas and the AI agent can read & resolve them directly.',
      '🏷️ Version Badge & Release Notes: Added interactive version badge (v1.1.0) in the header with full changelog history.',
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
