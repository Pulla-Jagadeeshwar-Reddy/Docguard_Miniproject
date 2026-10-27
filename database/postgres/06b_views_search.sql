-- One row per regulatory control, with whether at least one currently valid policy covers it.
CREATE OR REPLACE VIEW v_control_coverage AS
SELECT r.regulation_id,
       r.regulation_name,
       r.issuing_body,
       c.control_id,
       c.control_code,
       c.title AS control_title,
       c.description AS control_description,
       c.is_mandatory,
       count(DISTINCT dcm.document_id)::INT AS mapped_document_count,
       count(DISTINCT d.document_id) FILTER (
         WHERE d.document_status = 'active'
           AND v.version_status = 'approved'
           AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
       )::INT AS valid_document_count,
       COALESCE(bool_or(
         d.document_id IS NOT NULL
         AND d.document_status = 'active'
         AND v.version_status = 'approved'
         AND (v.expiry_date IS NULL OR v.expiry_date >= CURRENT_DATE)
       ), false) AS is_covered
FROM regulations r
JOIN controls c ON c.regulation_id = r.regulation_id
LEFT JOIN document_control_map dcm ON dcm.control_id = c.control_id
LEFT JOIN documents d ON d.document_id = dcm.document_id
LEFT JOIN document_versions v ON v.version_id = d.current_version_id
                             AND v.document_id = d.document_id
GROUP BY r.regulation_id, r.regulation_name, r.issuing_body,
         c.control_id, c.control_code, c.title, c.description, c.is_mandatory;

-- Assignment-level acknowledgment status. Pending users are computed with an anti-join;
-- acknowledgments are version-specific, so a newly approved version resets completion naturally.
CREATE OR REPLACE VIEW v_ack_compliance AS
WITH eligible AS (
  SELECT pa.assignment_id,
         pa.document_id,
         d.title AS document_title,
         pa.target_role_id,
         tr.role_name AS target_role_name,
         pa.target_department_id,
         td.department_name AS target_department_name,
         pa.due_date,
         d.current_version_id AS version_id,
         u.user_id,
         u.full_name,
         u.department_id,
         u.role_id
  FROM policy_assignments pa
  JOIN documents d ON d.document_id = pa.document_id
  JOIN users u ON u.account_status = 'active'
    AND (pa.target_role_id IS NULL OR u.role_id = pa.target_role_id)
    AND (pa.target_department_id IS NULL OR u.department_id = pa.target_department_id)
  LEFT JOIN roles tr ON tr.role_id = pa.target_role_id
  LEFT JOIN departments td ON td.department_id = pa.target_department_id
  WHERE d.current_version_id IS NOT NULL
), completion AS (
  SELECT e.*,
         (a.ack_id IS NOT NULL) AS acknowledged
  FROM eligible e
  LEFT JOIN acknowledgments a
    ON a.assignment_id = e.assignment_id
   AND a.user_id = e.user_id
   AND a.version_id = e.version_id
)
SELECT assignment_id,
       document_id,
       document_title,
       target_role_id,
       target_role_name,
       target_department_id,
       target_department_name,
       due_date,
       version_id,
       count(*)::INT AS eligible_users,
       count(*) FILTER (WHERE acknowledged)::INT AS acknowledged_users,
       count(*) FILTER (WHERE NOT acknowledged)::INT AS pending_users,
       CASE WHEN count(*) = 0 THEN 0.00
            ELSE round(100.0 * count(*) FILTER (WHERE acknowledged) / count(*), 2)
       END::NUMERIC(5,2) AS completion_percent
FROM completion
GROUP BY assignment_id, document_id, document_title, target_role_id, target_role_name,
         target_department_id, target_department_name, due_date, version_id;

CREATE OR REPLACE VIEW v_ack_compliance_by_department AS
SELECT x.department_id,
       x.department_name,
       count(*)::INT AS eligible_assignments,
       count(*) FILTER (WHERE acknowledged)::INT AS acknowledged_assignments,
       count(*) FILTER (WHERE NOT acknowledged)::INT AS pending_assignments,
       CASE WHEN count(*) = 0 THEN 0.00
            ELSE round(100.0 * count(*) FILTER (WHERE acknowledged) / count(*), 2)
       END::NUMERIC(5,2) AS completion_percent
FROM (
  SELECT u.department_id, dep.department_name,
         pa.assignment_id,
         (a.ack_id IS NOT NULL) AS acknowledged
  FROM policy_assignments pa
  JOIN documents d ON d.document_id = pa.document_id AND d.current_version_id IS NOT NULL
  JOIN users u ON u.account_status = 'active'
    AND (pa.target_role_id IS NULL OR u.role_id = pa.target_role_id)
    AND (pa.target_department_id IS NULL OR u.department_id = pa.target_department_id)
  JOIN departments dep ON dep.department_id = u.department_id
  LEFT JOIN acknowledgments a ON a.assignment_id = pa.assignment_id
    AND a.user_id = u.user_id
    AND a.version_id = d.current_version_id
) x
JOIN departments dpt ON dpt.department_id = x.department_id
GROUP BY x.department_id, x.department_name;

CREATE OR REPLACE VIEW v_regulatory_coverage_summary AS
SELECT r.regulation_id,
       r.regulation_name,
       r.issuing_body,
       count(c.control_id)::INT AS total_controls,
       count(c.control_id) FILTER (WHERE c.is_mandatory)::INT AS mandatory_controls,
       count(c.control_id) FILTER (WHERE c.is_mandatory AND c.is_covered)::INT AS covered_mandatory_controls,
       count(c.control_id) FILTER (WHERE c.is_mandatory AND NOT c.is_covered)::INT AS mandatory_gaps,
       fn_control_coverage_score(r.regulation_id) AS coverage_percent
FROM regulations r
LEFT JOIN v_control_coverage c ON c.regulation_id = r.regulation_id
GROUP BY r.regulation_id, r.regulation_name, r.issuing_body;

GRANT SELECT ON v_control_coverage, v_ack_compliance,
  v_ack_compliance_by_department, v_regulatory_coverage_summary TO docuguard_runtime;
