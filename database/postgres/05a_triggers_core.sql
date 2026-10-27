CREATE OR REPLACE FUNCTION fn_validate_version_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_status IS DISTINCT FROM OLD.version_status THEN
    IF NOT (
      (OLD.version_status = 'pending_review' AND NEW.version_status IN ('approved', 'expired'))
      OR (OLD.version_status = 'approved' AND NEW.version_status IN ('superseded', 'expired'))
    ) THEN
      RAISE EXCEPTION 'invalid document version transition: % -> %',
        OLD.version_status, NEW.version_status
        USING ERRCODE = '23514';
    END IF;

    IF NEW.version_status = 'approved' THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_after_version_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  previous_version_id INT;
BEGIN
  -- Keep the current-version pointer and superseded state in the same transaction
  -- as the approval, so readers never observe a half-switched document.
  SELECT current_version_id INTO previous_version_id
  FROM documents
  WHERE document_id = NEW.document_id
  FOR UPDATE;

  IF previous_version_id IS NOT NULL AND previous_version_id <> NEW.version_id THEN
    UPDATE document_versions
    SET version_status = 'superseded'
    WHERE version_id = previous_version_id
      AND version_status = 'approved';
  END IF;

  UPDATE documents
  SET current_version_id = NEW.version_id,
      document_status = 'active'
  WHERE document_id = NEW.document_id;

  -- Push owns acknowledgment notifications; this trigger only sends the core
  -- new-version alert to the owner and roles with active document grants.
  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT recipient.user_id, NEW.document_id, 'new_version',
         format('Policy "%s" version %s is now approved.', d.title, NEW.version_number)
  FROM documents AS d
  CROSS JOIN LATERAL (
    SELECT d.owner_id AS user_id
    UNION
    SELECT u.user_id
    FROM document_permissions AS p
    JOIN users AS u ON u.role_id = p.role_id
    WHERE p.document_id = d.document_id AND p.revoked_at IS NULL
  ) AS recipient
  WHERE d.document_id = NEW.document_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_after_version_expired()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT d.owner_id, d.document_id, 'expiry_warning',
         format('Policy "%s" version %s has expired.', d.title, NEW.version_number)
  FROM documents AS d
  WHERE d.document_id = NEW.document_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_version_transition
BEFORE UPDATE ON document_versions
FOR EACH ROW EXECUTE FUNCTION fn_validate_version_transition();

CREATE TRIGGER trg_version_approved
AFTER UPDATE OF version_status ON document_versions
FOR EACH ROW
WHEN (OLD.version_status IS DISTINCT FROM NEW.version_status AND NEW.version_status = 'approved')
EXECUTE FUNCTION fn_after_version_approved();

CREATE TRIGGER trg_version_expired
AFTER UPDATE OF version_status ON document_versions
FOR EACH ROW
WHEN (OLD.version_status IS DISTINCT FROM NEW.version_status AND NEW.version_status = 'expired')
EXECUTE FUNCTION fn_after_version_expired();

CREATE TRIGGER trg_audit_chain
BEFORE INSERT ON access_logs
FOR EACH ROW EXECUTE FUNCTION fn_audit_chain_before_insert();

CREATE TRIGGER trg_audit_immutable
BEFORE UPDATE OR DELETE ON access_logs
FOR EACH ROW EXECUTE FUNCTION fn_audit_chain_immutable();

CREATE TRIGGER trg_document_retired
AFTER UPDATE OF document_status ON documents
FOR EACH ROW
WHEN (OLD.document_status IS DISTINCT FROM NEW.document_status AND NEW.document_status = 'retired')
EXECUTE FUNCTION fn_notify_document_dependents_on_retire();

-- The runtime role can append audit events but cannot rewrite or remove history.
REVOKE UPDATE, DELETE ON TABLE access_logs FROM docuguard_runtime;
