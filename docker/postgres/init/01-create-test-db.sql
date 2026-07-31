-- Database used by the API test suite (see test.env at the repo root).
-- Postgres runs the files in /docker-entrypoint-initdb.d ONLY when the data
-- volume is empty. On an existing volume, create it instead with:
--   pnpm --filter @dental/database db:test:setup
CREATE DATABASE dental_test;
