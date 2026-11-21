REVOKE EXECUTE ON FUNCTION auth.lexon_append_audit(jsonb) FROM lexon_app;
COMMENT ON FUNCTION auth.lexon_append_audit(jsonb) IS 'SECURITY DEFINER. Only lexon_auth may execute: it has no INSERT on ops.audit_events and writes audit rows only through this function. lexon_app writes by direct INSERT.';
