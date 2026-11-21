export const TEAM_ROLES = ['admin', 'office', 'sales', 'production_manager', 'crew', 'accounting'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const ROLE_LABELS: Record<TeamRole, string> = { admin: 'Owner', office: 'Office', sales: 'Sales', production_manager: 'Production manager', crew: 'Crew', accounting: 'Accounting' };
type R = Exclude<TeamRole, 'admin'>;
/** Which roles (besides the owner, who sees everything) may open each CRM section. Mirrors database rules. */
export const SECTION_ROLES: Record<string, readonly R[]> = {
  '': ['office', 'sales', 'production_manager', 'accounting'],
  pipeline: ['office', 'sales'], submissions: ['office', 'sales'], chat: ['office', 'sales'],
  customers: ['office', 'sales', 'production_manager', 'accounting'], properties: ['office', 'sales', 'production_manager', 'accounting'],
  followups: ['office', 'sales', 'production_manager'],
  measurements: ['office', 'sales', 'production_manager'],
  estimates: ['office', 'sales'], proposals: ['office', 'sales'],
  'detailed-estimator': ['accounting'], prices: ['accounting'],
  jobs: ['office', 'production_manager', 'accounting'],
  invoices: ['accounting'], sales: ['accounting'], expenses: ['accounting'], financials: ['accounting'],
  instant: [], content: [], team: [],
  'my-jobs': ['crew'],
};
export function canOpen(roles: readonly string[], section: string) {
  if (roles.includes('admin')) return section !== 'my-jobs';
  return (SECTION_ROLES[section] ?? []).some(r => roles.includes(r));
}
export const seesMoney = (roles: readonly string[]) => roles.includes('admin') || roles.includes('accounting');
