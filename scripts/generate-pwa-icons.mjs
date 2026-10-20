#!/usr/bin/env node
/**
 * scripts/generate-pwa-icons.mjs
 * Generates valid 192x192 and 512x512 PNG icons in `public/icons/` with zero external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function generateIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // Filter type 0
    const ny = y / size;

    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const idx = rowStart + 1 + x * 4;

      // Dark obsidian background
      let r = 13;
      let g = 16;
      let b = 24;

      // Outer subtle border
      if (nx > 0.06 && nx < 0.94 && ny > 0.06 && ny < 0.94) {
        r = 18;
        g = 21;
        b = 32;
      }

      // Micro-tile brick rows in top half
      if (ny > 0.16 && ny < 0.48 && nx > 0.15 && nx < 0.85) {
        const col = Math.floor(((nx - 0.15) / 0.7) * 5);
        const row = Math.floor(((ny - 0.16) / 0.32) * 3);
        const gx = ((nx - 0.15) / 0.7) * 5 - col;
        const gy = ((ny - 0.16) / 0.32) * 3 - row;
        if (gx > 0.08 && gx < 0.92 && gy > 0.12 && gy < 0.88) {
          if (row === 1 && (col === 1 || col === 2 || col === 3)) {
            // Gold trigger core
            r = 250;
            g = 204;
            b = 21;
          } else {
            // Crimson-orange brick
            r = 235;
            g = 68;
            b = 44;
          }
        }
      }

      // Cascade balls in center
      const balls = [
        { cx: 0.5, cy: 0.6, rad: 0.045, c: [255, 255, 255] },
        { cx: 0.38, cy: 0.65, rad: 0.038, c: [34, 211, 238] },
        { cx: 0.63, cy: 0.64, rad: 0.04, c: [250, 204, 21] },
      ];
      for (const ball of balls) {
        const dx = nx - ball.cx;
        const dy = ny - ball.cy;
        if (dx * dx + dy * dy <= ball.rad * ball.rad) {
          r = ball.c[0];
          g = ball.c[1];
          b = ball.c[2];
        }
      }

      // Orange paddle at bottom
      if (ny > 0.78 && ny < 0.85 && nx > 0.25 && nx < 0.75) {
        r = 242;
        g = 106;
        b = 61;
      }

      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), generateIconPng(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), generateIconPng(512));
console.log('✅ Generated public/icons/icon-192.png and public/icons/icon-512.png');
