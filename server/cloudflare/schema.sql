CREATE TABLE IF NOT EXISTS ai_calls (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    month TEXT NOT NULL,
    created INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('started', 'finished', 'uncertain'))
);

CREATE INDEX IF NOT EXISTS ai_calls_day ON ai_calls(day);
CREATE INDEX IF NOT EXISTS ai_calls_recent ON ai_calls(created DESC);

CREATE TABLE IF NOT EXISTS gateway_owner (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    token_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_calls_v12 (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    month TEXT NOT NULL,
    created INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('started', 'finished', 'uncertain')),
    model TEXT NOT NULL,
    neurons INTEGER NOT NULL CHECK(neurons >= 1)
);
CREATE INDEX IF NOT EXISTS ai_calls_v12_day ON ai_calls_v12(day);
CREATE INDEX IF NOT EXISTS ai_calls_v12_recent ON ai_calls_v12(created DESC);

CREATE TABLE IF NOT EXISTS request_recovery (
    id TEXT PRIMARY KEY NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('processing','finished','failed','unknown')),
    started INTEGER NOT NULL,
    ended INTEGER,
    code TEXT,
    provider_code TEXT,
    sealed_reply TEXT,
    expires INTEGER
);
CREATE INDEX IF NOT EXISTS recovery_expiry ON request_recovery(expires) WHERE sealed_reply IS NOT NULL;

CREATE TABLE IF NOT EXISTS tracking_settings (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS tracked_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pending TEXT NOT NULL,
  due INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1))
);
CREATE INDEX IF NOT EXISTS projects_due ON tracked_projects(active,due);
CREATE TABLE IF NOT EXISTS initiative_events (
  project_id TEXT PRIMARY KEY REFERENCES tracked_projects(id) ON DELETE CASCADE,
  occurred INTEGER NOT NULL,
  due INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','read','dismissed'))
);
CREATE INDEX IF NOT EXISTS initiatives_recent ON initiative_events(occurred DESC);
