/**
 * Pure company-scoped team authorization rules.
 *
 * This module deliberately accepts already-verified membership rows. It does
 * not authenticate callers, query Supabase, or replace RLS/RPC authorization.
 * Wire it only after company membership and operational RLS are deployed.
 */
export const COMPANY_TEAM_ROLES = [
  "owner",
  "admin",
  "office",
  "sales",
  "production_manager",
  "crew",
  "accounting",
] as const;

export type CompanyTeamRole = (typeof COMPANY_TEAM_ROLES)[number];

export type CompanyTeamMembership = {
  user_id: string;
  company_id: string;
  role: CompanyTeamRole;
};

const MANAGEABLE_ROLES_BY_ADMIN: readonly CompanyTeamRole[] = [
  "office",
  "sales",
  "production_manager",
  "crew",
  "accounting",
];

export function isCompanyAdmin(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Owners can manage every non-owner membership. Company admins can manage
 * operational roles, but cannot promote/demote admins or transfer ownership.
 */
export function canManageCompanyMember(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
  nextRole?: CompanyTeamRole,
): boolean {
  if (!isCompanyAdmin(actorRole) || !targetRole || targetRole === "owner") return false;

  if (actorRole === "owner") return true;

  if (targetRole === "admin") return false;
  if (nextRole === "owner" || nextRole === "admin") return false;
  return MANAGEABLE_ROLES_BY_ADMIN.includes(targetRole as CompanyTeamRole);
}

/**
 * Crew assignment is valid only when every distinct requested user has a
 * crew membership in the same company. Duplicate IDs are rejected rather
 * than silently normalized so callers cannot conceal malformed payloads.
 */
export function canAssignCompanyCrew(input: {
  actorRole: string | null | undefined;
  companyId: string | null | undefined;
  requestedUserIds: readonly string[];
  memberships: readonly CompanyTeamMembership[];
}): boolean {
  const { actorRole, companyId, requestedUserIds, memberships } = input;

  if (!companyId || !isCompanyAdmin(actorRole) && actorRole !== "production_manager") {
    return false;
  }

  if (new Set(requestedUserIds).size !== requestedUserIds.length) return false;
  if (requestedUserIds.some((id) => !id)) return false;

  const crewInCompany = new Set(
    memberships
      .filter((membership) => membership.company_id === companyId && membership.role === "crew")
      .map((membership) => membership.user_id),
  );

  return requestedUserIds.every((userId) => crewInCompany.has(userId));
}
