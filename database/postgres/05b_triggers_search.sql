-- Push owns acknowledgment reminders. Core version notifications remain in 05a.
CREATE OR REPLACE FUNCTION fn_notify_assignment_targets()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  policy_title TEXT;
  current_version INT;
BEGIN
  SELECT d.title, d.current_version_id
    INTO policy_title, current_version
  FROM documents d
  WHERE d.document_id = NEW.document_id;

  IF current_version IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT u.user_id, NEW.document_id, 'ack_required',
         format('Please read and acknowledge policy "%s" by %s.', policy_title, NEW.due_date)
  FROM users u
  WHERE u.account_status = 'active'
    AND (NEW.target_role_id IS NULL OR u.role_id = NEW.target_role_id)
    AND (NEW.target_department_id IS NULL OR u.department_id = NEW.target_department_id)
    AND NOT EXISTS (
      SELECT 1 FROM acknowledgments a
      WHERE a.assignment_id = NEW.assignment_id
        AND a.user_id = u.user_id
        AND a.version_id = current_version
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_notify_new_approved_version_for_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT u.user_id, NEW.document_id, 'ack_required',
         format('A new version of "%s" requires your acknowledgment by %s.', d.title, pa.due_date)
  FROM policy_assignments pa
  JOIN documents d ON d.document_id = pa.document_id
  JOIN users u ON u.account_status = 'active'
    AND (pa.target_role_id IS NULL OR u.role_id = pa.target_role_id)
    AND (pa.target_department_id IS NULL OR u.department_id = pa.target_department_id)
  WHERE pa.document_id = NEW.document_id
    AND (pa.due_date >= CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1 FROM acknowledgments a
      WHERE a.assignment_id = pa.assignment_id
        AND a.user_id = u.user_id
        AND a.version_id = NEW.version_id
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_policy_assignment_ack_notification
AFTER INSERT ON policy_assignments
FOR EACH ROW EXECUTE FUNCTION fn_notify_assignment_targets();

CREATE TRIGGER trg_approved_version_ack_notification
AFTER UPDATE OF version_status ON document_versions
FOR EACH ROW
WHEN (OLD.version_status IS DISTINCT FROM NEW.version_status AND NEW.version_status = 'approved')
EXECUTE FUNCTION fn_notify_new_approved_version_for_assignments();
