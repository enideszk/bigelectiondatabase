-- Included by bootstrap.sql once per database (needs superuser).
-- Extensions live in their own schema so that `etl db reset` (which drops and recreates
-- the public schema) never touches PostGIS.

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO PUBLIC;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;   -- for "no overlapping validity periods" constraints

SELECT format('ALTER DATABASE %I SET search_path = public, extensions', current_database()) \gexec

SELECT current_database() AS database, extensions.postgis_lib_version() AS postgis;
