-- Separa aporte patrono CCSS vs otros (INS, etc.) en reglas de nómina y planillas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payroll_nomina_contribution_rules'
      AND column_name = 'employer_pct_of_gross'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payroll_nomina_contribution_rules'
      AND column_name = 'employer_ccss_pct_of_gross'
  ) THEN
    ALTER TABLE payroll_nomina_contribution_rules
      RENAME COLUMN employer_pct_of_gross TO employer_ccss_pct_of_gross;
  END IF;
END $$;

ALTER TABLE payroll_nomina_contribution_rules
  ADD COLUMN IF NOT EXISTS employer_other_pct_of_gross numeric(8, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll_nomina_contribution_rules.employer_ccss_pct_of_gross IS
  'Porcentaje del salario bruto a cargo del patrono por CCSS.';
COMMENT ON COLUMN payroll_nomina_contribution_rules.employer_other_pct_of_gross IS
  'Porcentaje del salario bruto a cargo del patrono por otros cargos (INS, etc.).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payroll_slips'
      AND column_name = 'employer_pct_snapshot'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payroll_slips'
      AND column_name = 'employer_ccss_pct_snapshot'
  ) THEN
    ALTER TABLE payroll_slips
      RENAME COLUMN employer_pct_snapshot TO employer_ccss_pct_snapshot;
  END IF;
END $$;

ALTER TABLE payroll_slips
  ADD COLUMN IF NOT EXISTS employer_other_amount numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE payroll_slips
  ADD COLUMN IF NOT EXISTS employer_other_pct_snapshot numeric(8, 4);

COMMENT ON COLUMN payroll_slips.employer_ccss_amount IS 'Monto CCSS a cargo del patrono en el periodo.';
COMMENT ON COLUMN payroll_slips.employer_other_amount IS 'Otros montos a cargo del patrono (INS, etc.) en el periodo.';

-- Alinear costo patrono histórico: bruto + CCSS patrono + otros patrono.
UPDATE payroll_slips
SET total_employer_liability = ROUND(
      (
        COALESCE(gross_total, 0)
        + COALESCE(employer_ccss_amount, 0)
        + COALESCE(employer_other_amount, 0)
      )::numeric,
      2
    )
WHERE total_employer_liability IS DISTINCT FROM ROUND(
      (
        COALESCE(gross_total, 0)
        + COALESCE(employer_ccss_amount, 0)
        + COALESCE(employer_other_amount, 0)
      )::numeric,
      2
    );
