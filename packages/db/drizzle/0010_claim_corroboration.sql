CREATE TABLE IF NOT EXISTS source_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  external_id text NOT NULL,
  display_name text,
  hostname text,
  parent_id uuid REFERENCES source_identities(id),
  verified_badge boolean NOT NULL DEFAULT false,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS source_identities_platform_external_idx
  ON source_identities (platform, external_id);

CREATE TABLE IF NOT EXISTS source_identity_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES source_identities(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  trust_tier text NOT NULL DEFAULT 'unknown',
  allowed_uses jsonb NOT NULL DEFAULT '["discovery"]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS source_identity_policies_revision_idx
  ON source_identity_policies (identity_id, revision);

CREATE TABLE IF NOT EXISTS publisher_host_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  trust_tier text NOT NULL DEFAULT 'unknown',
  blocked boolean NOT NULL DEFAULT false,
  allowed_uses jsonb NOT NULL DEFAULT '["discovery","analysis"]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS publisher_host_policies_host_revision_idx
  ON publisher_host_policies (hostname, revision);

ALTER TABLE evidence_items
  ADD COLUMN IF NOT EXISTS content_completeness text NOT NULL DEFAULT 'snippet',
  ADD COLUMN IF NOT EXISTS origin_key text,
  ADD COLUMN IF NOT EXISTS referenced_origin_key text,
  ADD COLUMN IF NOT EXISTS source_identity_id uuid REFERENCES source_identities(id),
  ADD COLUMN IF NOT EXISTS source_policy_revision integer,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE INDEX IF NOT EXISTS evidence_items_origin_idx ON evidence_items (origin_key);
CREATE INDEX IF NOT EXISTS evidence_items_completeness_idx ON evidence_items (content_completeness);

CREATE TABLE IF NOT EXISTS evidence_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  requested_url text NOT NULL,
  final_url text,
  http_status integer,
  content_type text,
  byte_count integer NOT NULL DEFAULT 0,
  response_hash text NOT NULL,
  cleaned_content_hash text NOT NULL,
  cleaned_text text NOT NULL,
  extracted_title text,
  byline text,
  language text,
  etag text,
  last_modified text,
  extractor_version text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  failure_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_documents_content_idx
  ON evidence_documents (evidence_id, cleaned_content_hash);
CREATE INDEX IF NOT EXISTS evidence_documents_hash_idx ON evidence_documents (cleaned_content_hash);

CREATE TABLE IF NOT EXISTS evidence_understanding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  document_id uuid REFERENCES evidence_documents(id) ON DELETE CASCADE,
  cleaned_content_hash text NOT NULL,
  model text NOT NULL,
  schema_version text NOT NULL,
  prompt_hash text NOT NULL,
  extractor_version text NOT NULL,
  language text,
  summary text NOT NULL,
  raw_output jsonb NOT NULL,
  page_class text,
  status text NOT NULL DEFAULT 'ok',
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_understanding_cache_idx
  ON evidence_understanding (
    cleaned_content_hash,
    model,
    schema_version,
    prompt_hash,
    extractor_version
  );

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_domain_id text NOT NULL REFERENCES market_domains(id),
  kind text NOT NULL,
  subject_canonical_id text,
  predicate text NOT NULL,
  object_text text,
  value jsonb,
  unit text,
  polarity text NOT NULL,
  modality text NOT NULL,
  fingerprint text NOT NULL,
  title text NOT NULL,
  policy_version text,
  extraction_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_fingerprint_idx ON claims (fingerprint);
CREATE INDEX IF NOT EXISTS claims_domain_kind_idx ON claims (market_domain_id, kind);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  stance text NOT NULL,
  excerpt text NOT NULL,
  excerpt_hash text NOT NULL,
  excerpt_start integer,
  excerpt_end integer,
  source_identity_id uuid REFERENCES source_identities(id),
  PRIMARY KEY (claim_id, evidence_id, stance)
);

CREATE TABLE IF NOT EXISTS event_claims (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  stance text NOT NULL DEFAULT 'supports',
  PRIMARY KEY (event_id, claim_id)
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS market_domain_id text REFERENCES market_domains(id),
  ADD COLUMN IF NOT EXISTS reliability_status text NOT NULL DEFAULT 'legacy_unassessed',
  ADD COLUMN IF NOT EXISTS impact_level text,
  ADD COLUMN IF NOT EXISTS content_completeness text,
  ADD COLUMN IF NOT EXISTS principal_claim_id uuid REFERENCES claims(id);

CREATE TABLE IF NOT EXISTS event_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  reliability_status text NOT NULL,
  impact_level text NOT NULL,
  content_completeness text NOT NULL,
  independent_origin_count integer NOT NULL DEFAULT 0,
  independent_actor_count integer NOT NULL DEFAULT 0,
  disputed boolean NOT NULL DEFAULT false,
  retracted boolean NOT NULL DEFAULT false,
  policy_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_assessments_revision_idx
  ON event_assessments (event_id, revision);

CREATE TABLE IF NOT EXISTS event_assessment_reasons (
  assessment_id uuid NOT NULL REFERENCES event_assessments(id) ON DELETE CASCADE,
  code text NOT NULL,
  detail text,
  PRIMARY KEY (assessment_id, code)
);

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS output_kind text NOT NULL DEFAULT 'signal',
  ADD COLUMN IF NOT EXISTS notify_kind text NOT NULL DEFAULT 'signal';

CREATE TABLE IF NOT EXISTS signal_claim_proofs (
  signal_id uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  PRIMARY KEY (signal_id, claim_id, evidence_id)
);

ALTER TABLE agent_sources
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

ALTER TABLE source_fetch_requests
  ADD COLUMN IF NOT EXISTS response_status integer,
  ADD COLUMN IF NOT EXISTS adapter_metadata jsonb;

UPDATE evidence_items
SET content_completeness = CASE
  WHEN length(coalesce(body_text, '')) >= 80 THEN 'native_complete'
  ELSE 'snippet'
END
WHERE content_completeness = 'snippet';

UPDATE events
SET reliability_status = 'legacy_unassessed'
WHERE reliability_status IS NULL OR reliability_status = '';
