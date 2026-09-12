ALTER TABLE agents ALTER COLUMN token_budget SET DEFAULT 100000;
ALTER TABLE agents ALTER COLUMN token_budget DROP NOT NULL;

UPDATE agents SET token_budget = 100000 WHERE token_budget = 8000;
