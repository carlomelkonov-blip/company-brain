-- Control database: one row per customer (tenant). Never holds customer content.
CREATE TABLE tenants (
  slug             text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name             text NOT NULL,
  db_name          text NOT NULL UNIQUE,
  email_domains    text[] NOT NULL CHECK (cardinality(email_domains) > 0),
  connected_suites text[] NOT NULL DEFAULT '{}',
  plan             text NOT NULL DEFAULT 'pilot',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
