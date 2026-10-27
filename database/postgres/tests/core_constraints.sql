\set ON_ERROR_STOP on
BEGIN;

SELECT user_id AS test_user_id
FROM users
WHERE email = 'admin1@docuguard.local'\gset
SELECT user_id AS test_approver_id
FROM users
WHERE email = 'doctor1@docuguard.local'\gset
SELECT category_id AS test_category_id
FROM document_categories
WHERE category_name = 'Patient Safety'\gset

-- The fixture is rolled back at the end, so this suite can run repeatedly.
INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
VALUES ('Constraint-test policy', :test_category_id, :test_user_id,
        'sql-constraint-test-document')
RETURNING document_id AS test_document_id\gset

DO $$
DECLARE
  admin_id INT;
  approver_id INT;
  admin_role_id INT;
  test_category_id INT;
  doc_id INT;
  version_one_id INT;
  version_two_id INT;
  version_three_id INT;
  test_override_id INT;
  test_expiring_override_id INT;
  dependent_b_id INT;
  dependent_c_id INT;
  notice_count INT;
  accessible_count INT;
  test_permission_id INT;
  rejected BOOLEAN;
BEGIN
  SELECT user_id INTO admin_id FROM users WHERE email = 'admin1@docuguard.local';
  SELECT user_id INTO approver_id FROM users WHERE email = 'doctor1@docuguard.local';
  SELECT role_id INTO admin_role_id FROM roles WHERE role_name = 'Admin';
  SELECT p.permission_id INTO test_permission_id
  FROM permissions AS p WHERE p.permission_name = 'USER_ADMIN';
  SELECT c.category_id INTO test_category_id
  FROM document_categories AS c WHERE c.category_name = 'Patient Safety';
  SELECT document_id INTO doc_id FROM documents WHERE mongo_doc_id = 'sql-constraint-test-document';

  IF admin_id IS NULL OR approver_id IS NULL OR doc_id IS NULL THEN
    RAISE EXCEPTION 'Core demo seed or test fixture is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE email = 'admin1@docuguard.local'
      AND left(password_hash, 7) = '$2a$12$'
      AND crypt('DG-Demo-Admin-01!', password_hash) = password_hash
  ) THEN
    RAISE EXCEPTION 'demo password is not a valid bcrypt hash at cost 12';
  END IF;

  IF verify_audit_chain() IS NOT NULL THEN
    RAISE EXCEPTION 'Audit chain was already broken before this test';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO departments(department_name) VALUES (NULL);
  EXCEPTION WHEN not_null_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'department_name accepted NULL'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO departments(department_name) VALUES ('Administration');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate department_name was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO roles(role_name) VALUES ('Surgeon');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid role_name was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO role_permissions(role_id, permission_id)
    VALUES (admin_role_id, test_permission_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate role_permissions pair was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO users(full_name, email, password_hash, role_id)
    VALUES ('Invalid Email', 'no-at-sign', 'not-a-real-login-hash', admin_role_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid user email was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO users(full_name, email, password_hash, role_id)
    VALUES ('Duplicate Email', 'admin1@docuguard.local', 'not-a-real-login-hash', admin_role_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate user email was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO users(full_name, email, password_hash, role_id, account_status)
    VALUES ('Bad Status', 'bad-status@docuguard.local', 'not-a-real-login-hash', admin_role_id, 'deleted');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid account_status was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO documents(title, category_id, owner_id, current_version_id, mongo_doc_id)
    VALUES ('Bad current version', test_category_id, admin_id, -1, 'sql-invalid-current-version');
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid current_version_id was accepted'; END IF;

  INSERT INTO document_versions(
    document_id, version_number, file_path, mongo_content_id, checksum,
    uploaded_by, effective_date
  ) VALUES (
    doc_id, 1, 'uploads/constraint-test-v1.docx', 'sql-test-content-v1',
    'sql-test-checksum-v1', admin_id, CURRENT_DATE
  ) RETURNING version_id INTO version_one_id;

  rejected := false;
  BEGIN
    INSERT INTO document_versions(
      document_id, version_number, file_path, mongo_content_id, checksum,
      uploaded_by, effective_date
    ) VALUES (
      doc_id, 1, 'uploads/duplicate.docx', 'sql-test-content-duplicate',
      'sql-test-checksum-duplicate', admin_id, CURRENT_DATE
    );
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate document version number was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO document_versions(
      document_id, version_number, file_path, mongo_content_id, checksum,
      uploaded_by, effective_date, expiry_date
    ) VALUES (
      doc_id, 2, 'uploads/bad-expiry.docx', 'sql-test-content-bad-expiry',
      'sql-test-checksum-bad-expiry', admin_id, CURRENT_DATE, CURRENT_DATE
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'expiry_date <= effective_date was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO document_versions(
      document_id, version_number, file_path, mongo_content_id, checksum,
      uploaded_by, approved_by, approved_at, effective_date
    ) VALUES (
      doc_id, 2, 'uploads/self-approved.docx', 'sql-test-content-self-approved',
      'sql-test-checksum-self-approved', admin_id, admin_id, now(), CURRENT_DATE
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'maker-checker self-approval was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO document_versions(
      document_id, version_number, file_path, mongo_content_id, checksum,
      uploaded_by, effective_date, approved_at
    ) VALUES (
      doc_id, 2, 'uploads/bad-approval-pair.docx', 'sql-test-content-bad-pair',
      'sql-test-checksum-bad-pair', admin_id, CURRENT_DATE, now()
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'approved_by/approved_at mismatch was accepted'; END IF;

  rejected := false;
  BEGIN
    UPDATE document_versions SET version_status = 'superseded'
    WHERE version_id = version_one_id;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid version transition was accepted'; END IF;

  INSERT INTO document_versions(
    document_id, version_number, file_path, mongo_content_id, checksum,
    uploaded_by, effective_date
  ) VALUES (
    doc_id, 2, 'uploads/constraint-test-v2.docx', 'sql-test-content-v2',
    'sql-test-checksum-v2', approver_id, CURRENT_DATE
  ) RETURNING version_id INTO version_two_id;

  UPDATE document_versions
  SET approved_by = approver_id, version_status = 'approved'
  WHERE version_id = version_one_id;
  UPDATE document_versions
  SET approved_by = admin_id, version_status = 'approved'
  WHERE version_id = version_two_id;

  IF (SELECT version_status FROM document_versions WHERE version_id = version_one_id) <> 'superseded' THEN
    RAISE EXCEPTION 'approving a new version did not supersede the previous version';
  END IF;
  IF (SELECT current_version_id FROM documents WHERE document_id = doc_id) <> version_two_id THEN
    RAISE EXCEPTION 'approval did not update documents.current_version_id';
  END IF;
  IF (SELECT document_status FROM documents WHERE document_id = doc_id) <> 'active' THEN
    RAISE EXCEPTION 'approval did not activate the document';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO document_permissions(document_id, role_id, access_level, granted_by)
    VALUES (doc_id, admin_role_id, 'owner', admin_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid document access_level was accepted'; END IF;

  INSERT INTO document_permissions(document_id, role_id, access_level, granted_by)
  VALUES (doc_id, admin_role_id, 'read', admin_id);
  rejected := false;
  BEGIN
    INSERT INTO document_permissions(document_id, role_id, access_level, granted_by)
    VALUES (doc_id, admin_role_id, 'read', admin_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate document permission was accepted'; END IF;

  SELECT count(*) INTO accessible_count
  FROM fn_accessible_document_ids(admin_id) AS allowed
  WHERE allowed.document_id = doc_id;
  IF accessible_count <> 1 THEN RAISE EXCEPTION 'role grant did not make the document accessible'; END IF;
  SELECT count(*) INTO accessible_count
  FROM fn_accessible_document_ids(approver_id) AS allowed
  WHERE allowed.document_id = doc_id;
  IF accessible_count <> 0 THEN RAISE EXCEPTION 'ungranted role unexpectedly has document access'; END IF;

  INSERT INTO access_overrides(user_id, document_id, justification, expires_at)
  VALUES (approver_id, doc_id, 'Emergency review requires temporary access', now() + interval '1 hour')
  RETURNING access_overrides.override_id INTO test_override_id;
  SELECT count(*) INTO accessible_count
  FROM fn_accessible_document_ids(approver_id) AS allowed
  WHERE allowed.document_id = doc_id;
  IF accessible_count <> 1 THEN RAISE EXCEPTION 'active override did not grant temporary access'; END IF;
  UPDATE access_overrides SET status = 'expired' WHERE access_overrides.override_id = test_override_id;
  SELECT count(*) INTO accessible_count
  FROM fn_accessible_document_ids(approver_id) AS allowed
  WHERE allowed.document_id = doc_id;
  IF accessible_count <> 0 THEN RAISE EXCEPTION 'expired override still grants document access'; END IF;

  INSERT INTO access_overrides(user_id, document_id, justification, granted_at, expires_at)
  VALUES (approver_id, doc_id, 'Emergency review access expired for test', now() - interval '2 hours', now() - interval '1 hour')
  RETURNING access_overrides.override_id INTO test_expiring_override_id;
  PERFORM fn_expire_overrides();
  IF (SELECT status FROM access_overrides WHERE access_overrides.override_id = test_expiring_override_id) <> 'expired' THEN
    RAISE EXCEPTION 'override expiry sweep did not expire the old override';
  END IF;

  UPDATE document_versions SET expiry_date = CURRENT_DATE + 30
  WHERE version_id = version_two_id;
  PERFORM fn_expiry_sweep();
  SELECT count(*) INTO notice_count FROM notifications
  WHERE document_id = doc_id AND message LIKE '%(30-day warning).';
  IF notice_count <> 1 THEN RAISE EXCEPTION '30-day expiry notification was not created'; END IF;
  PERFORM fn_expiry_sweep();
  SELECT count(*) INTO notice_count FROM notifications
  WHERE document_id = doc_id AND message LIKE '%(30-day warning).';
  IF notice_count <> 1 THEN RAISE EXCEPTION 'expiry sweep duplicated the 30-day notification'; END IF;

  UPDATE document_versions SET expiry_date = CURRENT_DATE + 7
  WHERE version_id = version_two_id;
  PERFORM fn_expiry_sweep();
  SELECT count(*) INTO notice_count FROM notifications
  WHERE document_id = doc_id AND message LIKE '%(7-day warning).';
  IF notice_count <> 1 THEN RAISE EXCEPTION '7-day expiry notification was not created'; END IF;

  INSERT INTO document_versions(
    document_id, version_number, file_path, mongo_content_id, checksum,
    uploaded_by, effective_date, expiry_date
  ) VALUES (
    doc_id, 3, 'uploads/expired-test-v3.docx', 'sql-test-content-v3',
    'sql-test-checksum-v3', admin_id, CURRENT_DATE - 10, CURRENT_DATE - 1
  ) RETURNING version_id INTO version_three_id;
  UPDATE document_versions
  SET approved_by = approver_id, version_status = 'approved'
  WHERE version_id = version_three_id;
  PERFORM fn_expiry_sweep();
  IF (SELECT version_status FROM document_versions WHERE version_id = version_three_id) <> 'expired' THEN
    RAISE EXCEPTION 'expiry sweep did not expire a past-due approved version';
  END IF;

  INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
  VALUES ('Cycle-test dependent B', test_category_id, admin_id, 'sql-cycle-test-b')
  RETURNING document_id INTO dependent_b_id;
  INSERT INTO documents(title, category_id, owner_id, mongo_doc_id)
  VALUES ('Cycle-test dependent C', test_category_id, admin_id, 'sql-cycle-test-c')
  RETURNING document_id INTO dependent_c_id;
  INSERT INTO document_references(source_document_id, target_document_id, reference_type) VALUES
    (dependent_b_id, doc_id, 'depends_on'),
    (dependent_c_id, dependent_b_id, 'depends_on'),
    (doc_id, dependent_c_id, 'depends_on');
  UPDATE documents SET document_status = 'retired' WHERE document_id = doc_id;
  SELECT count(*) INTO notice_count FROM notifications
  WHERE notification_type = 'dependency_warning'
    AND document_id IN (dependent_b_id, dependent_c_id);
  IF notice_count <> 2 THEN
    RAISE EXCEPTION 'cycle-safe retirement trigger did not notify each dependent owner';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO access_overrides(user_id, document_id, justification, expires_at)
    VALUES (admin_id, doc_id, 'Too short', now() + interval '1 hour');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'short break-glass justification was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO access_overrides(user_id, document_id, justification, expires_at)
    VALUES (admin_id, doc_id, 'This access request is long enough', now() + interval '25 hours');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'break-glass duration over 24 hours was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO access_overrides(
      user_id, document_id, justification, expires_at,
      reviewed_by, reviewed_at, review_outcome
    ) VALUES (
      admin_id, doc_id, 'This access request is long enough', now() + interval '1 hour',
      admin_id, now(), 'justified'
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'requester was allowed to review their own override'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO access_logs(user_id, document_id, action, is_break_glass)
    VALUES (admin_id, doc_id, 'view', true);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'break-glass flag without override_id was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO notifications(user_id, notification_type, message)
    VALUES (admin_id, 'unknown_type', 'bad type');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid notification_type was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO audit_integrity_checks(run_by, rows_verified, result, first_broken_log_id)
    VALUES (admin_id, 0, 'intact', 10);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'inconsistent audit check result was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO document_references(source_document_id, target_document_id)
    VALUES (doc_id, doc_id);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'self-referencing document edge was accepted'; END IF;

  IF has_table_privilege('docuguard_runtime', 'public.access_logs', 'UPDATE')
     OR has_table_privilege('docuguard_runtime', 'public.access_logs', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role can rewrite or delete access logs';
  END IF;
END
$$;

INSERT INTO access_logs(user_id, document_id, version_id, action, ip_address)
VALUES (:test_user_id, :test_document_id, NULL, 'view', '203.0.113.10')
RETURNING log_id AS tamper_test_log_id\gset
SELECT set_config('docuguard.test_log_id', :'tamper_test_log_id', true);

DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE access_logs SET action = 'download'
    WHERE log_id = current_setting('docuguard.test_log_id', true)::BIGINT;
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'audit UPDATE was not rejected'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM access_logs
    WHERE log_id = current_setting('docuguard.test_log_id', true)::BIGINT;
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'audit DELETE was not rejected'; END IF;
END
$$;

ALTER TABLE access_logs DISABLE TRIGGER trg_audit_immutable;
UPDATE access_logs SET ip_address = '203.0.113.11' WHERE log_id = :tamper_test_log_id;
ALTER TABLE access_logs ENABLE TRIGGER trg_audit_immutable;

DO $$
BEGIN
  IF verify_audit_chain() IS DISTINCT FROM current_setting('docuguard.test_log_id')::BIGINT THEN
    RAISE EXCEPTION 'audit tamper test did not identify the modified log row';
  END IF;
END
$$;

ROLLBACK;
\echo Core SQL constraint, trigger, grant, and audit-tamper tests passed.
