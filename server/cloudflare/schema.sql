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

CREATE TABLE IF NOT EXISTS research_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_audit_v14 (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_details_v14 (
  project_id TEXT PRIMARY KEY REFERENCES tracked_projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  frequency_days INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recurring_reviews_v14 (
  project_id TEXT NOT NULL REFERENCES tracked_projects(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  occurred INTEGER NOT NULL,
  due INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  PRIMARY KEY(project_id,slot)
);
CREATE INDEX IF NOT EXISTS recurring_recent_v14 ON recurring_reviews_v14(occurred DESC);
CREATE TRIGGER IF NOT EXISTS pause_project_details_insert_v14
AFTER INSERT ON project_details_v14 WHEN NEW.status != 'active'
BEGIN UPDATE tracked_projects SET active=0 WHERE id=NEW.project_id; END;
CREATE TRIGGER IF NOT EXISTS pause_project_details_update_v14
AFTER UPDATE OF status ON project_details_v14 WHEN NEW.status != 'active'
BEGIN UPDATE tracked_projects SET active=0 WHERE id=NEW.project_id; END;

CREATE TABLE IF NOT EXISTS project_analysis_permission_v15 (
  project_id TEXT PRIMARY KEY REFERENCES tracked_projects(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  allowed_since INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_analysis_v15 (
  project_id TEXT NOT NULL REFERENCES tracked_projects(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  day TEXT NOT NULL,
  created INTEGER NOT NULL,
  state TEXT NOT NULL,
  sealed TEXT,
  expires INTEGER,
  PRIMARY KEY(project_id,cycle)
);
CREATE INDEX IF NOT EXISTS analysis_day_v15 ON project_analysis_v15(day);
CREATE TABLE IF NOT EXISTS push_preferences_v15 (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  token TEXT NOT NULL,
  start_hour INTEGER NOT NULL,
  end_hour INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_delivery_v15 (
  day TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_repos_v15 (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','paused','disconnected')),
  due INTEGER NOT NULL, checked INTEGER, head TEXT, lease TEXT, lease_until INTEGER,
  revision INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS github_deliveries_v15 (
  id TEXT PRIMARY KEY, received INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS github_deliveries_v15_received ON github_deliveries_v15(received);
CREATE TABLE IF NOT EXISTS github_runs_v15 (
  id TEXT PRIMARY KEY, repo INTEGER NOT NULL, commit_sha TEXT NOT NULL,
  created INTEGER NOT NULL, state TEXT NOT NULL, sealed TEXT,
  FOREIGN KEY(repo) REFERENCES github_repos_v15(id)
);
CREATE INDEX IF NOT EXISTS github_runs_v15_repo ON github_runs_v15(repo,created DESC);
CREATE INDEX IF NOT EXISTS github_runs_v15_created ON github_runs_v15(created);
CREATE TABLE IF NOT EXISTS github_findings_v15 (
  id TEXT PRIMARY KEY, run TEXT NOT NULL, repo INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('new','dismissed','resolved')),
  UNIQUE(repo,fingerprint), FOREIGN KEY(run) REFERENCES github_runs_v15(id)
);

CREATE TABLE IF NOT EXISTS github_account_v15 (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  installation TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','paused','disconnected')),
  next_sync INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 1, generation TEXT,
  lease TEXT, lease_until INTEGER, last_sync INTEGER, sync_error INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS github_inventory_v15 (
  repo INTEGER PRIMARY KEY REFERENCES github_repos_v15(id),
  installation TEXT NOT NULL, generation TEXT NOT NULL,
  availability TEXT NOT NULL CHECK(availability IN ('available','archived','removed')),
  private INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS github_inventory_installation_v15 ON github_inventory_v15(installation,generation);
CREATE INDEX IF NOT EXISTS github_repos_due_v15 ON github_repos_v15(state,due);
