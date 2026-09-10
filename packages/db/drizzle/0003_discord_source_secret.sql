ALTER TABLE sources ADD COLUMN IF NOT EXISTS secret_id uuid REFERENCES encrypted_secrets(id);
