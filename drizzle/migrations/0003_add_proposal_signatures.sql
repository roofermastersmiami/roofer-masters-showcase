ALTER TABLE public.proposal_shares
  ADD COLUMN signed_name text,
  ADD COLUMN signed_at timestamptz,
  ADD COLUMN signature_data text;