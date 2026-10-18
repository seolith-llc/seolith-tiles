#![allow(static_mut_refs)]
// src-rust/lib.rs
// High-performance micro-tile brick breaker physics engine compiled to WebAssembly.
// Designed for zero-copy Float32Array / Uint8Array shared memory access from Three.js.

const MAX_GRID_W: usize = 80;
const MAX_GRID_H: usize = 80;
const MAX_CELLS: usize = MAX_GRID_W * MAX_GRID_H; // 6400 micro-tiles max
const MAX_BALLS: usize = 1600;
const MAX_CAPSULES: usize = 64;
const MAX_PARTICLES: usize = 1200;

// Tile types
pub const TILE_EMPTY: u8 = 0;
pub const TILE_BRICK_PRIMARY: u8 = 1; // Red / Orange / Theme Primary
pub const TILE_BRICK_GOLD: u8 = 2;    // Yellow / Gold trigger brick (guaranteed capsule drop)
pub const TILE_BRICK_ARMORED: u8 = 3; // 2-hit brick -> turns into TILE_BRICK_PRIMARY
pub const TILE_WALL_STEEL: u8 = 4;    // Indestructible gray perimeter / tunnel wall
pub const TILE_BRICK_CYAN: u8 = 5;    // Bonus high-score cyan brick

// Capsule power-up types (matching the viral X videos!)
pub const CAPSULE_MUL3: u8 = 1;       // Lime/Green "x3": triples all active balls in play
pub const CAPSULE_ADD3: u8 = 2;       // Cyan "+3": spawns 3 new balls from the paddle
pub const CAPSULE_EXPAND: u8 = 3;     // Green "<->": expands the paddle width
pub const CAPSULE_SHRINK: u8 = 4;     // Orange "[-]": shrinks the paddle width
pub const CAPSULE_STAR: u8 = 5;       // Gold Star "★": activates bottom safety barrier floor

// Game status
pub const STATUS_READY: u32 = 0;      // Waiting on paddle to aim & launch
pub const STATUS_PLAYING: u32 = 1;    // Balls active
pub const STATUS_WON: u32 = 2;        // All breakable bricks cleared!
pub const STATUS_LOST: u32 = 3;       // All balls lost

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Ball {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub active: f32, // 1.0 = active, 0.0 = inactive
    pub color_id: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Capsule {
    pub x: f32,
    pub y: f32,
    pub vy: f32,
    pub kind: f32,   // 1..5
    pub active: f32, // 1.0 = active
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Particle {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vx: f32,
    pub vy: f32,
    pub vz: f32,
    pub life: f32,
    pub color_type: f32,
}

pub struct EngineState {
    pub grid_w: usize,
    pub grid_h: usize,
    pub tiles: [u8; MAX_CELLS],
    pub balls: [Ball; MAX_BALLS],
    pub capsules: [Capsule; MAX_CAPSULES],
    pub particles: [Particle; MAX_PARTICLES],

    pub active_balls_count: u32,
    pub peak_balls_count: u32,
    pub remaining_bricks: u32,
    pub initial_bricks: u32,
    pub destroyed_bricks_total: u32,

    pub paddle_x: f32,
    pub paddle_y: f32,
    pub paddle_w: f32,
    pub paddle_h: f32,
    pub base_paddle_w: f32,

    pub aim_angle: f32, // radians, 0 = straight up
    pub ball_speed: f32,
    pub ball_radius: f32,

    pub safety_floor_timer: f32, // seconds remaining for Star safety floor
    pub elapsed_ms: f32,
    pub score: u32,
    pub combo: u32,
    pub status: u32,
    pub rng_state: u32,

    // Frame audio & feedback counters read by JS after each step()
    pub frame_brick_hits: u32,
    pub frame_wall_hits: u32,
    pub frame_paddle_hits: u32,
    pub frame_powerup_collected: u32,
    pub last_hit_row_norm: f32,

    pub particle_cursor: usize,
}

static mut STATE: EngineState = EngineState {
    grid_w: 60,
    grid_h: 60,
    tiles: [0; MAX_CELLS],
    balls: [Ball {
        x: 0.5,
        y: 0.1,
        vx: 0.0,
        vy: 0.0,
        active: 0.0,
        color_id: 0.0,
    }; MAX_BALLS],
    capsules: [Capsule {
        x: 0.0,
        y: 0.0,
        vy: 0.0,
        kind: 0.0,
        active: 0.0,
    }; MAX_CAPSULES],
    particles: [Particle {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        vx: 0.0,
        vy: 0.0,
        vz: 0.0,
        life: 0.0,
        color_type: 0.0,
    }; MAX_PARTICLES],
    active_balls_count: 0,
    peak_balls_count: 0,
    remaining_bricks: 0,
    initial_bricks: 0,
    destroyed_bricks_total: 0,
    paddle_x: 0.5,
    paddle_y: 0.08,
    paddle_w: 0.18,
    paddle_h: 0.018,
    base_paddle_w: 0.18,
    aim_angle: 0.0,
    ball_speed: 0.62,
    ball_radius: 0.0055,
    safety_floor_timer: 0.0,
    elapsed_ms: 0.0,
    score: 0,
    combo: 0,
    status: STATUS_READY,
    rng_state: 0xACE1_2026,
    frame_brick_hits: 0,
    frame_wall_hits: 0,
    frame_paddle_hits: 0,
    frame_powerup_collected: 0,
    last_hit_row_norm: 0.5,
    particle_cursor: 0,
};

// Coordinate space:
// World X is [0.0, 1.0] (left to right)
// World Y is [0.0, 1.35] (0.0 = bottom of screen, 1.35 = top of screen)
// The micro-tile vault occupies X in [VAULT_LEFT, VAULT_RIGHT] and Y in [VAULT_BOTTOM, VAULT_TOP]
const WORLD_W: f32 = 1.0;
const WORLD_H: f32 = 1.35;
const VAULT_LEFT: f32 = 0.04;
const VAULT_RIGHT: f32 = 0.96;
const VAULT_BOTTOM: f32 = 0.42;
const VAULT_TOP: f32 = 1.30;

#[inline]
fn xorshift32(state: &mut u32) -> u32 {
    let mut x = *state;
    if x == 0 {
        x = 0x9E37_79B9;
    }
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    x
}

#[inline]
fn rand_f32(state: &mut u32) -> f32 {
    (xorshift32(state) & 0x00FF_FFFF) as f32 / 16_777_216.0
}

#[inline]
fn is_breakable(tile: u8) -> bool {
    tile == TILE_BRICK_PRIMARY || tile == TILE_BRICK_GOLD || tile == TILE_BRICK_ARMORED || tile == TILE_BRICK_CYAN
}

impl EngineState {
    pub fn reset(&mut self, grid_w: usize, grid_h: usize, seed: u32) {
        self.grid_w = grid_w.clamp(16, MAX_GRID_W);
        self.grid_h = grid_h.clamp(16, MAX_GRID_H);
        self.rng_state = if seed == 0 { 0x2026_1017 } else { seed };

        for i in 0..MAX_CELLS {
            self.tiles[i] = TILE_EMPTY;
        }
        for i in 0..MAX_BALLS {
            self.balls[i].active = 0.0;
        }
        for i in 0..MAX_CAPSULES {
            self.capsules[i].active = 0.0;
        }
        for i in 0..MAX_PARTICLES {
            self.particles[i].life = 0.0;
        }

        self.paddle_w = self.base_paddle_w;
        self.paddle_x = 0.5;
        self.paddle_y = 0.09;
        self.safety_floor_timer = 0.0;
        self.elapsed_ms = 0.0;
        self.score = 0;
        self.combo = 0;
        self.destroyed_bricks_total = 0;
        self.status = STATUS_READY;

        // Place initial starter ball on the paddle
        self.balls[0] = Ball {
            x: self.paddle_x,
            y: self.paddle_y + self.paddle_h * 0.5 + self.ball_radius + 0.004,
            vx: 0.0,
            vy: 0.0,
            active: 1.0,
            color_id: 0.0,
        };
        self.active_balls_count = 1;
        self.peak_balls_count = 1;
    }

    pub fn recount_bricks(&mut self) {
        let mut count = 0u32;
        let total = self.grid_w * self.grid_h;
        for i in 0..total {
            if is_breakable(self.tiles[i]) {
                count += 1;
            }
        }
        self.remaining_bricks = count;
        self.initial_bricks = count;
    }

    pub fn spawn_shatter(&mut self, wx: f32, wy: f32, color_type: f32) {
        for _ in 0..2 {
            let idx = self.particle_cursor % MAX_PARTICLES;
            self.particle_cursor = self.particle_cursor.wrapping_add(1);
            let angle = rand_f32(&mut self.rng_state) * 6.2831853;
            let spd = 0.08 + rand_f32(&mut self.rng_state) * 0.28;
            self.particles[idx] = Particle {
                x: wx,
                y: wy,
                z: 0.01,
                vx: angle.cos() * spd,
                vy: angle.sin() * spd,
                vz: 0.12 + rand_f32(&mut self.rng_state) * 0.25,
                life: 1.0,
                color_type,
            };
        }
    }

    pub fn maybe_spawn_capsule(&mut self, wx: f32, wy: f32, guaranteed: bool) {
        // Count active capsules so screen isn't flooded
        let mut active_caps = 0usize;
        let mut free_slot = None;
        for i in 0..MAX_CAPSULES {
            if self.capsules[i].active > 0.5 {
                active_caps += 1;
            } else if free_slot.is_none() {
                free_slot = Some(i);
            }
        }
        if active_caps >= 14 {
            return;
        }
        let slot = match free_slot {
            Some(s) => s,
            None => return,
        };

        let r = rand_f32(&mut self.rng_state);
        // If it's a yellow/gold trigger brick, 100% drop; otherwise dynamic drop probability
        // Higher drop rate when fewer balls are active so the player easily triggers the cascade!
        let drop_chance = if guaranteed {
            1.0
        } else if self.active_balls_count < 15 {
            0.095
        } else if self.active_balls_count < 80 {
            0.032
        } else {
            0.008
        };

        if r > drop_chance {
            return;
        }

        let kind_roll = rand_f32(&mut self.rng_state);
        let kind = if guaranteed {
            // Gold bricks in the chamber drop x3 or +3 just like in the X videos!
            if kind_roll < 0.62 {
                CAPSULE_MUL3
            } else if kind_roll < 0.90 {
                CAPSULE_ADD3
            } else {
                CAPSULE_STAR
            }
        } else if kind_roll < 0.34 {
            CAPSULE_MUL3
        } else if kind_roll < 0.64 {
            CAPSULE_ADD3
        } else if kind_roll < 0.78 {
            CAPSULE_EXPAND
        } else if kind_roll < 0.89 {
            CAPSULE_STAR
        } else {
            CAPSULE_SHRINK
        };

        self.capsules[slot] = Capsule {
            x: wx,
            y: wy,
            vy: -0.22 - rand_f32(&mut self.rng_state) * 0.06,
            kind: kind as f32,
            active: 1.0,
        };
    }

    pub fn apply_capsule(&mut self, kind: u8) {
        self.frame_powerup_collected = kind as u32;
        self.score = self.score.saturating_add(250);

        match kind {
            CAPSULE_MUL3 => {
                // Multiply every currently active ball by 3 (add 2 clones per active ball)
                let mut current_indices = [0usize; MAX_BALLS];
                let mut current_len = 0usize;
                for i in 0..MAX_BALLS {
                    if self.balls[i].active > 0.5 {
                        current_indices[current_len] = i;
                        current_len += 1;
                    }
                }
                let mut search_idx = 0usize;
                for k in 0..current_len {
                    let src = self.balls[current_indices[k]];
                    let base_angle = src.vy.atan2(src.vx);
                    let spd = (src.vx * src.vx + src.vy * src.vy).sqrt().max(self.ball_speed);

                    for clone_i in 0..2 {
                        while search_idx < MAX_BALLS && self.balls[search_idx].active > 0.5 {
                            search_idx += 1;
                        }
                        if search_idx >= MAX_BALLS {
                            break;
                        }
                        let offset = if clone_i == 0 { 0.24 } else { -0.24 };
                        let jitter = (rand_f32(&mut self.rng_state) - 0.5) * 0.08;
                        let new_angle = base_angle + offset + jitter;
                        self.balls[search_idx] = Ball {
                            x: src.x,
                            y: src.y,
                            vx: new_angle.cos() * spd,
                            vy: new_angle.sin() * spd,
                            active: 1.0,
                            color_id: ((search_idx % 6) as f32),
                        };
                        search_idx += 1;
                    }
                }
            }
            CAPSULE_ADD3 => {
                // Fire 3 fresh balls upward from the paddle
                let angles = [-0.28f32, 0.0, 0.28];
                let mut search_idx = 0usize;
                for &ang in &angles {
                    while search_idx < MAX_BALLS && self.balls[search_idx].active > 0.5 {
                        search_idx += 1;
                    }
                    if search_idx >= MAX_BALLS {
                        break;
                    }
                    let launch_ang = std::f32::consts::FRAC_PI_2 + ang + (rand_f32(&mut self.rng_state) - 0.5) * 0.05;
                    self.balls[search_idx] = Ball {
                        x: self.paddle_x,
                        y: self.paddle_y + self.paddle_h * 0.6 + self.ball_radius,
                        vx: launch_ang.cos() * self.ball_speed,
                        vy: launch_ang.sin() * self.ball_speed,
                        active: 1.0,
                        color_id: ((search_idx % 6) as f32),
                    };
                    search_idx += 1;
                }
            }
            CAPSULE_EXPAND => {
                self.paddle_w = (self.paddle_w + 0.055).min(0.38);
            }
            CAPSULE_SHRINK => {
                self.paddle_w = (self.paddle_w - 0.04).max(0.09);
            }
            CAPSULE_STAR => {
                // 12 seconds of bottom safety laser floor!
                self.safety_floor_timer = (self.safety_floor_timer + 12.0).min(25.0);
            }
            _ => {}
        }
    }

    pub fn step(&mut self, dt_sec: f32) {
        self.frame_brick_hits = 0;
        self.frame_wall_hits = 0;
        self.frame_paddle_hits = 0;
        self.frame_powerup_collected = 0;

        let clamped_dt = dt_sec.clamp(0.001, 0.035);

        // Update particles even when waiting/won
        for i in 0..MAX_PARTICLES {
            if self.particles[i].life > 0.0 {
                self.particles[i].x += self.particles[i].vx * clamped_dt;
                self.particles[i].y += self.particles[i].vy * clamped_dt;
                self.particles[i].z += self.particles[i].vz * clamped_dt;
                self.particles[i].vz -= 0.95 * clamped_dt;
                self.particles[i].life -= clamped_dt * 2.2;
            }
        }

        if self.status == STATUS_READY {
            // Keep starter ball attached to paddle
            self.balls[0].x = self.paddle_x;
            self.balls[0].y = self.paddle_y + self.paddle_h * 0.5 + self.ball_radius + 0.004;
            self.balls[0].active = 1.0;
            self.active_balls_count = 1;
            return;
        }

        if self.status != STATUS_PLAYING {
            return;
        }

        self.elapsed_ms += clamped_dt * 1000.0;
        if self.safety_floor_timer > 0.0 {
            self.safety_floor_timer = (self.safety_floor_timer - clamped_dt).max(0.0);
        }

        // Update falling power-up capsules
        let pad_left = self.paddle_x - self.paddle_w * 0.5 - 0.015;
        let pad_right = self.paddle_x + self.paddle_w * 0.5 + 0.015;
        let pad_top = self.paddle_y + self.paddle_h * 0.5 + 0.015;
        let pad_bottom = self.paddle_y - self.paddle_h * 0.5 - 0.015;

        for i in 0..MAX_CAPSULES {
            if self.capsules[i].active > 0.5 {
                self.capsules[i].y += self.capsules[i].vy * clamped_dt;
                let cx = self.capsules[i].x;
                let cy = self.capsules[i].y;

                if cx >= pad_left && cx <= pad_right && cy >= pad_bottom && cy <= pad_top {
                    let kind = self.capsules[i].kind as u8;
                    self.capsules[i].active = 0.0;
                    self.apply_capsule(kind);
                } else if cy < -0.05 {
                    self.capsules[i].active = 0.0;
                }
            }
        }

        let cell_w = (VAULT_RIGHT - VAULT_LEFT) / (self.grid_w as f32);
        let cell_h = (VAULT_TOP - VAULT_BOTTOM) / (self.grid_h as f32);
        let max_step_dist = cell_w.min(cell_h) * 0.42;

        let mut active_count = 0u32;

        for b_idx in 0..MAX_BALLS {
            if self.balls[b_idx].active < 0.5 {
                continue;
            }

            let mut bx = self.balls[b_idx].x;
            let mut by = self.balls[b_idx].y;
            let mut bvx = self.balls[b_idx].vx;
            let mut bvy = self.balls[b_idx].vy;

            let total_dist = ((bvx * clamped_dt).powi(2) + (bvy * clamped_dt).powi(2)).sqrt();
            let substeps = ((total_dist / max_step_dist).ceil() as usize).clamp(1, 8);
            let sub_dt = clamped_dt / (substeps as f32);

            let mut ball_alive = true;

            for _ in 0..substeps {
                let prev_x = bx;
                let prev_y = by;
                bx += bvx * sub_dt;
                by += bvy * sub_dt;

                // Outer arena walls
                if bx - self.ball_radius < 0.01 {
                    bx = 0.01 + self.ball_radius;
                    bvx = bvx.abs();
                    self.frame_wall_hits += 1;
                } else if bx + self.ball_radius > WORLD_W - 0.01 {
                    bx = WORLD_W - 0.01 - self.ball_radius;
                    bvx = -bvx.abs();
                    self.frame_wall_hits += 1;
                }

                if by + self.ball_radius > WORLD_H - 0.01 {
                    by = WORLD_H - 0.01 - self.ball_radius;
                    bvy = -bvy.abs();
                    self.frame_wall_hits += 1;
                }

                // Safety floor barrier (from Gold Star ★ capsule)
                if self.safety_floor_timer > 0.0 && by - self.ball_radius < 0.025 && bvy < 0.0 {
                    by = 0.025 + self.ball_radius;
                    bvy = bvy.abs();
                    self.frame_wall_hits += 1;
                }

                // Bottom out of bounds
                if by < -0.02 {
                    ball_alive = false;
                    break;
                }

                // Paddle collision
                if bvy < 0.0
                    && by - self.ball_radius <= self.paddle_y + self.paddle_h * 0.5
                    && prev_y - self.ball_radius >= self.paddle_y - self.paddle_h * 0.65
                {
                    let half_w = self.paddle_w * 0.5 + self.ball_radius;
                    if (bx - self.paddle_x).abs() <= half_w {
                        by = self.paddle_y + self.paddle_h * 0.5 + self.ball_radius;
                        let rel = ((bx - self.paddle_x) / half_w).clamp(-0.92, 0.92);
                        // Bounce angle: 0 is straight up
                        let bounce_angle = rel * 1.12; // up to ~64 degrees
                        let spd = (bvx * bvx + bvy * bvy).sqrt().max(self.ball_speed);
                        bvx = bounce_angle.sin() * spd;
                        bvy = bounce_angle.cos() * spd;
                        self.frame_paddle_hits += 1;
                        self.combo = 0;
                    }
                }

                // Micro-tile vault collision check
                if bx + self.ball_radius >= VAULT_LEFT
                    && bx - self.ball_radius <= VAULT_RIGHT
                    && by + self.ball_radius >= VAULT_BOTTOM
                    && by - self.ball_radius <= VAULT_TOP
                {
                    let min_col = (((bx - self.ball_radius - VAULT_LEFT) / cell_w).floor() as isize)
                        .clamp(0, (self.grid_w as isize) - 1) as usize;
                    let max_col = (((bx + self.ball_radius - VAULT_LEFT) / cell_w).floor() as isize)
                        .clamp(0, (self.grid_w as isize) - 1) as usize;
                    // Row 0 is bottom of vault, row grid_h-1 is top of vault
                    let min_row = (((by - self.ball_radius - VAULT_BOTTOM) / cell_h).floor() as isize)
                        .clamp(0, (self.grid_h as isize) - 1) as usize;
                    let max_row = (((by + self.ball_radius - VAULT_BOTTOM) / cell_h).floor() as isize)
                        .clamp(0, (self.grid_h as isize) - 1) as usize;

                    'cell_scan: for row in min_row..=max_row {
                        for col in min_col..=max_col {
                            let idx = row * self.grid_w + col;
                            let tile = self.tiles[idx];
                            if tile == TILE_EMPTY {
                                continue;
                            }

                            let tile_cx = VAULT_LEFT + (col as f32 + 0.5) * cell_w;
                            let tile_cy = VAULT_BOTTOM + (row as f32 + 0.5) * cell_h;

                            let dx = prev_x - tile_cx;
                            let dy = prev_y - tile_cy;

                            // Determine primary reflection axis
                            if (dx / cell_w).abs() > (dy / cell_h).abs() {
                                bvx = -bvx;
                                // Nudge out
                                if dx > 0.0 {
                                    bx = tile_cx + cell_w * 0.5 + self.ball_radius * 0.6;
                                } else {
                                    bx = tile_cx - cell_w * 0.5 - self.ball_radius * 0.6;
                                }
                            } else {
                                bvy = -bvy;
                                if dy > 0.0 {
                                    by = tile_cy + cell_h * 0.5 + self.ball_radius * 0.6;
                                } else {
                                    by = tile_cy - cell_h * 0.5 - self.ball_radius * 0.6;
                                }
                            }

                            // Prevent purely horizontal trapping by ensuring minimum vertical velocity
                            if bvy.abs() < 0.045 {
                                bvy = if bvy >= 0.0 { 0.055 } else { -0.055 };
                            }

                            if tile == TILE_WALL_STEEL {
                                self.frame_wall_hits += 1;
                            } else if tile == TILE_BRICK_ARMORED {
                                self.tiles[idx] = TILE_BRICK_PRIMARY;
                                self.frame_brick_hits += 1;
                                self.score = self.score.saturating_add(5);
                            } else {
                                let was_gold = tile == TILE_BRICK_GOLD;
                                self.tiles[idx] = TILE_EMPTY;
                                self.remaining_bricks = self.remaining_bricks.saturating_sub(1);
                                self.destroyed_bricks_total = self.destroyed_bricks_total.saturating_add(1);
                                self.frame_brick_hits += 1;
                                self.combo = self.combo.saturating_add(1);
                                self.last_hit_row_norm = (row as f32) / (self.grid_h as f32);

                                let pts = if was_gold {
                                    50
                                } else if tile == TILE_BRICK_CYAN {
                                    25
                                } else {
                                    10 + (self.combo.min(50) / 5)
                                };
                                self.score = self.score.saturating_add(pts);

                                self.spawn_shatter(tile_cx, tile_cy, tile as f32);
                                self.maybe_spawn_capsule(tile_cx, tile_cy, was_gold);
                            }

                            break 'cell_scan;
                        }
                    }
                }
            }

            if ball_alive {
                self.balls[b_idx].x = bx;
                self.balls[b_idx].y = by;
                self.balls[b_idx].vx = bvx;
                self.balls[b_idx].vy = bvy;
                active_count += 1;
            } else {
                self.balls[b_idx].active = 0.0;
            }
        }

        self.active_balls_count = active_count;
        if active_count > self.peak_balls_count {
            self.peak_balls_count = active_count;
        }

        if self.remaining_bricks == 0 {
            self.status = STATUS_WON;
            // Time bonus
            let secs = (self.elapsed_ms / 1000.0).max(1.0);
            let time_bonus = ((180.0 / secs) * 1000.0) as u32;
            self.score = self.score.saturating_add(time_bonus);
        } else if active_count == 0 {
            self.status = STATUS_LOST;
        }
    }
}

// ============================================================================
// WebAssembly C-ABI Exports for Zero-Copy JavaScript / Three.js Integration
// ============================================================================

#[no_mangle]
pub extern "C" fn init_engine(grid_w: usize, grid_h: usize, seed: u32) {
    unsafe {
        STATE.reset(grid_w, grid_h, seed);
    }
}

#[no_mangle]
pub extern "C" fn build_preset_level(level_id: u32, grid_w: usize, grid_h: usize, seed: u32) {
    unsafe {
        STATE.reset(grid_w, grid_h, seed);
        let w = STATE.grid_w;
        let h = STATE.grid_h;

        // Helper closure to set tile at (col, row) where row=0 is bottom, row=h-1 is top
        let set_tile = |tiles: &mut [u8; MAX_CELLS], c: usize, r: usize, val: u8| {
            if c < w && r < h {
                tiles[r * w + c] = val;
            }
        };

        // 1. Fill interior with primary breakable micro-tiles and outer 1-tile perimeter with steel armor
        for r in 0..h {
            for c in 0..w {
                if r == 0 || r == h - 1 || c == 0 || c == w - 1 {
                    set_tile(&mut STATE.tiles, c, r, TILE_WALL_STEEL);
                } else {
                    set_tile(&mut STATE.tiles, c, r, TILE_BRICK_PRIMARY);
                }
            }
        }

        match level_id {
            // LEVEL 0: Viral Post #1 ("The Diagonal Chimney" - https://x.com/iwhale/status/2111454912072806784)
            // Vertical shaft on the right (x ~ 76%), diagonal chute going down-left to a gold-lined inner chamber!
            0 => {
                let shaft_c = (w as f32 * 0.76) as usize;
                let tunnel_w = 2usize; // 2-tile wide ball breach

                // Bottom opening in the steel border
                for c in shaft_c..(shaft_c + tunnel_w) {
                    set_tile(&mut STATE.tiles, c, 0, TILE_EMPTY);
                }

                let peak_r = (h as f32 * 0.82) as usize;
                // Carve vertical right shaft with steel armor walls
                for r in 0..=peak_r {
                    for c in shaft_c..(shaft_c + tunnel_w) {
                        set_tile(&mut STATE.tiles, c, r, TILE_EMPTY);
                    }
                    // Left & right steel walls of the vertical shaft
                    if r < peak_r - 2 {
                        set_tile(&mut STATE.tiles, shaft_c - 1, r, TILE_WALL_STEEL);
                    }
                    set_tile(&mut STATE.tiles, shaft_c + tunnel_w, r, TILE_WALL_STEEL);
                }

                // Carve diagonal chute going down-left from (shaft_c, peak_r) to chamber
                let steps = (w as f32 * 0.38) as usize;
                let mut end_c = shaft_c;
                let mut end_r = peak_r;
                for s in 0..steps {
                    let c = shaft_c.saturating_sub(s);
                    let r = peak_r.saturating_sub(s);
                    end_c = c;
                    end_r = r;
                    for tc in c..(c + tunnel_w + 1) {
                        for tr in r.saturating_sub(1)..=(r + 1) {
                            set_tile(&mut STATE.tiles, tc, tr, TILE_EMPTY);
                        }
                    }
                    // Upper & lower steel armor along the diagonal chute
                    if r + 2 < h - 1 {
                        set_tile(&mut STATE.tiles, c, r + 2, TILE_WALL_STEEL);
                    }
                    if r >= 2 && s > 2 && s < steps - 3 {
                        set_tile(&mut STATE.tiles, c + 1, r - 2, TILE_WALL_STEEL);
                    }
                }

                // Inner horizontal chamber at the bottom of the diagonal chute with Yellow/Gold trigger tiles on left & right!
                let ch_left = end_c.saturating_sub(5);
                let ch_right = (end_c + 5).min(w - 4);
                let ch_bottom = end_r.saturating_sub(3);
                let ch_top = end_r + 1;

                for r in ch_bottom..=ch_top {
                    for c in ch_left..=ch_right {
                        set_tile(&mut STATE.tiles, c, r, TILE_EMPTY);
                    }
                }
                // Steel floor and ceiling of the inner chamber
                for c in (ch_left - 1)..=(ch_right + 1) {
                    set_tile(&mut STATE.tiles, c, ch_bottom - 1, TILE_WALL_STEEL);
                    if c < end_c - 1 || c > end_c + 2 {
                        set_tile(&mut STATE.tiles, c, ch_top + 1, TILE_WALL_STEEL);
                    }
                }
                // Gold trigger bricks on the left & right walls of the chamber (just like the video!)
                for r in ch_bottom..=ch_top {
                    set_tile(&mut STATE.tiles, ch_left, r, TILE_BRICK_GOLD);
                    set_tile(&mut STATE.tiles, ch_left + 1, r, TILE_BRICK_GOLD);
                    set_tile(&mut STATE.tiles, ch_right, r, TILE_BRICK_GOLD);
                    set_tile(&mut STATE.tiles, ch_right - 1, r, TILE_BRICK_GOLD);
                }
            }

            // LEVEL 1: Viral Post #2 ("The Center Bent Pipe" - https://x.com/iwhale/status/2110821987052634247)
            // Center vertical pipe going up 32%, then bending 45 degrees up-left to 3 gold trigger blocks!
            1 => {
                let mid_c = w / 2;
                let tunnel_w = 3usize;
                let knee_r = (h as f32 * 0.30) as usize;

                // Bottom opening
                for c in (mid_c - 1)..(mid_c - 1 + tunnel_w) {
                    set_tile(&mut STATE.tiles, c, 0, TILE_EMPTY);
                }

                // Vertical stem
                for r in 0..=knee_r {
                    for c in (mid_c - 1)..(mid_c - 1 + tunnel_w) {
                        set_tile(&mut STATE.tiles, c, r, TILE_EMPTY);
                    }
                    set_tile(&mut STATE.tiles, mid_c - 2, r, TILE_WALL_STEEL);
                    set_tile(&mut STATE.tiles, mid_c - 1 + tunnel_w, r, TILE_WALL_STEEL);
                }

                // 45-degree bend up-left
                let diag_len = (h as f32 * 0.18) as usize;
                let mut tip_c = mid_c - 1;
                let mut tip_r = knee_r;
                for s in 0..=diag_len {
                    let c = (mid_c - 1).saturating_sub(s);
                    let r = knee_r + s;
                    tip_c = c;
                    tip_r = r;
                    for tc in c..(c + tunnel_w) {
                        for tr in r.saturating_sub(1)..=(r + 1) {
                            set_tile(&mut STATE.tiles, tc, tr, TILE_EMPTY);
                        }
                    }
                    // Armor along the bend
                    if s < diag_len - 1 {
                        set_tile(&mut STATE.tiles, c.saturating_sub(1), r.saturating_sub(1), TILE_WALL_STEEL);
                        set_tile(&mut STATE.tiles, c + tunnel_w, r + 1, TILE_WALL_STEEL);
                    }
                }

                // Gold trigger cluster at the tip of the bent pipe (breaks open into the entire orange vault!)
                for r in tip_r..(tip_r + 3) {
                    for c in (tip_c.saturating_sub(2))..(tip_c + 2) {
                        set_tile(&mut STATE.tiles, c, r, TILE_BRICK_GOLD);
                    }
                }
            }

            // LEVEL 2: "Twin Helix Reactor" (Dual symmetrical chimneys leading to a central core of gold & cyan bricks)
            2 => {
                let left_c = (w as f32 * 0.24) as usize;
                let right_c = (w as f32 * 0.74) as usize;
                let mid_c = w / 2;
                let mid_r = h / 2;

                // Carve central diamond core with gold & cyan rings
                for r in 4..(h - 4) {
                    for c in 4..(w - 4) {
                        let dist = ((c as isize - mid_c as isize).abs() + (r as isize - mid_r as isize).abs()) as usize;
                        if dist < 4 {
                            set_tile(&mut STATE.tiles, c, r, TILE_EMPTY);
                        } else if dist < 6 {
                            set_tile(&mut STATE.tiles, c, r, TILE_BRICK_GOLD);
                        } else if dist < 9 {
                            set_tile(&mut STATE.tiles, c, r, TILE_BRICK_CYAN);
                        }
                    }
                }

                // Left & right vertical shafts up to mid_r, then horizontal bridges toward the core
                for &sc in &[left_c, right_c] {
                    set_tile(&mut STATE.tiles, sc, 0, TILE_EMPTY);
                    set_tile(&mut STATE.tiles, sc + 1, 0, TILE_EMPTY);
                    for r in 0..=mid_r {
                        set_tile(&mut STATE.tiles, sc, r, TILE_EMPTY);
                        set_tile(&mut STATE.tiles, sc + 1, r, TILE_EMPTY);
                        set_tile(&mut STATE.tiles, sc - 1, r, TILE_WALL_STEEL);
                        set_tile(&mut STATE.tiles, sc + 2, r, TILE_WALL_STEEL);
                    }
                }
                for c in (left_c + 1)..=(mid_c - 5) {
                    set_tile(&mut STATE.tiles, c, mid_r, TILE_EMPTY);
                    set_tile(&mut STATE.tiles, c, mid_r - 1, TILE_EMPTY);
                }
                for c in (mid_c + 5)..=right_c {
                    set_tile(&mut STATE.tiles, c, mid_r, TILE_EMPTY);
                    set_tile(&mut STATE.tiles, c, mid_r - 1, TILE_EMPTY);
                }
            }

            // LEVEL 3: "Seolith Citadel" (Labyrinthine zig-zag chimney with multi-layered gold vaults)
            _ => {
                let mid_c = w / 2;
                for c in (mid_c - 1)..=(mid_c + 1) {
                    set_tile(&mut STATE.tiles, c, 0, TILE_EMPTY);
                }
                for r in 1..(h - 2) {
                    for c in 1..(w - 1) {
                        if (r + c) % 13 == 0 {
                            set_tile(&mut STATE.tiles, c, r, TILE_BRICK_GOLD);
                        } else if r % 9 == 0 {
                            set_tile(&mut STATE.tiles, c, r, TILE_BRICK_CYAN);
                        }
                    }
                }
                // Central chimney going up to 70% height
                let top_r = (h as f32 * 0.72) as usize;
                for r in 0..=top_r {
                    for c in (mid_c - 1)..=(mid_c + 1) {
                        set_tile(&mut STATE.tiles, c, r, TILE_EMPTY);
                    }
                    if r < top_r - 3 {
                        set_tile(&mut STATE.tiles, mid_c - 2, r, TILE_WALL_STEEL);
                        set_tile(&mut STATE.tiles, mid_c + 2, r, TILE_WALL_STEEL);
                    }
                }
                // Gold cap at the top of the shaft
                for c in (mid_c - 3)..=(mid_c + 3) {
                    set_tile(&mut STATE.tiles, c, top_r + 1, TILE_BRICK_GOLD);
                    set_tile(&mut STATE.tiles, c, top_r + 2, TILE_BRICK_GOLD);
                }
            }
        }

        STATE.recount_bricks();
    }
}

#[no_mangle]
pub extern "C" fn set_paddle_x(x: f32) {
    unsafe {
        let half_w = STATE.paddle_w * 0.5;
        STATE.paddle_x = x.clamp(0.02 + half_w, WORLD_W - 0.02 - half_w);
        if STATE.status == STATUS_READY {
            STATE.balls[0].x = STATE.paddle_x;
        }
    }
}

#[no_mangle]
pub extern "C" fn set_aim_angle(angle_rad: f32) {
    unsafe {
        STATE.aim_angle = angle_rad.clamp(-1.15, 1.15);
    }
}

#[no_mangle]
pub extern "C" fn launch_ball() {
    unsafe {
        if STATE.status == STATUS_READY {
            STATE.status = STATUS_PLAYING;
            let ang = STATE.aim_angle; // 0 = straight up (+Y)
            STATE.balls[0].vx = ang.sin() * STATE.ball_speed;
            STATE.balls[0].vy = ang.cos() * STATE.ball_speed;
            STATE.balls[0].active = 1.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn trigger_bonus_capsule(kind: u8) {
    unsafe {
        if STATE.status == STATUS_PLAYING {
            STATE.apply_capsule(kind);
        }
    }
}

#[no_mangle]
pub extern "C" fn set_custom_tile(col: usize, row: usize, val: u8) {
    unsafe {
        if col < STATE.grid_w && row < STATE.grid_h {
            STATE.tiles[row * STATE.grid_w + col] = val;
            STATE.recount_bricks();
        }
    }
}

#[no_mangle]
pub extern "C" fn step_physics(dt_sec: f32) {
    unsafe {
        STATE.step(dt_sec);
    }
}

// Pointers & state getters for zero-copy TypedArray views in JS
#[no_mangle]
pub extern "C" fn get_tiles_ptr() -> *mut u8 {
    unsafe { STATE.tiles.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_balls_ptr() -> *mut Ball {
    unsafe { STATE.balls.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_capsules_ptr() -> *mut Capsule {
    unsafe { STATE.capsules.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_particles_ptr() -> *mut Particle {
    unsafe { STATE.particles.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_grid_w() -> usize {
    unsafe { STATE.grid_w }
}

#[no_mangle]
pub extern "C" fn get_grid_h() -> usize {
    unsafe { STATE.grid_h }
}

#[no_mangle]
pub extern "C" fn get_max_balls() -> usize {
    MAX_BALLS
}

#[no_mangle]
pub extern "C" fn get_max_capsules() -> usize {
    MAX_CAPSULES
}

#[no_mangle]
pub extern "C" fn get_max_particles() -> usize {
    MAX_PARTICLES
}

#[no_mangle]
pub extern "C" fn get_active_balls_count() -> u32 {
    unsafe { STATE.active_balls_count }
}

#[no_mangle]
pub extern "C" fn get_peak_balls_count() -> u32 {
    unsafe { STATE.peak_balls_count }
}

#[no_mangle]
pub extern "C" fn get_remaining_bricks() -> u32 {
    unsafe { STATE.remaining_bricks }
}

#[no_mangle]
pub extern "C" fn get_initial_bricks() -> u32 {
    unsafe { STATE.initial_bricks }
}

#[no_mangle]
pub extern "C" fn get_score() -> u32 {
    unsafe { STATE.score }
}

#[no_mangle]
pub extern "C" fn get_elapsed_ms() -> f32 {
    unsafe { STATE.elapsed_ms }
}

#[no_mangle]
pub extern "C" fn get_status() -> u32 {
    unsafe { STATE.status }
}

#[no_mangle]
pub extern "C" fn get_paddle_x() -> f32 {
    unsafe { STATE.paddle_x }
}

#[no_mangle]
pub extern "C" fn get_paddle_y() -> f32 {
    unsafe { STATE.paddle_y }
}

#[no_mangle]
pub extern "C" fn get_paddle_w() -> f32 {
    unsafe { STATE.paddle_w }
}

#[no_mangle]
pub extern "C" fn get_paddle_h() -> f32 {
    unsafe { STATE.paddle_h }
}

#[no_mangle]
pub extern "C" fn get_safety_floor_timer() -> f32 {
    unsafe { STATE.safety_floor_timer }
}

#[no_mangle]
pub extern "C" fn get_frame_brick_hits() -> u32 {
    unsafe { STATE.frame_brick_hits }
}

#[no_mangle]
pub extern "C" fn get_frame_wall_hits() -> u32 {
    unsafe { STATE.frame_wall_hits }
}

#[no_mangle]
pub extern "C" fn get_frame_paddle_hits() -> u32 {
    unsafe { STATE.frame_paddle_hits }
}

#[no_mangle]
pub extern "C" fn get_frame_powerup_collected() -> u32 {
    unsafe { STATE.frame_powerup_collected }
}

#[no_mangle]
pub extern "C" fn get_last_hit_row_norm() -> f32 {
    unsafe { STATE.last_hit_row_norm }
}

// Save/Restore state helpers for LocalStorage resume
#[no_mangle]
pub extern "C" fn restore_snapshot(
    status: u32,
    score: u32,
    elapsed_ms: f32,
    paddle_x: f32,
    paddle_w: f32,
    safety_floor_timer: f32,
    active_balls: u32,
    peak_balls: u32,
) {
    unsafe {
        STATE.status = status;
        STATE.score = score;
        STATE.elapsed_ms = elapsed_ms;
        STATE.paddle_x = paddle_x;
        STATE.paddle_w = paddle_w;
        STATE.safety_floor_timer = safety_floor_timer;
        STATE.active_balls_count = active_balls;
        STATE.peak_balls_count = peak_balls;
        STATE.recount_bricks();
    }
}

// Compute a deterministic anti-cheat verification hash over score, clear_ms, and peak_balls
#[no_mangle]
pub extern "C" fn compute_run_proof(level_id: u32, score: u32, elapsed_ms: u32, peak_balls: u32) -> u32 {
    let mut h: u32 = 0x811C_9DC5;
    let data = [
        level_id ^ 0x5E01_1740,
        score.wrapping_mul(31),
        elapsed_ms.wrapping_mul(17),
        peak_balls.wrapping_mul(131),
        0xCAFE_BABE,
    ];
    for &word in &data {
        h ^= word & 0xFF;
        h = h.wrapping_mul(0x0100_0193);
        h ^= (word >> 8) & 0xFF;
        h = h.wrapping_mul(0x0100_0193);
        h ^= (word >> 16) & 0xFF;
        h = h.wrapping_mul(0x0100_0193);
        h ^= (word >> 24) & 0xFF;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}
