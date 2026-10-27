CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Shared permission contract for document lists, detail reads, and Push search.
-- Approval/current-version/expiry filtering stays in the consuming query.
CREATE OR REPLACE FUNCTION fn_accessible_document_ids(p_user_id INT)
RETURNS TABLE(document_id INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT dp.document_id
  FROM public.document_permissions AS dp
  JOIN public.users AS u ON u.role_id = dp.role_id
  WHERE u.user_id = p_user_id
    AND u.account_status = 'active'
    AND dp.revoked_at IS NULL
  UNION
  SELECT ao.document_id
  FROM public.access_overrides AS ao
  JOIN public.users AS u ON u.user_id = ao.user_id
  WHERE ao.user_id = p_user_id
    AND u.account_status = 'active'
    AND ao.status = 'active'
    AND ao.expires_at > now();
$$;

-- Canonical hash input follows the data dictionary's concat_ws format.
CREATE OR REPLACE FUNCTION fn_access_log_hash(
  p_prev_hash CHAR(64),
  p_log_id BIGINT,
  p_user_id INT,
  p_document_id INT,
  p_version_id INT,
  p_override_id INT,
  p_action VARCHAR(20),
  p_is_break_glass BOOLEAN,
  p_ip_address VARCHAR(45),
  p_accessed_at TIMESTAMP
)
RETURNS CHAR(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        p_prev_hash::text,
        p_log_id::text,
        p_user_id::text,
        p_document_id::text,
        p_version_id::text,
        p_override_id::text,
        p_action,
        p_is_break_glass::text,
        p_ip_address,
        extract(epoch FROM p_accessed_at)::text
      ),
      'sha256'
    ),
    'hex'
  )::CHAR(64);
$$;

CREATE OR REPLACE FUNCTION fn_audit_chain_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  last_hash CHAR(64);
  last_log_id BIGINT;
  serialized_log_id BIGINT;
BEGIN
  -- Serialize inserts so concurrent requests cannot claim the same predecessor.
  PERFORM pg_advisory_xact_lock(727001);
  SELECT log_id, row_hash INTO last_log_id, last_hash
  FROM access_logs
  ORDER BY log_id DESC
  LIMIT 1;

  -- SERIAL assigns a value before this trigger runs. Allocate the final ID after
  -- taking the lock so a delayed insert cannot land behind a later hash-chain row.
  serialized_log_id := nextval(pg_get_serial_sequence('public.access_logs', 'log_id'));
  WHILE last_log_id IS NOT NULL AND serialized_log_id <= last_log_id LOOP
    serialized_log_id := nextval(pg_get_serial_sequence('public.access_logs', 'log_id'));
  END LOOP;
  NEW.log_id := serialized_log_id;

  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64)::CHAR(64));
  NEW.row_hash := fn_access_log_hash(
    NEW.prev_hash, NEW.log_id, NEW.user_id, NEW.document_id,
    NEW.version_id, NEW.override_id, NEW.action, NEW.is_break_glass,
    NEW.ip_address, NEW.accessed_at
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_audit_chain_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'access_logs are insert-only; UPDATE and DELETE are prohibited'
    USING ERRCODE = '55000';
END;
$$;

-- Returns the first row whose predecessor or recomputed hash is invalid; NULL means intact.
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  item RECORD;
  expected_prev CHAR(64) := repeat('0', 64)::CHAR(64);
  expected_hash CHAR(64);
BEGIN
  FOR item IN
    SELECT log_id, user_id, document_id, version_id, override_id,
           action, is_break_glass, ip_address, accessed_at, prev_hash, row_hash
    FROM public.access_logs
    ORDER BY log_id
  LOOP
    IF item.prev_hash IS DISTINCT FROM expected_prev THEN
      RETURN item.log_id;
    END IF;

    expected_hash := public.fn_access_log_hash(
      item.prev_hash, item.log_id, item.user_id, item.document_id,
      item.version_id, item.override_id, item.action, item.is_break_glass,
      item.ip_address, item.accessed_at
    );
    IF item.row_hash IS DISTINCT FROM expected_hash THEN
      RETURN item.log_id;
    END IF;
    expected_prev := item.row_hash;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fn_expire_overrides()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  changed_rows INTEGER;
BEGIN
  UPDATE access_overrides
  SET status = 'expired'
  WHERE status = 'active' AND expires_at <= now();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows;
END;
$$;

CREATE OR REPLACE FUNCTION fn_expiry_sweep()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  changed_rows INTEGER := 0;
  affected_rows INTEGER;
BEGIN
  UPDATE document_versions
  SET version_status = 'expired'
  WHERE version_status = 'approved'
    AND expiry_date < CURRENT_DATE;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  changed_rows := changed_rows + affected_rows;

  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT d.owner_id, d.document_id, 'expiry_warning',
         format('Policy "%s" version %s expires on %s (30-day warning).',
                d.title, v.version_number, v.expiry_date)
  FROM documents AS d
  JOIN document_versions AS v ON v.version_id = d.current_version_id
  WHERE d.document_status = 'active'
    AND v.version_status = 'approved'
    AND v.expiry_date = CURRENT_DATE + 30
    AND NOT EXISTS (
      SELECT 1 FROM notifications AS n
      WHERE n.user_id = d.owner_id
        AND n.document_id = d.document_id
        AND n.notification_type = 'expiry_warning'
        AND n.message = format('Policy "%s" version %s expires on %s (30-day warning).',
                               d.title, v.version_number, v.expiry_date)
    );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  changed_rows := changed_rows + affected_rows;

  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT d.owner_id, d.document_id, 'expiry_warning',
         format('Policy "%s" version %s expires on %s (7-day warning).',
                d.title, v.version_number, v.expiry_date)
  FROM documents AS d
  JOIN document_versions AS v ON v.version_id = d.current_version_id
  WHERE d.document_status = 'active'
    AND v.version_status = 'approved'
    AND v.expiry_date = CURRENT_DATE + 7
    AND NOT EXISTS (
      SELECT 1 FROM notifications AS n
      WHERE n.user_id = d.owner_id
        AND n.document_id = d.document_id
        AND n.notification_type = 'expiry_warning'
        AND n.message = format('Policy "%s" version %s expires on %s (7-day warning).',
                               d.title, v.version_number, v.expiry_date)
    );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  changed_rows := changed_rows + affected_rows;
  RETURN changed_rows;
END;
$$;

CREATE OR REPLACE FUNCTION fn_notify_document_dependents_on_retire()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  WITH RECURSIVE affected(document_id, path) AS (
    SELECT r.source_document_id,
           ARRAY[NEW.document_id, r.source_document_id]
    FROM document_references AS r
    WHERE r.target_document_id = NEW.document_id
    UNION ALL
    SELECT r.source_document_id,
           a.path || r.source_document_id
    FROM document_references AS r
    JOIN affected AS a ON r.target_document_id = a.document_id
    WHERE NOT r.source_document_id = ANY(a.path)
  )
  INSERT INTO notifications(user_id, document_id, notification_type, message)
  SELECT DISTINCT dependent.owner_id, dependent.document_id, 'dependency_warning',
         format('Referenced policy "%s" was retired; review dependent policy "%s".',
                NEW.title, dependent.title)
  FROM affected AS a
  JOIN documents AS dependent ON dependent.document_id = a.document_id;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accessible_document_ids(INT) TO docuguard_runtime;
GRANT EXECUTE ON FUNCTION verify_audit_chain() TO docuguard_runtime;
GRANT EXECUTE ON FUNCTION fn_expire_overrides() TO docuguard_runtime;
GRANT EXECUTE ON FUNCTION fn_expiry_sweep() TO docuguard_runtime;
