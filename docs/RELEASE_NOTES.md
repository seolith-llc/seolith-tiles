# Release Notes — Seolith Tiles (`seolith-tiles`)

## `v1.4.0` — *2026-10-18*
**Theme:** *Published Website Engineering & Monetization Blog (`/blog`) + Multi-Platform Syndication (`Dev.to`, `Medium`, `Blogger/Blogspot`)*

- **Live Website Engineering & Monetization Blog (`public/blog/index.html`)**: Published canonical deep-dive article at `https://seolith-tiles.seolith-com.workers.dev/blog` with embedded 60FPS videos, system architecture diagrams, and the 4-tier monetization blueprint, linked via the `📖 Blog` header button.
- **Multi-Platform Blog Publisher (`scripts/publish-blog.mjs`, `docs/BLOG_POST_GROUND_UP_AND_MONETIZATION.md`)**: Added `npm run blog:publish` supporting direct API syndication and 1-click canonical URL import for **Dev.to**, **Medium**, and **Blogger/Blogspot**.

---

## `v1.3.0` — *2026-10-18*
**Theme:** *Live Edge Checkout & Monetization Engine, Interactive 5s Sponsor Spot & 6 Viral Vaults*

### ✨ New Features
- **Edge Checkout & Monetization API (`worker/index.js`, `worker/schema.sql`)**:
  - Added `/api/monetization` and `/api/checkout` supporting 3 seamless modes: Live Stripe REST API Checkout Sessions (`STRIPE_SECRET_KEY`), Hosted Stripe Payment Links (`STRIPE_PAYMENT_LINK`), and Instant Edge Founding Supporter Checkout logged directly into the `monetization_orders` D1 table.
  - Added `$2.99 Lifetime Seolith Pro Pass` and `$0.99 +15x Cascade Boost Pack` checkout buttons with receipt/account email capture and automatic `?pro_unlocked=1` / `?boost_pack=1` URL verification.
- **Interactive 5-Second Sponsor Spot (`index.html`, `src/main.js`)**:
  - Added an interactive 5-second countdown sponsor card with partner CTA link that awards `+3 x3 Boosts` and `+5 Free Plays` upon completion and logs `sponsor_watch` to edge analytics.
- **2 New High-Dopamine Viral Vaults (`src-rust/lib.rs`, `src/levels.js`)**:
  - Added **`05. The Hourglass Funnel`** (steel-walled pinch throat with a concentrated gold core) and **`06. The Golden Spiral Vault`** (right-hand express chimney into concentric gold & cyan rings).
- **Admin Revenue Telemetry (`worker/index.js`, `src/main.js`)**:
  - Added live **Revenue (`$`) & Orders** metrics to the protected `📊 Admin` dashboard.

---

## `v1.2.0` — *2026-10-18*
**Theme:** *Admin Geo-Analytics Dashboard, Visitor Telemetry & Autonomous 60FPS Video Showcase*

- Added `visitor_events` table in Cloudflare D1 and `/api/analytics` + `/api/admin/analytics` endpoints capturing Country, Region/State, City, Edge Colo, Timezone, Device Type, and `?ref=` referral tags.
- Added protected `📊 Admin` dashboard supporting Cloudflare Access Zero-Trust headers and Admin Email + Access Key authentication (`scripts/read-analytics.mjs`).
- Added autonomous 60FPS MP4 showcase video generator (`scripts/generate-viral-videos.mjs`) and `docs/VIRAL_SHOWCASE_POST.md`.

---

## `v1.1.0` — *2026-10-17*
**Theme:** *Watertight Steel Physics, Tester Feedback Hub, Viral Referral Loop & Novice Developer Story*

### 🐛 Bug Fixes
- **Eliminated Hard-Lined Steel Wall Bleeding (`src-rust/lib.rs`)**:
  - Replaced single-axis center reflection with a **2-pass Circle-vs-AABB closest-point collision solver** that prioritizes `TILE_WALL_STEEL` armor blocks and resolves diagonal corner contacts cleanly.
  - Increased max physics sub-stepping to `16` sub-steps per frame (`max_step_dist = 0.22 * tile_size`) and dynamically scaled `ball_radius` to `0.34 * cell_w`.
  - Reinforced diagonal chutes and pipe bends with **watertight 4-connected double-lined steel walls** so balls never leak through diagonal stair-stepped corners.
  - Fixed `x3` capsule cloning to spawn exactly at the parent ball's validated coordinates.

### ✨ New Features
- **Live Tester Feedback & Bug Triage System (`worker/index.js`, `worker/schema.sql`, `scripts/read-feedback.mjs`)**:
  - Added `tester_feedback` table in Cloudflare D1 and `/api/feedback` (`GET` & `POST`) endpoints.
  - Added in-app **💬 Feedback** modal allowing testers to submit bug reports, physics observations, and feature requests, and browse live community submissions.
  - Added `npm run feedback:read` script so the AI agent and developers can pull all live tester feedback directly into `docs/TESTER_FEEDBACK.md`.
- **Version Number & In-App Release Notes (`src/releases.js`)**:
  - Added clickable `v1.1.0` pill in the top header opening the **Release Notes & How It Was Built** modal.
- **Novice Developer Guide (`docs/HOW_IT_WAS_BUILT.md`)**:
  - Published a beginner-friendly engineering deep dive explaining how Rust, WebAssembly, Three.js, WebAudio, and Cloudflare D1 work together, complete with System Architecture and End-to-End Sequence Diagrams.
- **Viral Social Sharing & Immediate Monetization Engine (`src/recorder.js`, `src/main.js`)**:
  - Added 1-click social sharing buttons for **X (Twitter)**, **WhatsApp**, **Reddit**, **TikTok/Reels Video Download**, and **Challenge Referral Links (`?ref=handle&level=0&target=42.8`)**.
  - Added **Share-to-Unlock Bonus**: Sharing a challenge link immediately grants `+3 free x3 Cascade Boosts`.
  - Added **👑 Pro Shop / Supporter Pass** button right in the main header for immediate monetization alongside the 100-play milestone gate.

---

## `v1.0.0` — *2026-10-17*
**Theme:** *Initial Viral Launch — Rust WASM + Three.js + Cloudflare Edge*

- Built zero-copy Rust WebAssembly physics engine (`src-rust/lib.rs`) supporting 6,400 micro-tiles and 1,600 simultaneous balls.
- Built Three.js `InstancedMesh` renderer (`src/renderer.js`) with 4 viral vault presets, custom themes, 3D tilt, and level paint editor.
- Built procedural WebAudio ASMR pop synth & synthwave music (`src/audio.js`).
- Added LocalStorage auto-save/resume (`src/storage.js`) and 60FPS canvas video recording (`src/recorder.js`).
- Deployed Cloudflare Worker + D1 (`seolith-tiles`) with Daily, Weekly, Monthly, and Yearly geo-leaderboards.
