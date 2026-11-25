import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hasPrivilegedPattern, isReviewed } from "./tenant-security-audit-patterns.mjs";

const base = process.env.GITHUB_BASE_REF;
if (!base) {
  console.log("Tenant security diff audit skipped outside pull-request builds.");
  process.exit(0);
}

const changed = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], {
  encoding: "utf8",
}).split("\n").filter(Boolean);

const candidates = changed.filter((path) =>
  /^(?:drizzle\/migrations\/.*\.sql|supabase\/migrations\/.*\.sql|src\/.*\.functions\.[cm]?[jt]sx?)$/.test(path),
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
