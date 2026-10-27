-- Returns a 0-100 percentage for mandatory controls in one regulation.
-- A regulation with no mandatory controls returns 0 rather than misleadingly reporting 100%.
CREATE OR REPLACE FUNCTION fn_control_coverage_score(p_regulation_id INT)
RETURNS NUMERIC(5,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  total_mandatory INT;
  covered_mandatory INT;
BEGIN
  SELECT count(*)::INT,
         count(*) FILTER (WHERE is_covered)::INT
    INTO total_mandatory, covered_mandatory
  FROM v_control_coverage
  WHERE regulation_id = p_regulation_id
    AND is_mandatory;

  IF COALESCE(total_mandatory, 0) = 0 THEN
    RETURN 0.00;
  END IF;

  RETURN round((100.0 * covered_mandatory / total_mandatory)::NUMERIC, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_control_coverage_score(INT) TO docuguard_runtime;
