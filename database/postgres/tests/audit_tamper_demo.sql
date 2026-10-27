\set ON_ERROR_STOP on
BEGIN;

-- This is a reversible viva rehearsal: the final ROLLBACK restores the audit row and trigger.
DO $$
BEGIN
  IF verify_audit_chain() IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to rehearse on an already-tampered audit chain';
  END IF;
END
$$;

SELECT user_id AS demo_user_id FROM users WHERE email = 'admin1@docuguard.local'\gset
SELECT category_id AS demo_category_id FROM document_categories WHERE category_name = 'Administration'\gset

INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
VALUES ('Audit tamper rehearsal fixture', :demo_category_id, :demo_user_id,
        'audit-tamper-demo-' || txid_current()::text)
RETURNING document_id AS demo_document_id\gset

INSERT INTO access_logs(user_id, document_id, action, ip_address)
VALUES (:demo_user_id, :demo_document_id, 'view', '203.0.113.10')
RETURNING log_id AS demo_log_id\gset
SELECT set_config('docuguard.demo_tamper_log_id', :'demo_log_id', true);

-- A superuser can disable the immutability trigger for this controlled demonstration.
ALTER TABLE access_logs DISABLE TRIGGER trg_audit_immutable;
UPDATE access_logs
SET ip_address = '203.0.113.11'
WHERE log_id = :demo_log_id;
ALTER TABLE access_logs ENABLE TRIGGER trg_audit_immutable;

DO $$
DECLARE
  broken_log_id BIGINT;
BEGIN
  SELECT verify_audit_chain() INTO broken_log_id;
  IF broken_log_id IS DISTINCT FROM current_setting('docuguard.demo_tamper_log_id')::BIGINT THEN
    RAISE EXCEPTION 'Expected the verifier to identify the modified rehearsal row';
  END IF;
  RAISE NOTICE 'Tampering detected at log_id %', broken_log_id;
END
$$;

ROLLBACK;
\echo Audit tamper rehearsal passed; transaction rolled back.
