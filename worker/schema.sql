-- worker/schema.sql
-- Cloudflare D1 Schema for Seolith Tiles:
-- 1. Time & Geo-Location Leaderboards (leaderboard_runs)
-- 2. Tester Feedback & Bug Triage (tester_feedback)
-- 3. Visitor Geo-Analytics & Telemetry (visitor_events)

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

CREATE TABLE IF NOT EXISTS tester_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tester_name TEXT NOT NULL DEFAULT 'Anonymous',
  category TEXT NOT NULL DEFAULT 'bug',
  severity TEXT NOT NULL DEFAULT 'normal',
  version TEXT NOT NULL DEFAULT '1.2.0',
  level_id INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  device_info TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON tester_feedback(status, created_at DESC);

CREATE TABLE IF NOT EXISTS visitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anon',
  event_type TEXT NOT NULL DEFAULT 'pageview', -- 'pageview' | 'play_start' | 'win' | 'share' | 'pro_click'
  level_id INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  city TEXT NOT NULL DEFAULT '',
  continent TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  colo TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  ref_tag TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'desktop',
  user_agent TEXT NOT NULL DEFAULT '',
  day_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_day ON visitor_events(day_key, event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_country ON visitor_events(country, region, city);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON visitor_events(created_at DESC);

CREATE TABLE IF NOT EXISTS monetization_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anon',
  customer_email TEXT NOT NULL DEFAULT '',
  plan_type TEXT NOT NULL DEFAULT 'pro_pass',
  amount_cents INTEGER NOT NULL DEFAULT 299,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed',
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON monetization_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS daily_challenge_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL,
  seed INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Player',
  score INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  peak_balls INTEGER NOT NULL DEFAULT 1,
  beat_target INTEGER NOT NULL DEFAULT 0,
  aim_deg REAL NOT NULL DEFAULT 0,
  boosts_used INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  city TEXT NOT NULL DEFAULT '',
  proof INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_runs_day ON daily_challenge_runs(day_key, elapsed_ms ASC, score DESC);

CREATE TABLE IF NOT EXISTS daily_challenge_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL,
  seed INTEGER NOT NULL,
  tester_name TEXT NOT NULL DEFAULT 'Tester',
  verdict TEXT NOT NULL DEFAULT 'approved',
  difficulty_rating INTEGER NOT NULL DEFAULT 5,
  fun_rating INTEGER NOT NULL DEFAULT 5,
  comment TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'GL',
  region TEXT NOT NULL DEFAULT 'Global',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_approvals_day ON daily_challenge_approvals(day_key, created_at DESC);


