ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'office';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'crew';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accounting';
ALTER TABLE public.roof_jobs ADD COLUMN IF NOT EXISTS assigned_user_ids uuid[] NOT NULL DEFAULT '{}';