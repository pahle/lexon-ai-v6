-- F4.4 B-07: narrow the `ops` default privileges. 0000 granted lexon_app
-- SELECT/INSERT/UPDATE/DELETE on future ops tables and USAGE/SELECT on future
-- ops sequences, so every new ops object leaked to the application role.
-- After this migration a new ops object grants lexon_app nothing; a table
-- that needs it grants explicitly in its own migration. `app` defaults and
-- every existing object's grants are unchanged.
ALTER DEFAULT PRIVILEGES FOR ROLE lexon_migrator IN SCHEMA ops
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM lexon_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE lexon_migrator IN SCHEMA ops
  REVOKE USAGE, SELECT ON SEQUENCES FROM lexon_app;
