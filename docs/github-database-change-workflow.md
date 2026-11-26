# GitHub-managed database change workflow

Database changes may be delivered without Lovable credits through reviewed GitHub pull requests.

## Required workflow

1. Create a feature branch from the current default branch.
2. Add a new, sequential SQL migration under `drizzle/migrations/`.
3. Add the matching entry to `drizzle/migrations/meta/_journal.json` in the same commit.
4. Never edit or reorder an already-published migration or rewrite Git history.
5. Review SQL for least-privilege grants, RLS enabled (and forced where appropriate), cross-company access, SECURITY DEFINER safety, safe defaults, and rollback implications.
6. Add automated tests or a reproducible database validation script for each security-sensitive migration.
7. Run migration-journal validation, lint, typecheck, unit tests, and production build. SQL integration tests must run against a disposable database matching the target schema before merge.
8. Open a PR. Do not apply schema changes from a feature branch.
9. After merge, apply the migration using the repository's approved database deployment credentials/process. Never place database credentials in GitHub or browser code.
10. Verify deployed schema and RLS behavior using separate test identities before enabling dependent UI.

## Generated files and types

Files marked generated remain generated and must not be hand-edited. In particular, do not manually modify `src/integrations/supabase/types.ts`. Regenerate database types after the migration is applied using the approved Supabase type-generation process.

## Security release gate

A schema PR is not proof of deployment. A feature is not complete until the migration is applied and tests prove:
- unauthenticated access is denied;
- a member can read only their own company's row;
- a non-admin member cannot insert or update;
- an owner/admin can write their own company's row;
- forged company IDs cannot read or modify another company's row;
- service-role credentials are never exposed to browser code.
