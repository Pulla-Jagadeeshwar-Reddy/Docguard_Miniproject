-- Keep migrations under the Compose administrator, but give the API a restricted login.
-- The password is supplied from .env by the PowerShell runner and safely quoted by psql.
ALTER ROLE docuguard_runtime LOGIN PASSWORD :'runtime_password';

GRANT USAGE ON SCHEMA public TO docuguard_runtime;
GRANT SELECT ON roles, permissions, role_permissions, departments TO docuguard_runtime;
GRANT SELECT, INSERT, UPDATE ON users TO docuguard_runtime;
GRANT USAGE, SELECT ON SEQUENCE users_user_id_seq TO docuguard_runtime;
