#!/usr/bin/env node
/**
 * scripts/generate-viral-videos.mjs
 *
 * Uses the compiled Rust WebAssembly physics engine (`public/wasm/seolith_engine.wasm`)
 * to autonomously play, control, and render 60FPS 720x1280 vertical viral MP4 videos
 * WITH synthesized ASMR woodblock/marimba audio, capsule chimes, and victory fanfare!
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const WASM_PATH = path.join(ROOT, 'public', 'wasm', 'seolith_engine.wasm');
const OUT_DIR = path.join(ROOT, 'public', 'videos');

const W = 540;
const H = 960;
const FPS = 60;

// World coordinate constants matching src-rust/lib.rs
const VAULT_LEFT = 0.04;
const VAULT_RIGHT = 0.96;
const VAULT_BOTTOM = 0.42;
const VAULT_TOP = 1.30;
const WORLD_W = 1.0;
const WORLD_H = 1.35;

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Fill rectangle in RGB24 buffer
function fillRect(buf, x0, y0, rw, rh, rgb) {
  const ix0 = Math.max(0, Math.floor(x0));
  const iy0 = Math.max(0, Math.floor(y0));
  const ix1 = Math.min(W, Math.ceil(x0 + rw));
  const iy1 = Math.min(H, Math.ceil(y0 + rh));
  const [r, g, b] = rgb;
  for (let y = iy0; y < iy1; y++) {
    let offset = (y * W + ix0) * 3;
    for (let x = ix0; x < ix1; x++) {
      buf[offset] = r;
      buf[offset + 1] = g;
      buf[offset + 2] = b;
      offset += 3;
    }
  }
}

function fillCircle(buf, cx, cy, rad, rgb) {
  const ix0 = Math.max(0, Math.floor(cx - rad));
  const iy0 = Math.max(0, Math.floor(cy - rad));
  const ix1 = Math.min(W - 1, Math.ceil(cx + rad));
  const iy1 = Math.min(H - 1, Math.ceil(cy + rad));
  const rSq = rad * rad;
  const [r, g, b] = rgb;
  for (let y = iy0; y <= iy1; y++) {
    const dy = y - cy;
    const dySq = dy * dy;
    for (let x = ix0; x <= ix1; x++) {
      const dx = x - cx;
      if (dx * dx + dySq <= rSq) {
        const off = (y * W + x) * 3;
        buf[off] = r;
        buf[off + 1] = g;
        buf[off + 2] = b;
      }
    }
  }
}

// Generate a WAV audio file matching the frame events (ASMR pops, capsule chimes, victory fanfare)
function writeWavFile(wavPath, durationSec, events) {
  const sampleRate = 44100;
  const numSamples = Math.ceil(durationSec * sampleRate);
  const samples = new Float32Array(numSamples);

  for (const ev of events) {
    const startSample = Math.floor(ev.time * sampleRate);
    if (ev.type === 'pop') {
      const len = Math.floor(0.036 * sampleRate);
      const baseFreq = 390 + ev.rowNorm * 320 + (ev.combo % 6) * 28;
      for (let i = 0; i < len && startSample + i < numSamples; i++) {
        const t = i / sampleRate;
        const freq = baseFreq * Math.exp(-t * 32);
        const env = Math.exp(-t * 95) * 0.22;
        samples[startSample + i] += Math.sin(2 * Math.PI * freq * t) * env;
      }
    } else if (ev.type === 'powerup') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const s0 = startSample + Math.floor(idx * 0.042 * sampleRate);
        const len = Math.floor(0.13 * sampleRate);
        for (let i = 0; i < len && s0 + i < numSamples; i++) {
          const t = i / sampleRate;
          const env = Math.exp(-t * 24) * 0.18;
          samples[s0 + i] += Math.sin(2 * Math.PI * freq * t) * env;
        }
      });
    } else if (ev.type === 'win') {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      notes.forEach((freq, idx) => {
        const s0 = startSample + Math.floor(idx * 0.07 * sampleRate);
        const len = Math.floor(0.32 * sampleRate);
        for (let i = 0; i < len && s0 + i < numSamples; i++) {
          const t = i / sampleRate;
          const env = Math.exp(-t * 10) * 0.24;
          samples[s0 + i] += Math.sin(2 * Math.PI * freq * t) * env;
        }
      });
    }
  }

  // Convert Float32 [-1..1] to 16-bit PCM WAV
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-0.98, Math.min(0.98, samples[i]));
    buffer.writeInt16LE(Math.floor(clamped * 32767), 44 + i * 2);
  }
  fs.writeFileSync(wavPath, buffer);
}

async function generateShowcaseVideo({
  filename,
  levelId,
  gridSize,
  primaryHex,
  paddleXStart,
  aimAngleRad,
  durationSec,
  boostScheduleSec,
}) {
  console.log(`[video-gen] Simulating & rendering ${filename} (Level ${levelId}, ${durationSec}s @ ${FPS}fps)...`);
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const wasm = instance.exports;

  wasm.build_preset_level(levelId, gridSize, gridSize, 20261018 + levelId);
  wasm.set_paddle_x(paddleXStart);
  wasm.set_aim_angle(aimAngleRad);

  const totalFrames = durationSec * FPS;
  const dt = 1 / FPS;

  const rawVideoPath = path.join(OUT_DIR, `${filename}.raw`);
  const wavPath = path.join(OUT_DIR, `${filename}.wav`);
  const mp4Path = path.join(OUT_DIR, filename);

  const rawStream = fs.createWriteStream(rawVideoPath);
  const frameBuf = Buffer.alloc(W * H * 3);

  const cBgOuter = hexToRgb('#1e2024');
  const cArenaBg = hexToRgb('#0b0c0e');
  const cPrimary = hexToRgb(primaryHex);
  const cGold = hexToRgb('#facc15');
  const cSteel = hexToRgb('#868990');
  const cCyan = hexToRgb('#38bdf8');
  const cPaddle = hexToRgb('#f26a3d');
  const cWhite = [255, 255, 255];
  const cLime = hexToRgb('#a3e635');
  const cOrange = hexToRgb('#f97316');

  const arenaMarginX = 20;
  const arenaTopY = 85;
  const arenaW = W - arenaMarginX * 2;
  const arenaH = Math.floor(arenaW * 1.35);

  const worldToScreenX = (wx) => arenaMarginX + wx * arenaW;
  const worldToScreenY = (wy) => arenaTopY + (1.0 - wy / WORLD_H) * arenaH;

  const audioEvents = [];
  let lastPopTime = -1;
  let boostCursor = 0;
  let winTriggered = false;

  for (let f = 0; f < totalFrames; f++) {
    const tSec = f * dt;

    // Launch ball at t = 0.65s after showing the dotted aim line!
    if (f === Math.floor(0.65 * FPS)) {
      wasm.launch_ball();
      audioEvents.push({ time: tSec, type: 'pop', rowNorm: 0.2, combo: 1 });
    }

    // Trigger scheduled cascades (x3 + safety star) once ball infiltrates the chamber!
    if (boostCursor < boostScheduleSec.length && tSec >= boostScheduleSec[boostCursor]) {
      const kind = boostScheduleSec[boostCursor + 0.001] || 1;
      wasm.trigger_bonus_capsule(1); // x3
      wasm.trigger_bonus_capsule(5); // Safety Star floor
      audioEvents.push({ time: tSec, type: 'powerup' });
      boostCursor++;
    }

    // AI Bot Controller: smoothly tracks falling capsules or lowest ball
    if (wasm.get_status() === 1) {
      const maxCaps = wasm.get_max_capsules();
      const caps = new Float32Array(wasm.memory.buffer, wasm.get_capsules_ptr(), maxCaps * 5);
      let targetX = null;
      let lowestY = 999;

      for (let i = 0; i < maxCaps; i++) {
        const base = i * 5;
        if (caps[base + 4] > 0.5 && caps[base + 3] !== 4) {
          if (caps[base + 1] < lowestY) {
            lowestY = caps[base + 1];
            targetX = caps[base];
          }
        }
      }

      if (targetX === null) {
        const maxBalls = wasm.get_max_balls();
        const balls = new Float32Array(wasm.memory.buffer, wasm.get_balls_ptr(), maxBalls * 6);
        for (let i = 0; i < maxBalls; i++) {
          const base = i * 6;
          if (balls[base + 4] > 0.5 && balls[base + 3] < 0 && balls[base + 1] < 0.45) {
            if (balls[base + 1] < lowestY) {
              lowestY = balls[base + 1];
              targetX = balls[base];
            }
          }
        }
      }

      if (targetX !== null) {
        const curPx = wasm.get_paddle_x();
        wasm.set_paddle_x(curPx + (targetX - curPx) * 0.22);
      }
    }

    wasm.step_physics(dt);

    const hits = wasm.get_frame_brick_hits();
    if (hits > 0 && tSec - lastPopTime >= 0.018) {
      lastPopTime = tSec;
      audioEvents.push({
        time: tSec,
        type: 'pop',
        rowNorm: wasm.get_last_hit_row_norm(),
        combo: hits,
      });
    }
    if (wasm.get_frame_powerup_collected() > 0) {
      audioEvents.push({ time: tSec, type: 'powerup' });
    }
    if (wasm.get_status() === 2 && !winTriggered) {
      winTriggered = true;
      audioEvents.push({ time: tSec, type: 'win' });
    }

    // Render Frame into RGB24 Buffer
    fillRect(frameBuf, 0, 0, W, H, cBgOuter);
    fillRect(frameBuf, arenaMarginX, arenaTopY, arenaW, arenaH, cArenaBg);

    // Top Progress Bar (matches the viral X video!)
    const initB = Math.max(1, wasm.get_initial_bricks());
    const remB = wasm.get_remaining_bricks();
    const prog = Math.min(1, Math.max(0, (initB - remB) / initB));
    fillRect(frameBuf, arenaMarginX, arenaTopY - 12, arenaW, 6, [55, 60, 70]);
    fillRect(frameBuf, arenaMarginX, arenaTopY - 12, arenaW * prog, 6, [245, 247, 250]);

    // Draw Micro-Tiles
    const gw = wasm.get_grid_w();
    const gh = wasm.get_grid_h();
    const tiles = new Uint8Array(wasm.memory.buffer, wasm.get_tiles_ptr(), gw * gh);
    const cellW = (VAULT_RIGHT - VAULT_LEFT) / gw;
    const cellH = (VAULT_TOP - VAULT_BOTTOM) / gh;
    const pxW = Math.max(1.5, cellW * arenaW * 0.85);
    const pxH = Math.max(1.5, cellH * (arenaH / WORLD_H) * 0.85);

    for (let r = 0; r < gh; r++) {
      const wy = VAULT_BOTTOM + (r + 0.5) * cellH;
      const sy = worldToScreenY(wy) - pxH * 0.5;
      for (let c = 0; c < gw; c++) {
        const t = tiles[r * gw + c];
        if (t === 0) continue;
        const wx = VAULT_LEFT + (c + 0.5) * cellW;
        const sx = worldToScreenX(wx) - pxW * 0.5;
        const col =
          t === 1 ? cPrimary : t === 2 ? cGold : t === 4 ? cSteel : cCyan;
        fillRect(frameBuf, sx, sy, pxW, pxH, col);
      }
    }

    // Draw Safety Floor Laser when active
    if (wasm.get_safety_floor_timer() > 0) {
      const sy = worldToScreenY(0.025);
      fillRect(frameBuf, arenaMarginX + 4, sy - 3, arenaW - 8, 6, cOrange);
    }

    // Draw Paddle
    const px = wasm.get_paddle_x();
    const py = wasm.get_paddle_y();
    const pw = wasm.get_paddle_w();
    const ph = wasm.get_paddle_h();
    const padSx = worldToScreenX(px - pw * 0.5);
    const padSy = worldToScreenY(py + ph * 0.5);
    fillRect(
      frameBuf,
      padSx,
      padSy,
      pw * arenaW,
      ph * (arenaH / WORLD_H),
      cPaddle
    );

    // Draw Dotted Aim Trajectory when STATUS_READY
    if (wasm.get_status() === 0) {
      const dx = Math.sin(aimAngleRad);
      const dy = Math.cos(aimAngleRad);
      for (let i = 1; i <= 12; i++) {
        const ax = px + dx * i * 0.026;
        const ay = py + 0.02 + dy * i * 0.026;
        fillCircle(frameBuf, worldToScreenX(ax), worldToScreenY(ay), 2.5, [190, 195, 205]);
      }
    }

    // Draw Falling Capsules
    const maxCaps = wasm.get_max_capsules();
    const caps = new Float32Array(wasm.memory.buffer, wasm.get_capsules_ptr(), maxCaps * 5);
    for (let i = 0; i < maxCaps; i++) {
      const base = i * 5;
      if (caps[base + 4] < 0.5) continue;
      const cx = worldToScreenX(caps[base]);
      const cy = worldToScreenY(caps[base + 1]);
      const kind = Math.round(caps[base + 3]);
      const col = kind === 1 ? cLime : kind === 2 ? cCyan : kind === 5 ? cGold : cOrange;
      fillCircle(frameBuf, cx, cy, 11, col);
      fillCircle(frameBuf, cx, cy, 4, cWhite);
    }

    // Draw Active Balls
    const maxBalls = wasm.get_max_balls();
    const balls = new Float32Array(wasm.memory.buffer, wasm.get_balls_ptr(), maxBalls * 6);
    for (let i = 0; i < maxBalls; i++) {
      const base = i * 6;
      if (balls[base + 4] < 0.5) continue;
      fillCircle(
        frameBuf,
        worldToScreenX(balls[base]),
        worldToScreenY(balls[base + 1]),
        3.2,
        cWhite
      );
    }

    rawStream.write(Buffer.from(frameBuf));
  }

  await new Promise((res) => rawStream.end(res));
  writeWavFile(wavPath, durationSec, audioEvents);

  // Encode H.264 MP4 + AAC Audio via FFmpeg
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${W}x${H}`,
      '-r', String(FPS),
      '-i', rawVideoPath,
      '-i', wavPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-crf', '21',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      mp4Path,
    ]);
    ff.on('close', (code) => {
      try {
        fs.unlinkSync(rawVideoPath);
        fs.unlinkSync(wavPath);
      } catch (_) {}
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  const stat = fs.statSync(mp4Path);
  console.log(`[video-gen] Created ${mp4Path} (${(stat.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Video 1: Vault 01 — The Diagonal Chimney (Crimson Vault inspired by @iwhale Post #1)
  await generateShowcaseVideo({
    filename: 'seolith-vault-01-diagonal-chimney.mp4',
    levelId: 0,
    gridSize: 64,
    primaryHex: '#e11922',
    paddleXStart: 0.74,
    aimAngleRad: -0.02,
    durationSec: 18,
    boostScheduleSec: [2.2, 3.6, 5.2, 7.0, 9.0],
  });

  // Video 2: Vault 02 — The Center Bent Pipe (Amber Grid inspired by @iwhale Post #2)
  await generateShowcaseVideo({
    filename: 'seolith-vault-02-center-bent-pipe.mp4',
    levelId: 1,
    gridSize: 56,
    primaryHex: '#ea6c1e',
    paddleXStart: 0.50,
    aimAngleRad: -0.02,
    durationSec: 18,
    boostScheduleSec: [2.4, 3.8, 5.4, 7.2, 9.5],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
