-- tenant-audit: reviewed
-- Persist the selected accent independently from the full theme palette.
ALTER TABLE public.crm_company_branding ADD COLUMN IF NOT EXISTS theme_accent text NOT NULL DEFAULT 'magenta';
ALTER TABLE public.crm_company_branding DROP CONSTRAINT IF EXISTS crm_company_branding_theme_palette_check;
ALTER TABLE public.crm_company_branding ADD CONSTRAINT crm_company_branding_theme_palette_check CHECK (theme_palette IN ('default','executive-berry','modern-enterprise','canyon-corporate','midnight-teal','ocean-slate','royal-indigo','emerald-ledger','copperstone','arctic-blue','graphite-gold','crimson-executive','sage-stone','cobalt-professional','plum-luxe','monochrome-pro'));
ALTER TABLE public.crm_company_branding ADD CONSTRAINT crm_company_branding_theme_accent_check CHECK (theme_accent IN ('magenta','fuchsia','berry','navy','royal-blue','cobalt','teal','emerald','forest-green','purple','violet','plum','crimson','coral','orange','amber','gold','bronze','slate','graphite'));
