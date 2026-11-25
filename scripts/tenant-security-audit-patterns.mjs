export function hasPrivilegedPattern(source) {
  return [
    /SECURITY\s+DEFINER/i,
    /\bhas_(?:any_)?role\s*\(/i,
    /\bsupabaseAdmin\b/,
    /\.from\(["'][^"']+["']\)\s*\.(?:delete|update)\s*\(/,
    /\.rpc\(\s*["'](?:has_(?:any_)?role|grant_owner_role|set_team_role|delete_[^"']+|record_invoice_payment|settle_invoice_checkout)["']/i,
  ].some((pattern) => pattern.test(source));
}

export function isReviewed(source) {
  return /tenant-audit:\s*reviewed/i.test(source);
}
