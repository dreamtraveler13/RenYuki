-- RenYuki PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  coins integer NOT NULL DEFAULT 0,
  policy_strikes integer NOT NULL DEFAULT 0,
  banned_at timestamptz,
  ban_reason text,
  policy_accepted_at timestamptz,
  policy_version integer,
  policy_accepted_ip text,
  policy_accepted_ua text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS device_fingerprints (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_json jsonb NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  error text,
  coin_cost integer NOT NULL DEFAULT 0,
  refunded_at timestamptz,
  result_save_id bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  out_trade_no text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  pay_type text NOT NULL,
  pack_id text NOT NULL,
  amount text NOT NULL,
  coins integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  credited_at timestamptz,
  trade_no text,
  raw_notify jsonb
);

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  images_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS plaza_roles (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  uploader_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  images_json jsonb NOT NULL,
  cover_base64 text
);

CREATE TABLE IF NOT EXISTS saves (
  id bigint PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  date text NOT NULL,
  heroine_name text NOT NULL,
  affinity integer NOT NULL DEFAULT 0,
  current_node_id text NOT NULL,
  script_json jsonb NOT NULL,
  assets_json jsonb NOT NULL,
  user_profile_json jsonb NOT NULL,
  memory_cover_base64 text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS plaza_games (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  uploader_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  date text NOT NULL,
  heroine_name text NOT NULL,
  affinity integer NOT NULL DEFAULT 0,
  cover_base64 text,
  plays integer NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 0,
  last_reported_at timestamptz,
  save_path text,
  save_json jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS plaza_game_reports (
  id uuid PRIMARY KEY,
  plaza_game_id uuid NOT NULL REFERENCES plaza_games(id) ON DELETE CASCADE,
  reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_fingerprint_hash ON device_fingerprints(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_user_id ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_id ON generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_plaza_roles_created_at ON plaza_roles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saves_user_id ON saves(user_id);
CREATE INDEX IF NOT EXISTS idx_plaza_games_created_at ON plaza_games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaza_game_reports_game_id ON plaza_game_reports(plaza_game_id);
