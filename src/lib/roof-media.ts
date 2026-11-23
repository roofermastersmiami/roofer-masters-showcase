/** Reject malformed or traversal-style object keys before persisting roof media references. */
export function isSafeRoofMediaPath(path: string): boolean {
  if (!path || path.length > 300 || path.startsWith('/') || path.includes('\\\\')) return false;
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}
