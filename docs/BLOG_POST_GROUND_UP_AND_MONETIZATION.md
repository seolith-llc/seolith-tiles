---
title: "How We Built a 1,600-Ball Micro-Tile Brick Breaker at 120 FPS with Rust WASM, Three.js & Cloudflare Edge (Plus Our Monetization Blueprint)"
published: true
description: "A complete from-the-ground-up engineering guide and monetization breakdown for Seolith Tiles: zero-copy Rust WebAssembly physics, 4-draw-call Three.js InstancedMesh rendering, procedural WebAudio ASMR, and Cloudflare Workers + D1."
tags: rust, webassembly, threejs, cloudflare
canonical_url: https://seolith-tiles.seolith-com.workers.dev/blog
cover_image: https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-01-diagonal-chimney.mp4
---

# How We Built Seolith Tiles From the Ground Up (Rust + WASM + Three.js + Cloudflare Edge) — And How It Monetizes

If you have scrolled through X (Twitter), TikTok, or Reels lately, you have almost certainly paused to watch those mesmeric **micro-tile brick breaker** videos (like `@iwhale`'s viral *Diagonal Chimney* and *Center Bent Pipe* clips). A single ball threads a razor-thin steel shaft, ricochets off a 45° chute into a cluster of gold multiplier blocks, and suddenly **1,600+ balls** erupt inside a sealed chamber of **4,096+ tiny bricks** accompanied by rapid-fire ASMR woodblock pops.

Most of those viral clips are offline renders—you can't actually play them in your browser, customize the screen, or compete on global and local leaderboards.

So we built **[Seolith Tiles](https://seolith-tiles.seolith-com.workers.dev)** from the ground up: a 60–120 FPS playable web and mobile game powered by **Rust (`wasm32-unknown-unknown`)**, **Three.js (`InstancedMesh`)**, **Procedural WebAudio**, and **Cloudflare Workers + D1 SQLite**.

- 🎮 **Play Live on Cloudflare Edge**: [https://seolith-tiles.seolith-com.workers.dev](https://seolith-tiles.seolith-com.workers.dev)
- 📖 **Read on Our Website**: [https://seolith-tiles.seolith-com.workers.dev/blog](https://seolith-tiles.seolith-com.workers.dev/blog)
- 💻 **Open-Source GitHub Repo**: [https://github.com/seolith-llc/seolith-tiles](https://github.com/seolith-llc/seolith-tiles)
- 🎬 **Watch 60FPS Gameplay Captures**:
  - [Vault #1: The Diagonal Chimney (MP4)](https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-01-diagonal-chimney.mp4)
  - [Vault #2: The Center Bent Pipe (MP4)](https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-02-center-bent-pipe.mp4)

---

## 1. Why Naive JavaScript Breaks at 1,600 Balls × 6,400 Micro-Tiles

When you multiply `1,600 active balls` by `6,400 micro-tiles` at `120 FPS`, a naive nested loop performs **1.22 billion checks per second**:

1. **Physics Tunneling ("Wall Bleeding")**: At high speeds, a ball travels further in a single 16.6ms frame than the thickness of a 1-tile steel wall. Without continuous sub-stepping and closest-point Circle-vs-AABB resolution, balls "bleed" right through diagonal steel shafts.
2. **WebGL Draw-Call Collapse**: Creating 6,400 individual Three.js `Mesh` objects and 1,600 ball meshes issues 8,000+ GPU draw calls per frame, bringing mobile devices to a crawl.
3. **Garbage Collection Stutters**: Allocating temporary collision vectors or audio objects every frame triggers JavaScript GC pauses right in the middle of the cascade.

---

## 2. System Architecture From the Ground Up (The 4 Pillars)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        PLAYER BROWSER (Mobile / Desktop)                │
│                                                                         │
│  ┌──────────────────────┐        Zero-Copy Shared Memory Views          │
│  │  Three.js Renderer   │◄────── (Uint8Array / Float32Array) ──────┐    │
│  │  (4 InstancedMeshes) │                                          │    │
│  └──────────┬───────────┘                                          │    │
│             │ requestAnimationFrame (60-120Hz)                     ▼    │
│  ┌──────────┴───────────┐     step_physics(dt)      ┌─────────────────┐ │
│  │   Main Game Loop     │──────────────────────────►│   Rust WASM     │ │
│  │   (src/main.js)      │◄──────────────────────────│ Physics Engine  │ │
│  └────┬─────────┬───────┘   Hits / Score / Status   │ (src-rust/lib)  │ │
│       │         │                                   └─────────────────┘ │
│       ▼         ▼                                                       │
│  ┌─────────┐ ┌──────────────┐      HTTPS JSON       ┌─────────────────┐ │
│  │WebAudio │ │ LocalStorage │   /api/leaderboard    │ Cloudflare Edge │ │
│  │ASMR Syn │ │ 2.5s Resume  │   /api/checkout       │  Worker + D1    │ │
│  └─────────┘ └──────────────┘   /api/analytics      └─────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pillar 1: Zero-Copy Rust WebAssembly Physics (`src-rust/lib.rs`)
We wrote the physics engine in pure Rust with **zero heap allocations** during gameplay. Every tile, ball, power-up capsule, and shatter particle lives in a fixed, cache-aligned `static mut STATE: EngineState` struct that compiles to a **22 KB `.wasm` binary**:

- **$O(1)$ Spatial Grid Lookup**: Instead of iterating over all 6,400 tiles, we convert each ball's `(x, y)` world position directly into grid coordinates `(col, row)` and inspect only the `3 × 3` neighborhood around the ball.
- **16x Sub-Stepping + Multi-Pass Circle-vs-AABB Solver**: Each frame is subdivided into up to 16 sub-steps (`max_step_dist = 0.22 * cell_size`). Pass 0 resolves indestructible `TILE_WALL_STEEL` armor blocks first using exact closest-point Circle-vs-AABB math; Pass 1 resolves breakable micro-bricks (`TILE_BRICK_PRIMARY`, `TILE_BRICK_GOLD`, `TILE_BRICK_CYAN`).
- **Watertight 4-Connected Steel Walls**: Every diagonal chute is reinforced with 2-tile-thick steel walls so balls never leak through diagonal stair-stepped corners.

### Pillar 2: 4-Draw-Call Three.js `InstancedMesh` Renderer (`src/renderer.js`)
JavaScript never serializes or copies arrays from Rust. Instead, `src/renderer.js` creates `Uint8Array` and `Float32Array` views directly over Rust's linear WebAssembly memory (`wasm.memory.buffer`) and renders the entire arena in just **4 GPU draw calls**:
1. `brickMesh`: Up to 6,400 micro-tiles with customizable colors and 2D/2.5D/3D camera tilt.
2. `ballMesh`: Up to 1,600 active cascade balls.
3. `capsuleMesh`: Up to 64 falling power-up capsules (`x3`, `+3`, `<->`, `[-]`, `★`).
4. `particleMesh`: Up to 1,200 3D shatter particles.

### Pillar 3: Procedural WebAudio ASMR Synthesizer (`src/audio.js`)
Why do the viral videos sound so addictive? Because the pop pitch climbs as the cascade eats deeper into the upper vault! Whenever Rust records brick hits during a frame, it exposes `get_last_hit_row_norm()` (`0.0` at the bottom row to `1.0` at the top row). Our WebAudio synthesizer maps that normalized height to a pentatonic marimba/woodblock frequency with subtle pitch jitter and a 118 BPM synthwave bassline—with **zero external MP3 assets**.

### Pillar 4: Cloudflare Workers + D1 Edge Backend (`worker/index.js`)
Our entire backend runs at the edge on **Cloudflare Workers + D1 SQLite**:
- **Time & Geo-Location Leaderboards (`/api/leaderboard`)**: Tracks fastest clear times and highest points across **Daily, Weekly, Monthly, and Yearly** windows, automatically tagged with `request.cf` Country, Region, and City.
- **Protected Admin Geo-Analytics (`/api/admin/analytics`)**: Gives authorized admin accounts real-time visibility into Unique Visitors, Pageviews, Plays/Wins, Mobile vs. Desktop split, Edge Colos, and Revenue.
- **Live Tester Feedback Queue (`/api/feedback`)**: Lets players submit bug reports or feature ideas in-app, which we pull straight into `docs/TESTER_FEEDBACK.md` via `npm run feedback:read`.

---

## 3. How Seolith Tiles Is Monetized (Day-1 + 100-Play Hybrid Funnel)

Most browser games either ruin retention with intrusive banner ads on Play #1 or never monetize at all. We designed a **4-tier hybrid monetization funnel** backed by `/api/monetization`, `/api/checkout`, and our `monetization_orders` D1 table:

| Monetization Tier | Trigger Point | Price / Value Exchange | Technical Implementation |
| :--- | :--- | :--- | :--- |
| **1. Viral Share-to-Boost Loop** | Day 1 (Every Run) | **FREE** (`+3 ⚡ x3 Boosts` per share) | Generates `?ref=Handle&level=0&target=42.8` challenge links for X, WhatsApp, and Reddit (`$0` CAC viral acquisition). |
| **2. Interactive 5-Second Sponsor Spot** | When out of boosts or at the 100-play gate | **FREE to Player** (`+3 Boosts & +5 Free Plays`) | Served via `GET /api/monetization` with a live 5-second countdown card, partner CTA link, and `sponsor_watch` analytics event. |
| **3. Impulse Boost Micro-Pack (`+15x Boosts`)** | Anytime via `👑 Pro` Shop | **$0.99 USD** | Processed via `POST /api/checkout` (`boost_pack_15`), crediting 15 instant `x3 Multiplier + Safety Floor` boosts. |
| **4. Lifetime Seolith Pro Pass (100-Play Gate)** | Anytime via `👑 Pro` or after **100 Free Plays** | **$2.99 USD Lifetime** | Unlocks unlimited plays past the 100-play gate, automatic Gold Safety Floor on launch, `∞` x3 Boosts, and a Verified `👑 PRO` badge. |

### How `/api/checkout` Works in 3 Seamless Modes
Our Cloudflare Worker checkout endpoint (`POST /api/checkout` in `worker/index.js`) automatically adapts to your environment configuration:
1. **Mode A — Live Stripe REST API Checkout (`STRIPE_SECRET_KEY`)**: Creates a Stripe Checkout Session at the edge and redirects back with `?pro_unlocked=1` or `?boost_pack=1`.
2. **Mode B — Hosted Stripe Payment Link (`STRIPE_PAYMENT_LINK`)**: Redirects directly to your Stripe Payment Link with `client_reference_id`.
3. **Mode C — Instant Edge Founding Supporter Pass**: Logs the order directly into the Cloudflare D1 `monetization_orders` table with edge geo-telemetry and returns a signed `unlockToken` (`seo_pro_...`) for frictionless instant activation.

---

## 4. Play It Now & Fork the Architecture

All 6 vaults—including **01. The Diagonal Chimney**, **02. The Center Bent Pipe**, **03. Twin Helix Reactor**, **04. Seolith Citadel**, **05. The Hourglass Funnel**, and **06. The Golden Spiral Vault**—are live right now:

👉 **[Play Seolith Tiles Live](https://seolith-tiles.seolith-com.workers.dev)**  
👉 **[Star & Explore the Code on GitHub (`seolith-llc/seolith-tiles`)](https://github.com/seolith-llc/seolith-tiles)**
