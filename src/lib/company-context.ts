/**
 * Resolve a user's company context from membership rows returned by a trusted
 * server-side query. Never pass a client-selected company ID as the source.
 *
 * This is a pure policy primitive, not an authorization boundary by itself:
 * callers must query memberships with the authenticated user ID and enforce
 * company scope again in RLS/RPCs. The current CRM must not use this helper to
 * enable company switching before database isolation is deployed.
 */
export type CompanyMembershipRow = {
  company_id: string;
  user_id: string;
  role: string;
};

export type CompanyContextResolution =
  | { ok: true; companyId: string; role: string }
  | {
      ok: false;
      reason: "unauthenticated" | "no_membership" | "multiple_memberships" | "invalid_membership";
    };

export function resolveCompanyContext(
  authenticatedUserId: string | null | undefined,
  memberships: readonly CompanyMembershipRow[],
): CompanyContextResolution {
  if (!authenticatedUserId) return { ok: false, reason: "unauthenticated" };

  const ownMemberships = memberships.filter(
    (membership) => membership.user_id === authenticatedUserId,
  );

  if (ownMemberships.length === 0) return { ok: false, reason: "no_membership" };
  if (ownMemberships.length !== 1) return { ok: false, reason: "multiple_memberships" };

  const [membership] = ownMemberships;
  if (!membership.company_id || !membership.role) {
    return { ok: false, reason: "invalid_membership" };
  }

  return {
    ok: true,
    companyId: membership.company_id,
    role: membership.role,
  };
}
