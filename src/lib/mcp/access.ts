import { ToolError } from '@lovable.dev/mcp-js';
export const MCP_READ_ROLES = {
  leads: ['admin', 'office', 'sales'],
  customers: ['admin', 'office', 'sales', 'production_manager', 'accounting'],
  reports: ['admin', 'office', 'sales', 'production_manager'],
  invoices: ['admin', 'accounting'],
} as const;
export type ReadCapability = keyof typeof MCP_READ_ROLES;
export function requireReadAccess(roles: readonly string[], capability: ReadCapability) {
  if (!MCP_READ_ROLES[capability].some(role => roles.includes(role))) {
    throw new ToolError('Your team role does not allow access to these records.');
  }
}