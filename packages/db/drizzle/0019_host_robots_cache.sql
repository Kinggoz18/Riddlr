CREATE TABLE IF NOT EXISTS host_robots_cache (
  origin text PRIMARY KEY,
  robots_txt text NOT NULL,
  http_status integer,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
