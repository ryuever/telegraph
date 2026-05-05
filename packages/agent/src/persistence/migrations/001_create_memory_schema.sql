-- Phase 5 SQLite Memory Schema Migration
-- Created: 2026-05-05
-- Purpose: Initialize Tier 2 persistent memory storage

-- Sessions table: stores session metadata
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSON
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);

-- Messages table: stores conversation messages (Tier 2)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  metadata JSON,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

-- Facts table: stores validated facts from conversations
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  fact_text TEXT NOT NULL,
  confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL CHECK (source IN ('tool_result', 'user_confirmation', 'conversation_history', 'llm_reasoning', 'memory')),
  extracted_from TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  is_valid BOOLEAN,
  validation_count INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_facts_session_id ON facts(session_id);
CREATE INDEX IF NOT EXISTS idx_facts_user_id ON facts(user_id);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_facts_expires_at ON facts(expires_at);
CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source);
CREATE INDEX IF NOT EXISTS idx_facts_is_valid ON facts(is_valid);

-- Validations table: tracks fact validation history
CREATE TABLE IF NOT EXISTS validations (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL,
  reason TEXT,
  timestamp INTEGER NOT NULL,
  validator_type TEXT CHECK (validator_type IN ('automatic', 'user_confirmed', 'tool_verified')),
  FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_validations_fact_id ON validations(fact_id);
CREATE INDEX IF NOT EXISTS idx_validations_timestamp ON validations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_validations_validator_type ON validations(validator_type);

-- Fact relationships: tracks contradictions and related facts
CREATE TABLE IF NOT EXISTS fact_relationships (
  id TEXT PRIMARY KEY,
  fact_id_1 TEXT NOT NULL,
  fact_id_2 TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('contradicts', 'supports', 'related')),
  confidence REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (fact_id_1) REFERENCES facts(id) ON DELETE CASCADE,
  FOREIGN KEY (fact_id_2) REFERENCES facts(id) ON DELETE CASCADE,
  UNIQUE(fact_id_1, fact_id_2, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_fact_relationships_type ON fact_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_fact_relationships_fact1 ON fact_relationships(fact_id_1);
CREATE INDEX IF NOT EXISTS idx_fact_relationships_fact2 ON fact_relationships(fact_id_2);

-- Cleanup log: tracks archival operations
CREATE TABLE IF NOT EXISTS sessions_cleanup_log (
  session_id TEXT PRIMARY KEY,
  last_cleanup_at INTEGER,
  messages_archived INTEGER DEFAULT 0,
  facts_archived INTEGER DEFAULT 0,
  archival_time_ms INTEGER
);

-- Migration metadata table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (1, '001_create_memory_schema', unixepoch('now'));
