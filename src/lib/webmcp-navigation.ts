export function requireVisibleSection(value: unknown, visible: readonly string[]): string {
  if (typeof value !== 'string' || !visible.includes(value)) throw new Error('This section is not available in your current CRM navigation.');
  return value;
}