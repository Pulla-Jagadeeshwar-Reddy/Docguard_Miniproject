CREATE OR REPLACE VIEW v_document_status_summary AS
SELECT document_status,
       count(*)::BIGINT AS document_count
FROM documents
GROUP BY document_status;

CREATE OR REPLACE VIEW v_expiring_soon AS
SELECT d.document_id,
       d.title,
       c.category_name,
       v.version_id,
       v.version_number,
       v.expiry_date,
       (v.expiry_date - CURRENT_DATE) AS days_remaining,
       d.owner_id
FROM documents AS d
JOIN document_categories AS c ON c.category_id = d.category_id
JOIN document_versions AS v ON v.version_id = d.current_version_id
WHERE d.document_status = 'active'
  AND v.version_status = 'approved'
  AND v.expiry_date >= CURRENT_DATE
  AND v.expiry_date <= CURRENT_DATE + 30;

CREATE OR REPLACE VIEW v_access_activity AS
SELECT accessed_at::DATE AS activity_date,
       action,
       count(*)::BIGINT AS event_count,
       count(*) FILTER (WHERE is_break_glass)::BIGINT AS break_glass_count
FROM access_logs
GROUP BY accessed_at::DATE, action;

CREATE OR REPLACE VIEW v_break_glass_review_queue AS
SELECT ao.override_id,
       ao.user_id AS requester_id,
       requester.full_name AS requester_name,
       ao.document_id,
       d.title AS document_title,
       ao.justification,
       ao.granted_at,
       ao.expires_at,
       ao.status
FROM access_overrides AS ao
JOIN users AS requester ON requester.user_id = ao.user_id
JOIN documents AS d ON d.document_id = ao.document_id
WHERE ao.reviewed_by IS NULL;

GRANT SELECT ON v_document_status_summary, v_expiring_soon,
  v_access_activity, v_break_glass_review_queue TO docuguard_runtime;
