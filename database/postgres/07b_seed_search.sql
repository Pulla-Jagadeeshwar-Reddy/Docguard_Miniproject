-- Illustrative, synthetic policy/regulation data for local demos only.
-- These rows match the files under docs/demo-policies and database/mongo/seed.js.

INSERT INTO documents (title, category_id, owner_id, mongo_doc_id, document_status)
SELECT seed.title, cat.category_id, u.user_id, seed.mongo_doc_id, 'draft'
FROM (VALUES
  ('Standard Precautions and Sharps Injury Response', 'Infection Control', 'doctor1@docuguard.local', 'demo-infection-control'),
  ('Patient Information Privacy and Minimum Necessary Access', 'Privacy', 'doctor1@docuguard.local', 'demo-patient-privacy'),
  ('Emergency Department Patient Identification', 'Patient Safety', 'doctor2@docuguard.local', 'demo-patient-identification')
) AS seed(title, category_name, owner_email, mongo_doc_id)
JOIN document_categories cat ON cat.category_name = seed.category_name
JOIN users u ON u.email = seed.owner_email
WHERE NOT EXISTS (
  SELECT 1 FROM documents d WHERE d.mongo_doc_id = seed.mongo_doc_id
);

INSERT INTO document_versions (
  document_id, version_number, file_path, mongo_content_id, checksum,
  uploaded_by, effective_date, expiry_date, version_status
)
SELECT d.document_id, 1, seed.file_path, seed.mongo_content_id, seed.checksum,
       u.user_id, CURRENT_DATE - 30, CURRENT_DATE + 335, 'pending_review'
FROM (VALUES
  ('demo-infection-control', 'docs/demo-policies/standard-precautions.md', 'demo-content-infection-control-v1', repeat('1', 64), 'doctor1@docuguard.local'),
  ('demo-patient-privacy', 'docs/demo-policies/patient-privacy.md', 'demo-content-patient-privacy-v1', repeat('2', 64), 'doctor1@docuguard.local'),
  ('demo-patient-identification', 'docs/demo-policies/patient-identification.md', 'demo-content-patient-identification-v1', repeat('3', 64), 'doctor2@docuguard.local')
) AS seed(mongo_doc_id, file_path, mongo_content_id, checksum, uploader_email)
JOIN documents d ON d.mongo_doc_id = seed.mongo_doc_id
JOIN users u ON u.email = seed.uploader_email
WHERE NOT EXISTS (
  SELECT 1 FROM document_versions v
  WHERE v.document_id = d.document_id AND v.version_number = 1
);

-- Approval is performed by a different user to exercise the maker-checker rule and core trigger.
UPDATE document_versions v
SET version_status = 'approved',
    approved_by = approver.user_id,
    approved_at = now()
FROM documents d,
     users approver
WHERE v.document_id = d.document_id
  AND approver.email = 'admin2@docuguard.local'
  AND v.version_number = 1
  AND v.version_status = 'pending_review'
  AND d.mongo_doc_id IN ('demo-infection-control', 'demo-patient-privacy', 'demo-patient-identification');

-- Read permissions are deliberately role-scoped for the permission-filtered search demo.
INSERT INTO document_permissions (document_id, role_id, access_level, granted_by)
SELECT d.document_id, r.role_id, 'read', admin.user_id
FROM documents d
JOIN users admin ON admin.email = 'admin1@docuguard.local'
JOIN roles r ON (
  (d.mongo_doc_id = 'demo-infection-control' AND r.role_name IN ('Admin', 'Doctor', 'Nurse')) OR
  (d.mongo_doc_id = 'demo-patient-privacy' AND r.role_name IN ('Admin', 'Doctor', 'Nurse', 'Staff')) OR
  (d.mongo_doc_id = 'demo-patient-identification' AND r.role_name IN ('Admin', 'Doctor', 'Nurse'))
)
WHERE d.mongo_doc_id IN ('demo-infection-control', 'demo-patient-privacy', 'demo-patient-identification')
ON CONFLICT (document_id, role_id, access_level) DO NOTHING;

INSERT INTO regulations (regulation_name, issuing_body, description) VALUES
  ('NABH', 'National Accreditation Board for Hospitals & Healthcare Providers', 'Illustrative accreditation mapping for the local demo; verify official standards before real use.'),
  ('JCI', 'Joint Commission International', 'Illustrative international accreditation mapping for the local demo; not an official interpretation.'),
  ('HIPAA', 'U.S. Department of Health and Human Services', 'Illustrative privacy-control mapping for education only; not legal advice.'),
  ('DPDP Act', 'Government of India', 'Illustrative India data-protection mapping for education only; not legal advice.')
ON CONFLICT (regulation_name) DO NOTHING;

INSERT INTO controls (regulation_id, control_code, title, description, is_mandatory)
SELECT r.regulation_id, seed.control_code, seed.title, seed.description, seed.is_mandatory
FROM (VALUES
  ('NABH', 'IC-01', 'Standard precautions', 'Staff follow documented standard precautions and sharps-injury response.', true),
  ('NABH', 'PS-01', 'Correct patient identification', 'Use approved identifiers before care and specimen collection.', true),
  ('JCI', 'IPSG-01', 'Identify patients correctly', 'Illustrative patient-identification control.', true),
  ('JCI', 'PCI-01', 'Infection prevention', 'Illustrative infection-prevention control.', true),
  ('HIPAA', 'PRIV-01', 'Minimum necessary access', 'Limit access to the minimum information needed for the task.', true),
  ('HIPAA', 'AUD-01', 'Access accountability', 'Maintain accountable records of policy/document access.', true),
  ('DPDP Act', 'DP-01', 'Purpose-limited handling', 'Handle personal data for a documented, legitimate purpose.', true),
  ('DPDP Act', 'DP-02', 'Access and disclosure controls', 'Restrict access and disclosure to authorized purposes.', true)
) AS seed(regulation_name, control_code, title, description, is_mandatory)
JOIN regulations r ON r.regulation_name = seed.regulation_name
ON CONFLICT (regulation_id, control_code) DO NOTHING;

INSERT INTO document_control_map (document_id, control_id, mapped_by)
SELECT d.document_id, c.control_id, admin.user_id
FROM (VALUES
  ('demo-infection-control', 'NABH', 'IC-01'),
  ('demo-patient-identification', 'NABH', 'PS-01'),
  ('demo-patient-identification', 'JCI', 'IPSG-01'),
  ('demo-infection-control', 'JCI', 'PCI-01'),
  ('demo-patient-privacy', 'HIPAA', 'PRIV-01'),
  ('demo-patient-privacy', 'HIPAA', 'AUD-01'),
  ('demo-patient-privacy', 'DPDP Act', 'DP-01'),
  ('demo-patient-privacy', 'DPDP Act', 'DP-02')
) AS seed(mongo_doc_id, regulation_name, control_code)
JOIN documents d ON d.mongo_doc_id = seed.mongo_doc_id
JOIN regulations r ON r.regulation_name = seed.regulation_name
JOIN controls c ON c.regulation_id = r.regulation_id AND c.control_code = seed.control_code
JOIN users admin ON admin.email = 'admin1@docuguard.local'
ON CONFLICT (document_id, control_id) DO NOTHING;

-- Example assignments. Pending status is derived from the absence of a current-version acknowledgment.
INSERT INTO policy_assignments (document_id, target_role_id, target_department_id, assigned_by, due_date)
SELECT d.document_id, r.role_id, NULL, admin.user_id, CURRENT_DATE + 14
FROM documents d
JOIN roles r ON r.role_name = 'Nurse'
JOIN users admin ON admin.email = 'admin1@docuguard.local'
WHERE d.mongo_doc_id = 'demo-infection-control'
ON CONFLICT DO NOTHING;

INSERT INTO policy_assignments (document_id, target_role_id, target_department_id, assigned_by, due_date)
SELECT d.document_id, NULL, dep.department_id, admin.user_id, CURRENT_DATE + 14
FROM documents d
JOIN departments dep ON dep.department_name = 'Administration'
JOIN users admin ON admin.email = 'admin1@docuguard.local'
WHERE d.mongo_doc_id = 'demo-patient-privacy'
ON CONFLICT DO NOTHING;
