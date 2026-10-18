# How We Built **Seolith Tiles**: A Novice Developer's Guide to Rust (WASM), Three.js & Cloudflare Edge

> **Written for Beginner & Curious Developers**: Have you ever watched one of those viral "satisfying brick breaker" videos on X/TikTok where a single ball sneaks up a narrow chimney, hits a yellow block, multiplies into **1,500 bouncing balls**, and shreds **4,000 tiny tiles** in seconds—and wondered: *"How does a browser do all that without freezing?"*
>
> This post walks you through the exact design, physics, architecture diagram, and sequence diagram behind **Seolith Tiles (`v1.1.0`)** in plain, approachable language.

---

## 1. The Big Problem: Why Normal JavaScript Slows Down at 1,500 Balls

If you build a normal web game using standard HTML `<div>` elements or basic JavaScript objects:
1. **CPU Bottleneck (Physics)**: Checking 1,600 balls against 4,096 bricks every frame means $1,600 \times 4,096 = 6,553,600$ checks *per frame* (nearly **400 million checks per second** at 60 FPS!). Furthermore, fast balls can "tunnel" (bleed) right through thin walls between frames.
2. **GPU Bottleneck (Drawing)**: Asking WebGL to draw 4,096 separate brick meshes and 1,600 ball meshes one by one creates **5,700+ draw calls per frame**, choking mobile phones.
3. **Audio Bottleneck (Sound)**: Playing 500 MP3 audio files at the same millisecond causes loud static distortion and crashes mobile browser audio tabs.

---

## 2. Our 4-Pillar Solution (Explained Simply)

### Pillar 1: Rust + WebAssembly (`src-rust/lib.rs`) — The "Physics Muscle"
Instead of calculating collisions in JavaScript, we wrote the physics engine in **Rust** and compiled it to **WebAssembly (`.wasm`)**—a compact binary format (`154 KB`) that runs at near-native C/Rust speed inside the browser.
- **O(1) Grid Lookup**: Because our vault is a neat grid (e.g., `64×64`), a ball at `(x, y)` doesn't check all 4,096 bricks! It simply divides its `(x, y)` coordinate by the tile size to check **only the 4 to 9 tiles immediately touching it**.
- **Watertight Sub-Stepping & Circle-vs-AABB Collision (`v1.1.0`)**: To prevent balls from bleeding through 1-tile-thick gray steel walls, Rust breaks each frame into up to **16 micro-steps** and uses **Circle-vs-Box (AABB) closest-point math** with priority for steel armor walls.
- **Zero-Copy Shared Memory**: JavaScript doesn't copy arrays back and forth from Rust. Instead, Three.js reads the exact memory bytes (`Uint8Array` and `Float32Array`) directly from WebAssembly's RAM!

### Pillar 2: Three.js `InstancedMesh` (`src/renderer.js`) — The "1-Draw-Call Artist"
Instead of drawing 4,096 tiles one by one, we use `THREE.InstancedMesh`. Think of it like a **rubber stamp**: we upload **one** 3D cube to the graphics card and hand it a list of 4,096 positions and colors. The GPU draws all 4,096 tiles in **1 single step**, all 1,600 balls in **1 step**, and all 1,200 shatter particles in **1 step**!

### Pillar 3: WebAudio Synthesizer (`src/audio.js`) — The "ASMR Sound Designer"
We don't load a single `.mp3` file! Every woodblock pop, crystal chime, and synthwave bass note is generated mathematically using the browser's built-in `AudioContext` oscillators—throttled to ~50 crisp grains per second so 1,500 balls sound like hypnotic ASMR rain rather than loud noise.

### Pillar 4: Cloudflare Worker + D1 SQLite (`worker/index.js`) — The "Global Referee"
When you clear a vault or submit tester feedback, a serverless **Cloudflare Worker** running in 300+ cities worldwide reads your country/city from the network edge (`request.cf`), verifies your anti-cheat cryptographic proof, and saves your rank or bug report into **Cloudflare D1** (edge SQLite).

---

## 3. System Architecture Diagram

```mermaid
flowchart TB
    subgraph PlayerDevice ["📱💻 Player's Browser (Mobile & Desktop)"]
        UI["HTML5 HUD + Design Studio + Feedback Modal\n(index.html & src/main.js)"]
        ThreeJS["Three.js WebGL2 Renderer\n4x InstancedMesh Draw Calls\n(src/renderer.js)"]
        WebAudio["Procedural WebAudio Synth\nASMR Pops & Synthwave Music\n(src/audio.js)"]
        Recorder["60FPS Canvas Video Recorder\n& Viral Share Card Generator\n(src/recorder.js)"]
        LocalStore["LocalStorage Manager\n2.5s Auto-Save/Resume + 100-Play Gate\n(src/storage.js)"]

        subgraph WASM ["🦀 Rust WebAssembly Engine (src-rust/lib.rs)"]
            Grid["64x64 Micro-Tile Array\n(Watertight Steel & Bricks)"]
            Substep["16x Sub-Stepped Circle-AABB\nCollision Solver (1,600 Balls)"]
            Proof["FNV/HMAC Anti-Cheat\nRun Proof Hasher"]
        end

        UI -->|Pointer / Touch / Keys| Substep
        Substep <-->|"Zero-Copy Shared RAM\n(Float32Array / Uint8Array)"| ThreeJS
        Substep -->|Hit & Capsule Events| WebAudio
        Substep -->|Snapshot every 2.5s| LocalStore
        ThreeJS -->|captureStream 60fps| Recorder
    end

    subgraph CloudflareEdge ["☁️ Cloudflare Global Edge (seolith-tiles)"]
        Worker["Cloudflare Worker API\n(worker/index.js)\nGeo Detection: request.cf"]
        D1[("Cloudflare D1 Database\n(seolith-tiles-db)\n1. leaderboard_runs\n2. tester_feedback")]
    end

    Proof -->|"POST /api/leaderboard"| Worker
    UI -->|"POST / GET /api/feedback"| Worker
    Worker <-->|SQL Queries| D1
```

---

## 4. End-to-End Gameplay, Viral Share & Feedback Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Player as Player / Tester
    participant UI as Main UI & Three.js (JS)
    participant Rust as Rust WASM Engine
    participant Audio as WebAudio Synth
    participant Store as LocalStorage
    participant CF as Cloudflare Worker + D1

    Player->>UI: Aim dotted line & Tap to Launch Ball
    UI->>Rust: set_aim_angle(rad) & launch_ball()
    UI->>Store: incrementPlayCount() (Checks 100-Play Gate)

    loop Every Frame (60–120 FPS)
        UI->>Rust: step_physics(dt)
        Note over Rust: 16x Sub-stepped Circle-vs-AABB<br/>Checks 3x3 neighborhood per ball<br/>Spawns x3 / +3 / ★ capsules
        Rust-->>UI: Zero-copy pointers (tiles, balls, capsules, particles)
        UI->>UI: Update 4 InstancedMeshes & Render 3D Scene
        UI->>Audio: playBrickHits(count, rowHeight) & playPowerup()
        opt Every 2.5 Seconds
            UI->>Store: saveLiveSnapshot(tilesB64, activeBalls, score)
        end
    end

    Note over Player,Rust: All 3,400+ Micro-Tiles Destroyed! (STATUS_WON)
    UI->>Audio: playVictoryFanfare()
    UI->>Rust: compute_run_proof(levelId, score, elapsedMs, peakBalls)
    UI->>CF: POST /api/leaderboard (with Run Proof + Edge Geo)
    CF-->>UI: 200 OK (Saved to Daily/Weekly/Monthly/Yearly Ranks)

    alt Player Shares Viral Clip / Challenge Link
        Player->>UI: Click "Share on X / WhatsApp / Download Video"
        UI->>UI: Generate 1080x1350 Scorecard + ?ref=handle Link
        UI-->>Player: Grants +3 Free x3 Cascade Boosts for sharing!
    else Tester Submits Feedback / Bug Report
        Player->>UI: Open "💬 Feedback" -> Submit suggestion or bug
        UI->>CF: POST /api/feedback (category, severity, message, version)
        CF-->>UI: Stored in D1 `tester_feedback` (Readable by AI Agent!)
    end
```

---

## 5. How Viral Social Growth & Immediate Monetization Work Together

1. **Challenge Referral Links (`?ref=Handle&level=0&target=42.8`)**:
   - When a player shares on **X (Twitter)**, **WhatsApp**, **Reddit**, or copies their link, the URL carries their handle, level, and clear time.
   - Friends who click the link see a live **"🎯 Challenge Mode: Beat @Handle's 42.8s clear!"** banner at the top of their screen.
   - **Instant Share Reward**: Every time a user shares their run on social media, they immediately receive **+3 Free `⚡ x3 Cascade Boost` credits**, incentivizing organic viral loops on X and TikTok.
2. **Three-Tier Monetization Funnel (Immediate + 100-Play Gate)**:
   - **Tier 1 (Immediate Impulse — `⚡ x3 Boost Pack` & `👑 Seolith Pro Pass`)**: Players don't have to wait 100 plays to support or upgrade—a **👑 Pro / Boosts** button is always accessible in the top bar and when they run out of `x3 Boost` credits.
   - **Tier 2 (Rewarded Sponsor Spot)**: Players can watch a 5-second sponsor spot anytime to refill `+3 x3 Boosts` or unlock `+5 Free Plays`.
   - **Tier 3 (The 100-Play Habit Gate)**: After 100 plays, power users hit the milestone gate converting loyal daily players into lifetime **Seolith Pro Pass** supporters.
