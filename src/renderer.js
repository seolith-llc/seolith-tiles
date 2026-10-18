// src/renderer.js
// High-Performance Three.js WebGL2 Renderer for Seolith Tiles
// Uses THREE.InstancedMesh to render up to 6,400 micro-tiles, 1,600 active balls,
// 64 power-up capsules, and 1,200 3D shatter particles in just 4 draw calls at 60-120fps.

import * as THREE from 'three';

const VAULT_LEFT = 0.04;
const VAULT_RIGHT = 0.96;
const VAULT_BOTTOM = 0.42;
const VAULT_TOP = 1.30;
const WORLD_W = 1.0;
const WORLD_H = 1.35;

export class SeolithRenderer {
  constructor(canvas, theme) {
    this.canvas = canvas;
    this.theme = theme;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(theme.arenaBgHex);

    // Perspective camera calibrated so world X:[0..1], Y:[0..1.35] fits cleanly with optional 3D tilt
    this.camera = new THREE.PerspectiveCamera(36, 1.0 / 1.35, 0.1, 10.0);
    this.updateCameraTilt(theme.tiltDeg || 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // Needed for instant share card snapshot & video recording
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Lighting for tactile 3D beveled look
    const ambient = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(0.5, 1.4, 1.8);
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.28);
    rimLight.position.set(-0.6, -0.5, 1.0);
    this.scene.add(rimLight);

    this.dummy = new THREE.Object3D();
    this.tempColor = new THREE.Color();

    this.initArenaFrame();
    this.initPaddleAndAim();
    this.initInstancedMeshes();
  }

  updateCameraTilt(tiltDeg = 0) {
    const rad = (tiltDeg * Math.PI) / 180;
    const dist = 2.08;
    const cx = 0.5;
    const cy = 0.675;
    this.camera.position.set(
      cx,
      cy - Math.sin(rad) * dist * 0.85,
      Math.cos(rad) * dist
    );
    this.camera.lookAt(cx, cy + Math.sin(rad) * 0.05, 0);
  }

  initArenaFrame() {
    // Subtle dark backboard behind the vault
    const backGeo = new THREE.PlaneGeometry(WORLD_W, WORLD_H);
    this.backMat = new THREE.MeshBasicMaterial({ color: this.theme.arenaBgHex });
    const backMesh = new THREE.Mesh(backGeo, this.backMat);
    backMesh.position.set(0.5, 0.675, -0.02);
    this.scene.add(backMesh);

    // Safety floor barrier beam (glowing orange/gold laser when ★ Star capsule is active)
    const floorGeo = new THREE.BoxGeometry(WORLD_W - 0.02, 0.012, 0.02);
    this.safetyFloorMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.0,
    });
    this.safetyFloorMesh = new THREE.Mesh(floorGeo, this.safetyFloorMat);
    this.safetyFloorMesh.position.set(0.5, 0.02, 0.01);
    this.scene.add(this.safetyFloorMesh);
  }

  initPaddleAndAim() {
    // Paddle mesh
    const padGeo = new THREE.BoxGeometry(1, 1, 0.028);
    this.paddleMat = new THREE.MeshStandardMaterial({
      color: this.theme.paddleHex,
      roughness: 0.25,
      metalness: 0.15,
    });
    this.paddleMesh = new THREE.Mesh(padGeo, this.paddleMat);
    this.paddleMesh.position.set(0.5, 0.09, 0.012);
    this.scene.add(this.paddleMesh);

    // Dotted aim trajectory dots (14 small spheres, just like the viral X videos!)
    this.aimDots = [];
    const dotGeo = new THREE.SphereGeometry(0.0055, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xd1d5db,
      transparent: true,
      opacity: 0.78,
    });
    this.aimGroup = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(m);
      this.aimGroup.add(m);
    }
    this.scene.add(this.aimGroup);
  }

  initInstancedMeshes() {
    // 1. Micro-Tiles InstancedMesh (max 6400)
    const tileGeo = new THREE.BoxGeometry(1, 1, 1);
    const tileMat = new THREE.MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.12,
    });
    this.tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, 6400);
    this.tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.tileMesh);

    // 2. Balls InstancedMesh (max 1600)
    const ballGeo = new THREE.SphereGeometry(0.0062, 10, 10);
    const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, 1600);
    this.ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.ballMesh);

    // 3. Power-up Capsules InstancedMesh (max 64) — Rendered as glowing discs/orbs like the videos
    const capGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.015, 18);
    capGeo.rotateX(Math.PI / 2);
    const capMat = new THREE.MeshStandardMaterial({
      roughness: 0.2,
      metalness: 0.1,
    });
    this.capsuleMesh = new THREE.InstancedMesh(capGeo, capMat, 64);
    this.capsuleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.capsuleMesh);

    // 4. Shatter Particles InstancedMesh (max 1200)
    const partGeo = new THREE.BoxGeometry(0.008, 0.008, 0.008);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(partGeo, partMat, 1200);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.particleMesh);
  }

  applyTheme(theme) {
    this.theme = theme;
    this.scene.background.set(theme.arenaBgHex);
    this.backMat.color.set(theme.arenaBgHex);
    this.paddleMat.color.set(theme.paddleHex);
    this.updateCameraTilt(theme.tiltDeg || 0);
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Adjust camera distance so the [0..1] x [0..1.35] arena is never cropped on any screen ratio
    const targetAspect = 1.0 / 1.35;
    const baseDist = 2.08;
    const dist =
      this.camera.aspect < targetAspect
        ? baseDist * (targetAspect / this.camera.aspect)
        : baseDist;
    const rad = ((this.theme.tiltDeg || 0) * Math.PI) / 180;
    this.camera.position.set(
      0.5,
      0.675 - Math.sin(rad) * dist * 0.85,
      Math.cos(rad) * dist
    );
    this.camera.lookAt(0.5, 0.675 + Math.sin(rad) * 0.05, 0);
    this.camera.updateProjectionMatrix();
  }

  // Convert screen pointer coordinates (clientX, clientY) to normalized world X [0..1] and Y [0..1.35]
  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
    vec.unproject(this.camera);
    const dir = vec.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / dir.z;
    const pos = this.camera.position.clone().add(dir.multiplyScalar(distance));
    return { x: pos.x, y: pos.y };
  }

  renderFrame(wasm, aimAngleRad = 0) {
    const gridW = wasm.get_grid_w();
    const gridH = wasm.get_grid_h();
    const totalCells = gridW * gridH;
    const tiles = new Uint8Array(wasm.memory.buffer, wasm.get_tiles_ptr(), totalCells);

    const cellW = (VAULT_RIGHT - VAULT_LEFT) / gridW;
    const cellH = (VAULT_TOP - VAULT_BOTTOM) / gridH;
    // Slight 12% gap between micro-tiles creates the crisp grid lines seen in the viral X videos!
    const boxW = cellW * 0.86;
    const boxH = cellH * 0.86;
    const boxD = this.theme.tileDepth || 0.014;

    const cPrimary = new THREE.Color(this.theme.primaryBrickHex);
    const cGold = new THREE.Color(this.theme.goldBrickHex);
    const cArmored = new THREE.Color('#cbd5e1');
    const cSteel = new THREE.Color(this.theme.armorWallHex);
    const cCyan = new THREE.Color(this.theme.cyanBrickHex);

    let tileInstanceIdx = 0;
    for (let r = 0; r < gridH; r++) {
      const wy = VAULT_BOTTOM + (r + 0.5) * cellH;
      for (let c = 0; c < gridW; c++) {
        const t = tiles[r * gridW + c];
        if (t === 0) continue;

        const wx = VAULT_LEFT + (c + 0.5) * cellW;
        this.dummy.position.set(wx, wy, 0.005);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(boxW, boxH, t === 4 ? boxD * 1.35 : boxD);
        this.dummy.updateMatrix();
        this.tileMesh.setMatrixAt(tileInstanceIdx, this.dummy.matrix);

        if (t === 1) this.tileMesh.setColorAt(tileInstanceIdx, cPrimary);
        else if (t === 2) this.tileMesh.setColorAt(tileInstanceIdx, cGold);
        else if (t === 3) this.tileMesh.setColorAt(tileInstanceIdx, cArmored);
        else if (t === 4) this.tileMesh.setColorAt(tileInstanceIdx, cSteel);
        else this.tileMesh.setColorAt(tileInstanceIdx, cCyan);

        tileInstanceIdx++;
      }
    }
    this.tileMesh.count = tileInstanceIdx;
    this.tileMesh.instanceMatrix.needsUpdate = true;
    if (this.tileMesh.instanceColor) this.tileMesh.instanceColor.needsUpdate = true;

    // 2. Update Paddle & Aim Trajectory Line
    const px = wasm.get_paddle_x();
    const py = wasm.get_paddle_y();
    const pw = wasm.get_paddle_w();
    const ph = wasm.get_paddle_h();
    this.paddleMesh.position.set(px, py, 0.012);
    this.paddleMesh.scale.set(pw, ph, 1);

    const status = wasm.get_status();
    if (status === 0) {
      this.aimGroup.visible = true;
      const startX = px;
      const startY = py + ph * 0.5 + 0.015;
      const dx = Math.sin(aimAngleRad);
      const dy = Math.cos(aimAngleRad);
      for (let i = 0; i < this.aimDots.length; i++) {
        const stepDist = (i + 1) * 0.026;
        this.aimDots[i].position.set(startX + dx * stepDist, startY + dy * stepDist, 0.012);
      }
    } else {
      this.aimGroup.visible = false;
    }

    // Safety floor barrier visual
    const safetyTimer = wasm.get_safety_floor_timer();
    if (safetyTimer > 0) {
      const pulse = safetyTimer < 3.0 ? 0.45 + 0.45 * Math.sin(performance.now() * 0.02) : 0.9;
      this.safetyFloorMat.opacity = pulse;
    } else {
      this.safetyFloorMat.opacity = 0.0;
    }

    // 3. Update Active Balls (up to 1600)
    const maxBalls = wasm.get_max_balls();
    const balls = new Float32Array(wasm.memory.buffer, wasm.get_balls_ptr(), maxBalls * 6);
    const cBallBase = new THREE.Color(this.theme.ballHex || '#ffffff');
    let ballInstanceIdx = 0;
    for (let i = 0; i < maxBalls; i++) {
      const base = i * 6;
      if (balls[base + 4] < 0.5) continue;
      this.dummy.position.set(balls[base], balls[base + 1], 0.014);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.ballMesh.setMatrixAt(ballInstanceIdx, this.dummy.matrix);
      this.ballMesh.setColorAt(ballInstanceIdx, cBallBase);
      ballInstanceIdx++;
    }
    this.ballMesh.count = ballInstanceIdx;
    this.ballMesh.instanceMatrix.needsUpdate = true;
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;

    // 4. Update Falling Power-Up Capsules (x3, +3, <->, [-], ★)
    const maxCaps = wasm.get_max_capsules();
    const caps = new Float32Array(wasm.memory.buffer, wasm.get_capsules_ptr(), maxCaps * 5);
    let capInstanceIdx = 0;
    const activeCapsulesOverlay = [];

    for (let i = 0; i < maxCaps; i++) {
      const base = i * 5;
      if (caps[base + 4] < 0.5) continue;
      const cx = caps[base];
      const cy = caps[base + 1];
      const kind = Math.round(caps[base + 3]);

      this.dummy.position.set(cx, cy, 0.018);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.capsuleMesh.setMatrixAt(capInstanceIdx, this.dummy.matrix);

      // Color code matching the X videos:
      // 1 (x3): Lime Green #a3e635
      // 2 (+3): Sky Cyan #38bdf8
      // 3 (<->): Emerald #22c55e
      // 4 ([-]): Sunset Orange #f97316
      // 5 (★): Gold #facc15
      if (kind === 1) this.tempColor.set('#a3e635');
      else if (kind === 2) this.tempColor.set('#38bdf8');
      else if (kind === 3) this.tempColor.set('#22c55e');
      else if (kind === 4) this.tempColor.set('#f97316');
      else this.tempColor.set('#facc15');

      this.capsuleMesh.setColorAt(capInstanceIdx, this.tempColor);
      capInstanceIdx++;

      activeCapsulesOverlay.push({ x: cx, y: cy, kind });
    }
    this.capsuleMesh.count = capInstanceIdx;
    this.capsuleMesh.instanceMatrix.needsUpdate = true;
    if (this.capsuleMesh.instanceColor) this.capsuleMesh.instanceColor.needsUpdate = true;

    // 5. Update 3D Shatter Particles
    const maxParts = wasm.get_max_particles();
    const parts = new Float32Array(wasm.memory.buffer, wasm.get_particles_ptr(), maxParts * 8);
    let partInstanceIdx = 0;
    for (let i = 0; i < maxParts; i++) {
      const base = i * 8;
      const life = parts[base + 6];
      if (life <= 0.01) continue;
      this.dummy.position.set(parts[base], parts[base + 1], parts[base + 2]);
      const s = Math.max(0.1, life);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(partInstanceIdx, this.dummy.matrix);

      const cType = Math.round(parts[base + 7]);
      if (cType === 2) this.particleMesh.setColorAt(partInstanceIdx, cGold);
      else if (cType === 5) this.particleMesh.setColorAt(partInstanceIdx, cCyan);
      else this.particleMesh.setColorAt(partInstanceIdx, cPrimary);

      partInstanceIdx++;
    }
    this.particleMesh.count = partInstanceIdx;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
    return activeCapsulesOverlay;
  }

  // Convert normalized world (x, y) to CSS percentage coordinates for crisp capsule labels ('x3', '+3', '★')
  worldToCssPercent(wx, wy) {
    const v = new THREE.Vector3(wx, wy, 0.018);
    v.project(this.camera);
    const xPct = (v.x * 0.5 + 0.5) * 100;
    const yPct = (-v.y * 0.5 + 0.5) * 100;
    return { xPct, yPct };
  }
}
