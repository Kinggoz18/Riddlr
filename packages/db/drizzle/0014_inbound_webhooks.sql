CREATE TABLE IF NOT EXISTS labeled_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain text NOT NULL,
  address text NOT NULL,
  label text NOT NULL,
  role text NOT NULL,
  shipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS labeled_addresses_chain_addr_idx
  ON labeled_addresses (chain, address);

CREATE TABLE IF NOT EXISTS inbound_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  adapter_id text NOT NULL,
  webhook_id text NOT NULL,
  event_id text NOT NULL,
  event_created_at timestamptz,
  payload jsonb NOT NULL,
  processed_offset integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_webhook_receipts_event_idx
  ON inbound_webhook_receipts (source_id, webhook_id, event_id);

INSERT INTO labeled_addresses (chain, address, label, role, shipped)
VALUES
  ('ethereum', '0x28c6c06298d514db089934071355e5743bf21d60', 'Binance 14', 'exchange', true),
  ('ethereum', '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43', 'Coinbase 10', 'exchange', true),
  ('ethereum', '0x3ee18b2214aff97000d974cf647e7c347e8fa585', 'Wormhole Token Bridge', 'bridge', true)
ON CONFLICT (chain, address) DO NOTHING;
