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
