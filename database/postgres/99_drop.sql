-- Destructive teardown for this dedicated project database. This drops every
-- object in public, including Push-owned tables and extensions, but not roles
-- or data in other schemas/databases. Re-run migrations after executing it.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO PUBLIC;
