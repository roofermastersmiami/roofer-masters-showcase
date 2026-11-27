/**
 * Trusted tenant routing for unauthenticated public website intake.
 *
 * This value is server-only configuration. Never accept a company ID from a
 * browser form, query string, request header, or chat payload.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolvePublicLeadCompanyId(value: string | undefined): string {
  const companyId = value?.trim();
  if (!companyId || !UUID_PATTERN.test(companyId)) {
    throw new Error("Public lead intake is not configured for a company.");
  }
  return companyId;
}

export function getPublicLeadCompanyId(): string {
  return resolvePublicLeadCompanyId(process.env.CRM_PUBLIC_COMPANY_ID);
}
