import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationDir = new URL("../drizzle/migrations/", import.meta.url);
const journalPath = new URL("../drizzle/migrations/meta/_journal.json", import.meta.url);
const files = (await readdir(migrationDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const journal = JSON.parse(await readFile(journalPath, "utf8"));
const entries = journal.entries ?? [];
const errors = [];

if (files.length !== entries.length) {
  errors.push(`Found ${files.length} SQL migrations but ${entries.length} journal entries.`);
}

const seen = new Set();
let previousWhen = -Infinity;
for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  const expectedTag = files[index]?.replace(/\.sql$/, "");
  if (entry.idx !== index)
    errors.push(`Journal entry ${entry.tag} has idx ${entry.idx}; expected ${index}.`);
  if (!entry.tag || seen.has(entry.tag))
    errors.push(`Missing or duplicate migration tag at index ${index}.`);
  if (entry.tag !== expectedTag)
    errors.push(
      `Journal entry ${index} is ${entry.tag}; expected ${expectedTag ?? "no matching SQL file"}.`,
    );
  if (!Number.isFinite(entry.when) || entry.when <= previousWhen)
    errors.push(`Migration timestamps are not strictly increasing at ${entry.tag}.`);
  seen.add(entry.tag);
  previousWhen = entry.when;
}

for (const file of files) {
  const tag = file.replace(/\.sql$/, "");
  if (!seen.has(tag)) errors.push(`SQL migration ${file} is missing from the journal.`);
}

if (errors.length) {
  console.error("Migration journal validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} SQL migrations against the Drizzle journal.`);
}
