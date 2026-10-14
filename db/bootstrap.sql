-- One-time database setup. Run as the PostgreSQL superuser (see docs/server-setup.md):
--
--   psql -h localhost -U postgres -d postgres -v app_password=SECRET -f db/bootstrap.sql
--
-- Creates the application role (default: hudata), the main database (default: hu_data),
-- the test database (<main>_test) and the extensions both need.
-- Safe to run again: anything that already exists is skipped.
-- Tables are NOT created here; that is the job of `etl db up` (db/migrations/).

\set ON_ERROR_STOP on
\if :{?app_user}
\else
  \set app_user hudata
\endif
\if :{?db_name}
\else
  \set db_name hu_data
\endif
\set test_db_name :db_name _test

SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', d, :'app_user')
FROM unnest(ARRAY[:'db_name', :'test_db_name']) AS d
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = d) \gexec

\connect :db_name
\ir bootstrap_extensions.sql
\connect :test_db_name
\ir bootstrap_extensions.sql
