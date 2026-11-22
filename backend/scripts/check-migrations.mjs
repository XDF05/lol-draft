#!/usr/bin/env node
/**
 * Structural guard for the Prisma migrations folder.
 *
 * Prisma treats every directory under prisma/migrations/ as one migration and
 * aborts with P3015 ("Could not find the migration file at migration.sql")
 * as soon as one of them has no migration.sql. Git does not track empty
 * directories, so such a leftover never shows up in `git status` and only
 * breaks `prisma migrate deploy` at deploy time — after the earlier
 * migrations have already been applied.
 *
 * This check needs no database. Run it before applying migrations and in CI:
 *
 *   npm run db:check-migrations
 *
 * Exits 0 when the folder is well formed, 1 with a list of problems otherwise.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = resolve(
  fileURLToPath(new URL('../prisma/migrations', import.meta.url)),
);

/** Prisma migration folder names: <timestamp>_<snake_case_name>. */
const MIGRATION_DIR_PATTERN = /^\d{14}_[a-z0-9_]+$/;

const problems = [];
const notes = [];

let entries;
try {
  entries = await readdir(migrationsDir, { withFileTypes: true });
} catch {
  console.error(`✖ migrations folder not found: ${migrationsDir}`);
  process.exit(1);
}

const directories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const strayFiles = entries
  .filter((entry) => entry.isFile() && entry.name !== 'migration_lock.toml')
  .map((entry) => entry.name);

if (directories.length === 0) {
  problems.push('no migration directories found');
}

for (const directory of directories) {
  if (!MIGRATION_DIR_PATTERN.test(directory)) {
    problems.push(
      `${directory}: name must be <timestamp>_<snake_case_name> (e.g. 20261113025016_init)`,
    );
  }

  const sqlPath = join(migrationsDir, directory, 'migration.sql');
  let info;
  try {
    info = await stat(sqlPath);
  } catch {
    problems.push(
      `${directory}: missing migration.sql — "prisma migrate deploy" fails with P3015`,
    );
    continue;
  }

  if (!info.isFile()) {
    problems.push(`${directory}: migration.sql is not a regular file`);
    continue;
  }

  const sql = await readFile(sqlPath, 'utf8');
  if (!sql.trim()) {
    problems.push(`${directory}: migration.sql is empty`);
  }
}

if (strayFiles.length > 0) {
  notes.push(
    `stray files in the migrations folder (ignored by Prisma): ${strayFiles.join(', ')}`,
  );
}

if (problems.length > 0) {
  console.error('✖ prisma/migrations is not valid:\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nFix by restoring the missing migration.sql or removing the empty directory.',
  );
  process.exit(1);
}

console.log(
  `✔ prisma/migrations is valid (${directories.length} migration${directories.length === 1 ? '' : 's'}: ${directories.join(', ')})`,
);
for (const note of notes) {
  console.log(`  note: ${note}`);
}
