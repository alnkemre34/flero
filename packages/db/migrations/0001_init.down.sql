-- Rollback for 0001_init. LOCAL / DEV ONLY: destroys all FLERO data.
-- Production is forward-only (expand → migrate → contract, doc 06 §1); never run this against a shared database.
DROP SCHEMA IF EXISTS admin_v CASCADE;
DROP SCHEMA IF EXISTS ident CASCADE;
DROP SCHEMA IF EXISTS app CASCADE;
DELETE FROM public.schema_migrations WHERE version = '0001_init';
