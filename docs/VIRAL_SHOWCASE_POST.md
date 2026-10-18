# Viral Showcase Posts & Ready-to-Share Video Links (`v1.1.0`)

All videos below were autonomously played, controlled, and rendered at **60 FPS (`540×960` Vertical HD MP4 with synthesized ASMR woodblock/marimba audio & capsule chimes)** using the compiled Rust WebAssembly physics engine (`scripts/generate-viral-videos.mjs`) and hosted live on Cloudflare Edge.

---

## 🎬 Hosted 60FPS Gameplay Videos (Direct MP4 Links)

1. **Video #1 — Vault 01: *The Diagonal Chimney* (Crimson Red Vault)**
   - **Live Hosted MP4**: https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-01-diagonal-chimney.mp4
   - **Local File**: [seolith-vault-01-diagonal-chimney.mp4](file:///d:/src/seolith/seolith-tiles/public/videos/seolith-vault-01-diagonal-chimney.mp4)
   - **Challenge Link**: https://seolith-tiles.seolith-com.workers.dev/?ref=seolith&level=0&target=42.8&pts=68420

2. **Video #2 — Vault 02: *The Center Bent Pipe* (Sunset Amber Vault)**
   - **Live Hosted MP4**: https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-02-center-bent-pipe.mp4
   - **Local File**: [seolith-vault-02-center-bent-pipe.mp4](file:///d:/src/seolith/seolith-tiles/public/videos/seolith-vault-02-center-bent-pipe.mp4)
   - **Challenge Link**: https://seolith-tiles.seolith-com.workers.dev/?ref=seolith&level=1&target=39.2&pts=59400

---

## 🐦 Ready-to-Publish X (Twitter) / Social Posts

### Post Option A — Main Viral Launch Post (Attach `seolith-vault-02-center-bent-pipe.mp4` or `seolith-vault-01-diagonal-chimney.mp4`)

```text
I kept seeing those hypnotic 4,000-micro-tile brick breaker videos on X, so I built a fast, zero-install playable version in Rust (WebAssembly) + Three.js! 🧱⚡

• 1,600+ simultaneous balls @ 120FPS (Zero-Copy WASM)
• Satisfying procedural ASMR woodblock/marimba pop synth 🔊
• Paint your own custom tunnels & Gold x3 Trigger chambers ✏️
• Global, Country & City Time Leaderboards 🏆

🎮 Play Vault #1 (Diagonal Chimney):
https://seolith-tiles.seolith-com.workers.dev/?ref=seolith&level=0&target=42.8

🎮 Play Vault #2 (Center Bent Pipe):
https://seolith-tiles.seolith-com.workers.dev/?ref=seolith&level=1&target=39.2

🎥 Direct Gameplay Videos:
• https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-01-diagonal-chimney.mp4
• https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-02-center-bent-pipe.mp4

💻 Open Source (Rust + Three.js + Cloudflare D1):
https://github.com/seolith-llc/seolith-tiles

#SeolithTiles #RustLang #WebAssembly #ThreeJS #IndieDev #BrickBreaker
```

---

### Post Option B — Direct Reply Under `@iwhale` / Viral Brick-Breaker Threads

```text
If anyone wants to actually play these exact 2 micro-brick vaults (and paint your own tunnels) right in your browser on mobile or desktop without sketchy ads, we just built an open-source Rust + Three.js version:

🎮 Play live: https://seolith-tiles.seolith-com.workers.dev/?ref=iwhale&level=0&target=42.8
🎥 Watch our 1,500-ball AI run: https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-02-center-bent-pipe.mp4
📦 GitHub: https://github.com/seolith-llc/seolith-tiles
```

---

### Post Option C — Hacker News (`Show HN`) / Reddit (`r/rust`, `r/threejs`, `r/WebGames`)

**Title**:
`Show HN: Seolith Tiles – 1,600-ball micro-brick breaker in Rust WASM and Three.js (4 draw calls)`

**Body**:
```text
Live Game: https://seolith-tiles.seolith-com.workers.dev
GitHub Repo: https://github.com/seolith-llc/seolith-tiles
Gameplay Video 1 (Diagonal Chimney): https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-01-diagonal-chimney.mp4
Gameplay Video 2 (Center Bent Pipe): https://seolith-tiles.seolith-com.workers.dev/videos/seolith-vault-02-center-bent-pipe.mp4

We wanted to recreate those viral high-density micro-tile brick breaker videos in the browser while maintaining 60–120 FPS on mobile even when x3 capsules multiply 1 ball into 1,600+ active balls colliding against 4,096+ micro-tiles.

How we built it:
1. Rust (wasm32-unknown-unknown) Physics Engine (`src-rust/lib.rs`): Uses O(1) spatial grid lookups and 16x sub-stepped Circle-vs-AABB closest-point collision resolution so balls never tunnel/bleed through 1-tile-thick steel shafts.
2. Zero-Copy Shared Memory + Three.js InstancedMesh (`src/renderer.js`): JS reads Float32Array and Uint8Array views directly from WASM memory and renders all tiles, balls, capsules, and shatter particles in 4 GPU draw calls.
3. Procedural WebAudio Synth (`src/audio.js`): Rate-limited grain synthesis (~50 pops/sec max) generates the ASMR woodblock/marimba pops and synthwave music with zero external MP3 assets.
4. Cloudflare Worker + D1 (`worker/index.js`): Powers Daily/Weekly/Monthly/Yearly leaderboards scoped by Country/Region (`request.cf`) and an in-app Tester Feedback queue (`/api/feedback`).
```
