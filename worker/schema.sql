-- worker/schema.sql
-- Cloudflare D1 Schema for Seolith Tiles Time & Geo-Location Leaderboards + Tester Feedback Collector

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

-- Tester Feedback & Bug Report Table (Readable by the AI Agent & Developers via /api/feedback)
CREATE TABLE IF NOT EXISTS tester_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tester_name TEXT NOT NULL DEFAULT 'Anonymous',
  category TEXT NOT NULL DEFAULT 'bug', -- 'bug' | 'improvement' | 'physics' | 'design' | 'monetization'
  severity TEXT NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'critical'
  version TEXT NOT NULL DEFAULT '1.1.0',
  level_id INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  device_info TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'triaged' | 'resolved'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON tester_feedback(status, created_at DESC);
