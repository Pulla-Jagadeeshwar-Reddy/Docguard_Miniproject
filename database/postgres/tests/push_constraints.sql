-- Push-owned SQL checks. These tests deliberately provoke constraint violations
-- inside subtransactions, so they leave no invalid rows behind.
DO $$
DECLARE
  test_user_id INT;
  doc_one INT;
  doc_two INT;
  assignment_doc INT;
  admin_id INT;
  due DATE := CURRENT_DATE + 10;
BEGIN
  SELECT user_id INTO test_user_id FROM users WHERE email = 'doctor1@docuguard.local';
  SELECT user_id INTO admin_id FROM users WHERE email = 'admin1@docuguard.local';
  SELECT document_id INTO doc_one FROM documents WHERE mongo_doc_id = 'demo-infection-control';
  SELECT document_id INTO doc_two FROM documents WHERE mongo_doc_id = 'demo-patient-privacy';
  assignment_doc := doc_one;

  IF test_user_id IS NULL OR admin_id IS NULL OR doc_one IS NULL OR doc_two IS NULL THEN
    RAISE EXCEPTION 'Push SQL tests require the Phase 1 demo seed data; run migrations first.';
  END IF;

  -- Unsupported search mode must be rejected by CHECK.
  BEGIN
    INSERT INTO search_logs(user_id, query_text, search_type, results_count)
    VALUES (test_user_id, 'negative test', 'magic', 0);
    RAISE EXCEPTION 'Expected invalid search_type to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Negative result counts must be rejected.
  BEGIN
    INSERT INTO search_logs(user_id, query_text, search_type, results_count)
    VALUES (test_user_id, 'negative test', 'keyword', -1);
    RAISE EXCEPTION 'Expected negative results_count to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Similarity pairs cannot be stored in reverse order or with a score > 1.
  BEGIN
    INSERT INTO similar_documents(document_id_1, document_id_2, similarity_score)
    VALUES (GREATEST(doc_one, doc_two), LEAST(doc_one, doc_two), 0.90);
    RAISE EXCEPTION 'Expected reversed document pair to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO similar_documents(document_id_1, document_id_2, similarity_score)
    VALUES (LEAST(doc_one, doc_two), GREATEST(doc_one, doc_two), 1.10);
    RAISE EXCEPTION 'Expected similarity_score > 1 to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- An assignment must target a role, a department, or both.
  BEGIN
    INSERT INTO policy_assignments(document_id, assigned_by, due_date)
    VALUES (assignment_doc, admin_id, due);
    RAISE EXCEPTION 'Expected assignment without target to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Assignment due date cannot precede its creation date.
  BEGIN
    INSERT INTO policy_assignments(document_id, target_role_id, assigned_by, due_date, assigned_at)
    SELECT assignment_doc, role_id, admin_id, CURRENT_DATE - 1, now()
    FROM roles WHERE role_name = 'Nurse';
    RAISE EXCEPTION 'Expected past due_date to fail, but it succeeded.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Each regulation score must remain within 0..100.
  IF EXISTS (
    SELECT 1 FROM v_regulatory_coverage_summary
    WHERE coverage_percent < 0 OR coverage_percent > 100
  ) THEN
    RAISE EXCEPTION 'Coverage score is outside 0..100.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM v_control_coverage) THEN
    RAISE EXCEPTION 'Expected seeded regulatory controls in v_control_coverage.';
  END IF;

  RAISE NOTICE 'Push SQL constraint tests passed.';
END;
$$;
