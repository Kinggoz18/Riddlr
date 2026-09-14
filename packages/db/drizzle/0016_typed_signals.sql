ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS typed_signal text,
  ADD COLUMN IF NOT EXISTS anticipated boolean NOT NULL DEFAULT false;
