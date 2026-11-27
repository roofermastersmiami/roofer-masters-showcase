-- Track the Florida Building Code edition against which a product approval
-- reference was reviewed. This does not assert compatibility with that edition.

ALTER TABLE public.roof_product_approvals
  ADD COLUMN code_edition text NOT NULL DEFAULT 'unknown'
    CHECK (code_edition IN ('2023_8th','2026_9th','legacy','unknown')),
  ADD COLUMN code_edition_source_url text
    CHECK (code_edition_source_url IS NULL OR (
      char_length(code_edition_source_url) <= 2048
      AND code_edition_source_url ~* '^https?://'
    )),
  ADD COLUMN code_edition_notes text NOT NULL DEFAULT ''
    CHECK (char_length(code_edition_notes) <= 2000);

ALTER TABLE public.roof_product_approvals
  ADD CONSTRAINT roof_product_approvals_code_edition_evidence_guard
  CHECK (code_edition = 'unknown' OR code_edition_source_url IS NOT NULL);

COMMENT ON COLUMN public.roof_product_approvals.code_edition IS
  'Edition explicitly stated by the approval source or documented reviewer. Unknown remains the safe default; this field is not a compatibility determination.';
