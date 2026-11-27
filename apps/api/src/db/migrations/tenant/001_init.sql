-- One customer's database: org chart, knowledge graph, sources and the maintenance queue.

-- People from the customer's directory (Entra ID / Google Workspace). The org chart is
-- visible to everyone in the company; everything else goes through the access rules.
CREATE TABLE people (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  name               text NOT NULL,
  title              text,
  team               text,
  manager_id         uuid REFERENCES people(id),
  is_admin           boolean NOT NULL DEFAULT false,
  is_service_account boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_manager_idx ON people(manager_id);

-- Graph nodes other than people.
CREATE TABLE entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('project', 'meeting', 'skill', 'decision', 'action_item', 'topic', 'document')),
  name            text NOT NULL,
  normalized_name text NOT NULL,
  properties      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Projects and skills are unique by normalized name; meetings, decisions etc. are not.
CREATE UNIQUE INDEX entities_unique_named ON entities(type, normalized_name)
  WHERE type IN ('project', 'skill', 'topic');
CREATE INDEX entities_type_idx ON entities(type);

-- Everything we ingested: meeting notes, transcripts, emails, documents.
-- acl_emails = who can open this item in the source tool (attendees, recipients...).
CREATE TABLE sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('facilitator_notes', 'teams_transcript', 'meet_transcript', 'email', 'document')),
  external_id  text NOT NULL UNIQUE,
  title        text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  project_id   uuid REFERENCES entities(id),
  meeting_id   uuid REFERENCES entities(id),
  author_email text,
  acl_emails   text[] NOT NULL,
  url          text,
  content      text NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_project_idx ON sources(project_id);
CREATE INDEX sources_acl_idx ON sources USING gin(acl_emails);

-- Searchable pieces of each source. v1 uses Postgres full-text search;
-- an embedding column (pgvector) is a planned addition for hybrid search.
CREATE TABLE chunks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord       int NOT NULL,
  text      text NOT NULL,
  tsv       tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX chunks_tsv_idx ON chunks USING gin(tsv);
CREATE INDEX chunks_source_idx ON chunks(source_id);

-- Graph edges. Every fact points to the source it came from, has a confidence,
-- and a validity window that the maintenance loop uses.
CREATE TABLE relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_kind   text NOT NULL CHECK (from_kind IN ('person', 'entity')),
  from_id     uuid NOT NULL,
  type        text NOT NULL CHECK (type IN ('member_of', 'attended', 'expert_in', 'decided', 'action_for', 'part_of', 'mentioned_in')),
  to_kind     text NOT NULL CHECK (to_kind IN ('person', 'entity')),
  to_id       uuid NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}',
  confidence  real NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_id   uuid REFERENCES sources(id) ON DELETE CASCADE,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rel_from_idx ON relationships(from_id, type);
CREATE INDEX rel_to_idx ON relationships(to_id, type);
CREATE UNIQUE INDEX rel_unique_per_source ON relationships(from_id, type, to_id, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Meeting names that must never become projects ("Weekly sync", "1:1"...). Admin-editable.
CREATE TABLE excluded_meeting_names (
  normalized_name text PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO excluded_meeting_names(normalized_name) VALUES
  ('weekly sync'), ('daily standup'), ('standup'), ('1:1'), ('one on one'), ('catch up'), ('lunch');

-- The maintenance loop's queue: stale facts, conflicts and answers users flagged.
CREATE TABLE review_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('stale', 'conflict', 'flagged_answer')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'corrected', 'retired')),
  title            text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}',
  relationship_ids uuid[] NOT NULL DEFAULT '{}',
  project_id       uuid REFERENCES entities(id),
  assignee_id      uuid REFERENCES people(id),
  dedupe_key       text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES people(id),
  resolution_note  text
);

CREATE TABLE sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector   text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  stats       jsonb NOT NULL DEFAULT '{}',
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- For the north-star metric (weekly answered questions per active user).
CREATE TABLE question_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(id),
  question   text NOT NULL,
  intent     text NOT NULL,
  mode       text NOT NULL,
  n_sources  int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
