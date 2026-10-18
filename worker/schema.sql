-- worker/schema.sql
-- Cloudflare D1 Schema for Seolith Tiles Time & Geo-Location Leaderboards

CREATE TABLE IF NOT EXISTS leaderboard_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  level_id INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  peak_balls INTEGER NOT NULL DEFAULT 1,
  proof INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  city TEXT NOT NULL DEFAULT '',
  day_key TEXT NOT NULL,     -- YYYY-MM-DD
  week_key TEXT NOT NULL,    -- YYYY-Www
  month_key TEXT NOT NULL,   -- YYYY-MM
  year_key TEXT NOT NULL,    -- YYYY
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lb_daily_time ON leaderboard_runs(level_id, day_key, elapsed_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_weekly_time ON leaderboard_runs(level_id, week_key, elapsed_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_monthly_time ON leaderboard_runs(level_id, month_key, elapsed_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_yearly_time ON leaderboard_runs(level_id, year_key, elapsed_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_country ON leaderboard_runs(level_id, country, elapsed_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lb_region ON leaderboard_runs(level_id, country, region, elapsed_ms ASC);

-- Seed initial benchmark toppers inspired by the viral X posts
INSERT INTO leaderboard_runs (
  player_name, level_id, score, elapsed_ms, peak_balls, proof,
  country, region, city, day_key, week_key, month_key, year_key, created_at
) VALUES
  ('iwhale_vault', 0, 68420, 42800, 980, 1001, 'TH', 'Bangkok', 'Bangkok', strftime('%Y-%m-%d','now'), strftime('%Y-W%W','now'), strftime('%Y-%m','now'), strftime('%Y','now'), datetime('now')),
  ('Hiroku1122', 0, 64150, 48200, 810, 1002, 'JP', 'Tokyo', 'Tokyo', strftime('%Y-%m-%d','now'), strftime('%Y-W%W','now'), strftime('%Y-%m','now'), strftime('%Y','now'), datetime('now')),
  ('SeolithPro', 0, 61900, 51400, 729, 1003, 'US', 'California', 'San Francisco', strftime('%Y-%m-%d','now'), strftime('%Y-W%W','now'), strftime('%Y-%m','now'), strftime('%Y','now'), datetime('now')),
  ('VarrelDept', 1, 59400, 39200, 650, 1004, 'US', 'New York', 'New York', strftime('%Y-%m-%d','now'), strftime('%Y-W%W','now'), strftime('%Y-%m','now'), strftime('%Y','now'), datetime('now'));
