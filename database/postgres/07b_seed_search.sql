-- All policies and regulation controls below are synthetic teaching examples.
-- Their MongoDB source text is in docs/demo-policies and contains no real patient data.

INSERT INTO documents (title, category_id, owner_id, mongo_doc_id, document_status)
SELECT seed.title, cat.category_id, u.user_id, seed.mongo_doc_id, 'draft'
FROM (VALUES
  ('Standard Precautions and Sharps Injury Response', 'Infection Control', 'doctor1@docuguard.local', 'demo-infection-control'),
  ('Patient Information Privacy and Minimum Necessary Access', 'Privacy', 'doctor1@docuguard.local', 'demo-patient-privacy'),
  ('Emergency Department Patient Identification', 'Patient Safety', 'doctor2@docuguard.local', 'demo-patient-identification'),
  ('Hand Hygiene for Clinical Staff', 'Infection Control', 'doctor1@docuguard.local', 'demo-hand-hygiene'),
  ('Hand Hygiene Quick Reference', 'Infection Control', 'doctor2@docuguard.local', 'demo-hand-hygiene-quick'),
  ('Medication Safety and Independent Checks', 'Medication Safety', 'doctor2@docuguard.local', 'demo-medication-safety'),
  ('Biomedical Waste Segregation', 'Waste Management', 'nurse1@docuguard.local', 'demo-biomedical-waste'),
  ('Emergency Code and Incident Communication', 'Emergency Preparedness', 'doctor1@docuguard.local', 'demo-emergency-code'),
  ('Visitor Access and Conduct', 'Administration', 'staff1@docuguard.local', 'demo-visitor-access'),
  ('Records Retention Schedule Seven Year Example', 'Records Management', 'admin1@docuguard.local', 'demo-retention-seven-year'),
  ('Records Retention Schedule Ten Year Example', 'Records Management', 'admin1@docuguard.local', 'demo-retention-ten-year'),
  ('Backup and Disaster Recovery', 'Emergency Preparedness', 'admin1@docuguard.local', 'demo-backup-recovery')
) AS seed(title, category_name, owner_email, mongo_doc_id)
JOIN document_categories cat ON cat.category_name = seed.category_name
JOIN users u ON u.email = seed.owner_email
WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.mongo_doc_id = seed.mongo_doc_id);

INSERT INTO document_versions (
  document_id, version_number, file_path, mongo_content_id, checksum,
  uploaded_by, effective_date, expiry_date, version_status
)
SELECT d.document_id, 1, seed.file_path, seed.mongo_content_id, seed.checksum,
       uploader.user_id, CURRENT_DATE + seed.effective_offset,
       CASE WHEN seed.expiry_offset IS NULL THEN NULL ELSE CURRENT_DATE + seed.expiry_offset END,
       'pending_review'
FROM (VALUES
  ('demo-infection-control', 'standard-precautions-and-sharps-injury-response.pdf', 'demo-content-infection-control-v1', repeat('1',64), 'doctor1@docuguard.local', -30, 335),
  ('demo-patient-privacy', 'patient-information-privacy-and-minimum-necessary-access.pdf', 'demo-content-patient-privacy-v1', repeat('2',64), 'doctor1@docuguard.local', -30, 335),
  ('demo-patient-identification', 'emergency-department-patient-identification.pdf', 'demo-content-patient-identification-v1', repeat('3',64), 'doctor2@docuguard.local', -30, 335),
  ('demo-hand-hygiene', 'hand-hygiene-for-clinical-staff.pdf', 'demo-content-hand-hygiene-v1', repeat('4',64), 'doctor1@docuguard.local', -30, 335),
  ('demo-hand-hygiene-quick', 'hand-hygiene-quick-reference.pdf', 'demo-content-hand-hygiene-quick-v1', repeat('5',64), 'doctor2@docuguard.local', -30, 335),
  ('demo-medication-safety', 'medication-safety-and-independent-checks.pdf', 'demo-content-medication-safety-v1', repeat('7',64), 'doctor2@docuguard.local', -30, 335),
  ('demo-biomedical-waste', 'biomedical-waste-segregation.pdf', 'demo-content-biomedical-waste-v1', repeat('8',64), 'nurse1@docuguard.local', -30, 335),
  ('demo-emergency-code', 'emergency-code-and-incident-communication.pdf', 'demo-content-emergency-code-v1', repeat('9',64), 'doctor1@docuguard.local', -30, 335),
  ('demo-visitor-access', 'visitor-access-and-conduct.pdf', 'demo-content-visitor-access-v1', repeat('a',64), 'staff1@docuguard.local', -30, 335),
  ('demo-retention-seven-year', 'records-retention-schedule-seven-year-example.pdf', 'demo-content-retention-seven-year-v1', repeat('b',64), 'admin1@docuguard.local', -3650, -1),
  ('demo-retention-ten-year', 'records-retention-schedule-ten-year-example.pdf', 'demo-content-retention-ten-year-v1', repeat('c',64), 'admin1@docuguard.local', -30, 20),
  ('demo-backup-recovery', 'backup-and-disaster-recovery.pdf', 'demo-content-backup-recovery-v1', repeat('d',64), 'admin1@docuguard.local', -30, 335)
) AS seed(mongo_doc_id, file_path, mongo_content_id, checksum, uploader_email, effective_offset, expiry_offset)
JOIN documents d ON d.mongo_doc_id = seed.mongo_doc_id
JOIN users uploader ON uploader.email = seed.uploader_email
WHERE NOT EXISTS (
  SELECT 1 FROM document_versions v
  WHERE v.document_id = d.document_id AND v.version_number = 1
);

-- Two different seeded Admins demonstrate the database maker-checker rule.
UPDATE document_versions v
SET version_status = 'approved', approved_by = reviewer.user_id, approved_at = now()
FROM documents d, users reviewer
WHERE v.document_id = d.document_id
  AND reviewer.email = 'admin2@docuguard.local'
  AND v.version_number = 1 AND v.version_status = 'pending_review'
  AND d.mongo_doc_id LIKE 'demo-%';

-- Seed one already-expired approved policy through the real expiry trigger.
SELECT fn_expiry_sweep();

-- Admins and Doctors can see all demo policies. Other roles receive deliberate grants.
INSERT INTO document_permissions (document_id, role_id, access_level, granted_by)
SELECT d.document_id, r.role_id, 'read', grantor.user_id
FROM documents d
JOIN users grantor ON grantor.email = 'admin1@docuguard.local'
JOIN roles r ON r.role_name = 'Admin'
WHERE d.mongo_doc_id LIKE 'demo-%'
ON CONFLICT (document_id, role_id, access_level) DO NOTHING;

INSERT INTO document_permissions (document_id, role_id, access_level, granted_by)
SELECT d.document_id, r.role_id, 'read', grantor.user_id
FROM documents d
JOIN users grantor ON grantor.email = 'admin1@docuguard.local'
JOIN roles r ON r.role_name = 'Doctor'
WHERE d.mongo_doc_id LIKE 'demo-%'
ON CONFLICT (document_id, role_id, access_level) DO NOTHING;

INSERT INTO document_permissions (document_id, role_id, access_level, granted_by)
SELECT d.document_id, r.role_id, 'read', grantor.user_id
FROM documents d
JOIN users grantor ON grantor.email = 'admin1@docuguard.local'
JOIN roles r ON (
  (r.role_name = 'Nurse' AND d.mongo_doc_id IN (
    'demo-infection-control','demo-patient-identification','demo-hand-hygiene',
    'demo-hand-hygiene-quick','demo-medication-safety',
    'demo-biomedical-waste','demo-emergency-code'
  )) OR
  (r.role_name = 'Staff' AND d.mongo_doc_id IN (
    'demo-patient-privacy','demo-visitor-access',
    'demo-retention-seven-year','demo-retention-ten-year'
  ))
)
WHERE d.mongo_doc_id LIKE 'demo-%'
ON CONFLICT (document_id, role_id, access_level) DO NOTHING;

INSERT INTO regulations (regulation_name, issuing_body, description) VALUES
  ('NABH', 'National Accreditation Board for Hospitals & Healthcare Providers', 'Illustrative education-only controls; not an official standards interpretation.'),
  ('JCI', 'Joint Commission International', 'Illustrative education-only controls; not an official standards interpretation.'),
  ('HIPAA', 'U.S. Department of Health and Human Services', 'Illustrative privacy controls; not legal advice.'),
  ('DPDP Act', 'Government of India', 'Illustrative data-protection controls; not legal advice.')
ON CONFLICT (regulation_name) DO NOTHING;

-- Generic labels are used instead of official clause numbers or copied regulatory text.
INSERT INTO controls (regulation_id, control_code, title, description, is_mandatory)
SELECT r.regulation_id, seed.control_code, seed.title, seed.description, true
FROM (VALUES
  ('NABH','EDU-01','Standard precautions','Maintain an approved standard-precautions policy.'),
  ('NABH','EDU-02','Patient identification','Document a patient-identification workflow.'),
  ('NABH','EDU-03','Hand hygiene','Maintain a hand-hygiene policy and training record.'),
  ('NABH','EDU-04','Medication safety','Document local medication safety review steps.'),
  ('NABH','EDU-05','Waste segregation','Document local waste segregation responsibilities.'),
  ('JCI','EDU-01','Patient identification','Illustrative patient-identification control.'),
  ('JCI','EDU-02','Infection prevention','Illustrative infection-prevention control.'),
  ('JCI','EDU-03','Incident communication','Document how local incidents are communicated.'),
  ('JCI','EDU-04','Evacuation readiness','Document facility evacuation responsibilities.'),
  ('JCI','EDU-05','Continuity planning','Document service continuity responsibilities.'),
  ('HIPAA','EDU-01','Minimum necessary access','Describe role-based access to sensitive information.'),
  ('HIPAA','EDU-02','Access accountability','Maintain records of policy and information access.'),
  ('HIPAA','EDU-03','Visitor privacy','Describe visitor conduct near protected information.'),
  ('HIPAA','EDU-04','Retention governance','Document an approved records retention schedule.'),
  ('HIPAA','EDU-05','Incident response','Document internal incident escalation.'),
  ('DPDP Act','EDU-01','Purpose documentation','Record why personal data is handled.'),
  ('DPDP Act','EDU-02','Access controls','Restrict information access by assigned role.'),
  ('DPDP Act','EDU-03','Retention review','Review retention periods through an approved process.'),
  ('DPDP Act','EDU-04','Incident handling','Document local privacy incident response.'),
  ('DPDP Act','EDU-05','Open illustrative gap','Reserved mandatory control with no mapped policy for the demo.')
) AS seed(regulation_name, control_code, title, description)
JOIN regulations r ON r.regulation_name = seed.regulation_name
ON CONFLICT (regulation_id, control_code) DO NOTHING;

-- The last DPDP control is intentionally left without a policy mapping.
INSERT INTO document_control_map (document_id, control_id, mapped_by)
SELECT d.document_id, c.control_id, admin.user_id
FROM (VALUES
  ('demo-infection-control','NABH','EDU-01'), ('demo-patient-identification','NABH','EDU-02'),
  ('demo-hand-hygiene','NABH','EDU-03'), ('demo-medication-safety','NABH','EDU-04'),
  ('demo-biomedical-waste','NABH','EDU-05'), ('demo-patient-identification','JCI','EDU-01'),
  ('demo-infection-control','JCI','EDU-02'), ('demo-emergency-code','JCI','EDU-03'),
  ('demo-emergency-code','JCI','EDU-04'), ('demo-backup-recovery','JCI','EDU-05'),
  ('demo-patient-privacy','HIPAA','EDU-01'), ('demo-patient-privacy','HIPAA','EDU-02'),
  ('demo-visitor-access','HIPAA','EDU-03'), ('demo-retention-ten-year','HIPAA','EDU-04'),
  ('demo-emergency-code','HIPAA','EDU-05'), ('demo-patient-privacy','DPDP Act','EDU-01'),
  ('demo-patient-privacy','DPDP Act','EDU-02'), ('demo-retention-ten-year','DPDP Act','EDU-03'),
  ('demo-emergency-code','DPDP Act','EDU-04')
) AS seed(mongo_doc_id, regulation_name, control_code)
JOIN documents d ON d.mongo_doc_id = seed.mongo_doc_id
JOIN regulations r ON r.regulation_name = seed.regulation_name
JOIN controls c ON c.regulation_id = r.regulation_id AND c.control_code = seed.control_code
JOIN users admin ON admin.email = 'admin1@docuguard.local'
ON CONFLICT (document_id, control_id) DO NOTHING;

-- A three-policy dependency cycle demonstrates the recursive query's path guard.
INSERT INTO document_references (source_document_id, target_document_id, reference_type)
SELECT src.document_id, dst.document_id, 'depends_on'
FROM (VALUES
  ('demo-emergency-code','demo-visitor-access'),
  ('demo-visitor-access','demo-backup-recovery'),
  ('demo-backup-recovery','demo-emergency-code')
) AS edge(source_key, target_key)
JOIN documents src ON src.mongo_doc_id = edge.source_key
JOIN documents dst ON dst.mongo_doc_id = edge.target_key
ON CONFLICT (source_document_id, target_document_id, reference_type) DO NOTHING;

-- Acknowledgments are version-based; pending users are computed in the view.
INSERT INTO policy_assignments (document_id, target_role_id, target_department_id, assigned_by, due_date)
SELECT d.document_id, r.role_id, NULL, admin.user_id, CURRENT_DATE + 14
FROM documents d JOIN roles r ON r.role_name = 'Nurse'
JOIN users admin ON admin.email = 'admin1@docuguard.local'
WHERE d.mongo_doc_id = 'demo-infection-control'
ON CONFLICT DO NOTHING;

INSERT INTO policy_assignments (document_id, target_role_id, target_department_id, assigned_by, due_date)
SELECT d.document_id, NULL, dep.department_id, admin.user_id, CURRENT_DATE + 14
FROM documents d JOIN departments dep ON dep.department_name = 'Administration'
JOIN users admin ON admin.email = 'admin1@docuguard.local'
WHERE d.mongo_doc_id = 'demo-patient-privacy'
ON CONFLICT DO NOTHING;
