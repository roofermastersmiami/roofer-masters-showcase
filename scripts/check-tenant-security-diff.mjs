import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const base = process.env.GITHUB_BASE_REF;
if (!base) {
  console.log("Tenant security diff audit skipped outside pull-request builds.");
  process.exit(0);
}

function hasPrivilegedPattern(source) {
  return [
    /SECURITY\\s+DEFINER/i,
    /\\bhas_(?:any_)?role\\s*\\(/i,
    /\\bsupabaseAdmin\\b/,
    /\\.from\\(["'][^"']+["']\\)\\s*\\.(?:delete|update)\\s*\\(/,
    /\\.rpc\\(["'](?:grant_owner_role|set_team_role|delete_[^"']+|record_invoice_payment|settle_invoice_checkout)["']/i,
  ].some((pattern) => pattern.test(source));
}

function isReviewed(source) {
  return /tenant-audit:\\s*reviewed/i.test(source);
}

const changed = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD"], {
  encoding: "utf8",
}).split("\\n").filter(Boolean);

const candidates = changed.filter((path) =>
  /^(?:drizzle\\/migrations\\/.*\\.sql|supabase\\/migrations\\/.*\\.sql|src\\/.*\\.functions\\.[cm]?[jt]sx?)$/.test(path),
);
const findings = [];
for (const path of candidates) {
  const source = await readFile(path, "utf8");
  if (hasPrivilegedPattern(source) && !isReviewed(source)) findings.push(path);
}

if (findings.length) {
  console.error("Tenant-security review required for newly changed privileged code:");
  for (const path of findings) console.error(`- ${path}`);
  console.error("After an explicit security review, add a nearby 'tenant-audit: reviewed' annotation and explain the scope in the PR.");
  process.exit(1);
}
console.log(`Tenant-security diff audit passed (${candidates.length} changed SQL/server-function files checked).`);

export { hasPrivilegedPattern, isReviewed };
