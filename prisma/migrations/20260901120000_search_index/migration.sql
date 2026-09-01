-- Trigram search over the denormalised, Arabic-normalised haystack.
-- Lets `searchText ILIKE '%...%'` use an index instead of a sequential scan,
-- which is what makes partial-word Arabic search ("ايفون" inside a longer
-- string) usable without a full-text configuration for Arabic.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "reports_search_text_trgm_idx"
  ON "reports" USING GIN ("searchText" gin_trgm_ops);

-- Supports "recent visible reports of type X" which is the hot path on the
-- home page and the search page.
CREATE INDEX IF NOT EXISTS "reports_public_feed_idx"
  ON "reports" ("publishedAt" DESC)
  WHERE "moderation" = 'VISIBLE' AND "status" = 'ACTIVE';
