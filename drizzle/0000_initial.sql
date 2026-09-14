PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  funnel TEXT NOT NULL CHECK (funnel IN ('client', 'affiliate')),
  pipeline_state TEXT NOT NULL DEFAULT 'discovered',
  channel_state TEXT NOT NULL DEFAULT 'browser_contact_pending',
  instagram_username TEXT NOT NULL,
  instagram_user_id TEXT,
  display_name TEXT,
  biography TEXT,
  category TEXT,
  location TEXT,
  language TEXT,
  niche TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_keyword TEXT,
  profile_url TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  decision_maker_role TEXT NOT NULL DEFAULT 'unknown',
  profile_signals_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  api_window_expires_at TEXT,
  next_action_at TEXT,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_instagram_username_unique
  ON leads (instagram_username);
CREATE UNIQUE INDEX IF NOT EXISTS leads_instagram_user_id_unique
  ON leads (instagram_user_id);
CREATE INDEX IF NOT EXISTS leads_funnel_pipeline_idx
  ON leads (funnel, pipeline_state);
CREATE INDEX IF NOT EXISTS leads_next_action_idx
  ON leads (next_action_at);

CREATE TABLE IF NOT EXISTS do_not_contact (
  id TEXT PRIMARY KEY NOT NULL,
  identity_type TEXT NOT NULL CHECK (
    identity_type IN ('instagram_username', 'instagram_user_id', 'phone')
  ),
  identity_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_lead_id TEXT REFERENCES leads(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS do_not_contact_identity_unique
  ON do_not_contact (identity_type, identity_value);

CREATE TABLE IF NOT EXISTS channel_ownership (
  lead_id TEXT PRIMARY KEY NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  owner TEXT NOT NULL DEFAULT 'none' CHECK (
    owner IN ('browser', 'api', 'human', 'none')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT NOT NULL CHECK (
    channel IN ('browser', 'instagram_api', 'whatsapp', 'system')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'sent', 'delivered', 'received', 'failed', 'blocked')
  ),
  body TEXT NOT NULL,
  external_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  variant_id TEXT,
  failure_reason TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_unique
  ON messages (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS messages_external_message_unique
  ON messages (external_message_id);
CREATE INDEX IF NOT EXISTS messages_lead_created_idx
  ON messages (lead_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'dead_letter', 'paused')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  locked_by TEXT,
  last_error TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_unique
  ON jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON jobs (status, available_at);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS events_lead_created_idx
  ON events (lead_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  payload_json TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_provider_event_unique
  ON webhook_events (provider, external_event_id);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  funnel TEXT NOT NULL CHECK (funnel IN ('client', 'affiliate')),
  variable TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'running', 'paused', 'completed')
  ),
  minimum_sample_size INTEGER NOT NULL DEFAULT 50,
  exploration_percent INTEGER NOT NULL DEFAULT 10 CHECK (
    exploration_percent BETWEEN 0 AND 100
  ),
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_control INTEGER NOT NULL DEFAULT 0 CHECK (is_control IN (0, 1)),
  allocation_percent INTEGER NOT NULL CHECK (allocation_percent BETWEEN 0 AND 100),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS experiment_variant_name_unique
  ON experiment_variants (experiment_id, name);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outcome TEXT,
  outcome_value REAL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  converted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS experiment_lead_unique
  ON experiment_assignments (experiment_id, lead_id);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_cost_micros INTEGER NOT NULL,
  decision_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_calls_created_idx ON ai_calls (created_at);

CREATE TABLE IF NOT EXISTS system_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK (paused IN (0, 1)),
  reason TEXT NOT NULL DEFAULT 'initial_setup',
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO system_state (id, paused, reason, updated_by)
VALUES (1, 1, 'initial_setup', 'system');

CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'acknowledged', 'resolved')
  ),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS exceptions_status_created_idx
  ON exceptions (status, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_entity_idx
  ON audit_log (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS circuit_breakers (
  name TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (
    state IN ('closed', 'open', 'half_open')
  ),
  failure_count INTEGER NOT NULL DEFAULT 0,
  threshold INTEGER NOT NULL DEFAULT 5,
  opened_at TEXT,
  last_failure_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_counters (
  date TEXT NOT NULL,
  counter TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_counter_unique
  ON daily_counters (date, counter);

CREATE TABLE IF NOT EXISTS integration_health (
  integration TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('healthy', 'degraded', 'unavailable', 'unconfigured')
  ),
  message TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS browser_runs (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fake', 'dry_run', 'live')),
  status TEXT NOT NULL CHECK (status IN ('started', 'sent', 'blocked', 'failed')),
  url TEXT,
  message TEXT,
  variant_id TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS browser_runs_job_idx ON browser_runs (job_id);
