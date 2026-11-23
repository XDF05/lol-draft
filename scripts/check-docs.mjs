#!/usr/bin/env node
/**
 * Documentation consistency check (task 12.7).
 *
 * Verifies that:
 * - every relative Markdown link in the project documentation resolves;
 * - every documentation file is reachable from the README;
 * - `npm run <script>` examples exist in a package.json;
 * - referenced local scripts/config files exist;
 * - the README no longer advertises removed features.
 *
 * Run from the repository root:
 *
 *   node scripts/check-docs.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const README = join(ROOT, 'README.md');

const problems = [];
const checks = [];

async function walk(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path, predicate)));
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

const docFiles = [
  README,
  ...(await walk(join(ROOT, 'docs'), (path) => path.endsWith('.md'))),
  ...(await walk(join(ROOT, 'docker'), (path) => path.endsWith('.md'))),
].sort();

const read = (path) => readFile(path, 'utf8');

/** GitHub-style heading slugs, sufficient for the project's headings. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function headingSlugs(markdown) {
  const slugs = new Set();
  for (const line of markdown.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      slugs.add(slugify(match[1]));
    }
  }
  return slugs;
}

const linkPattern = /(!?)\[[^\]]*\]\(([^)]+)\)/g;

function extractLinks(markdown) {
  const links = [];
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[2].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
    links.push(target);
  }
  return links;
}

function isExternal(target) {
  return /^(https?:|mailto:|tel:|data:)/i.test(target);
}

// --- Relative links and anchors --------------------------------------------
const graph = new Map();

for (const file of docFiles) {
  const markdown = await read(file);
  const links = extractLinks(markdown);
  const relativeTargets = [];

  for (const target of links) {
    if (isExternal(target) || target.startsWith('#') || target === '') {
      continue;
    }

    const [pathPart, anchor] = target.split('#');
    if (!pathPart) {
      continue;
    }

    const resolved = resolve(dirname(file), decodeURIComponent(pathPart));
    const label = `${relative(ROOT, file)} -> ${target}`;

    if (!existsSync(resolved)) {
      problems.push(`broken link: ${label}`);
      continue;
    }

    if (pathPart.endsWith('.md')) {
      relativeTargets.push(resolved);
      if (anchor) {
        const targetMarkdown = await read(resolved);
        const slugs = headingSlugs(targetMarkdown);
        if (!slugs.has(anchor.toLowerCase())) {
          problems.push(`missing anchor: ${label}`);
        }
      }
    }
  }

  graph.set(file, relativeTargets);
}

// Reachability from the README (direct links and links followed transitively).
const reachable = new Set();
const queue = [README];
while (queue.length > 0) {
  const current = queue.shift();
  if (reachable.has(current)) {
    continue;
  }
  reachable.add(current);
  for (const next of graph.get(current) ?? []) {
    if (!reachable.has(next)) {
      queue.push(next);
    }
  }
}

for (const file of docFiles) {
  if (!reachable.has(file)) {
    problems.push(
      `unlinked documentation: ${relative(ROOT, file)} (not reachable from README.md)`,
    );
  }
}
checks.push(`checked ${docFiles.length} documentation files and their links`);

// --- Documented npm scripts -------------------------------------------------
const packageFiles = [
  join(ROOT, 'backend/package.json'),
  join(ROOT, 'frontend/package.json'),
];
const scripts = new Set();
for (const packageFile of packageFiles) {
  const pkg = JSON.parse(await read(packageFile));
  for (const name of Object.keys(pkg.scripts ?? {})) {
    scripts.add(name);
  }
}

const commandText = (
  await Promise.all(docFiles.map(async (file) => read(file)))
).join('\n');

for (const match of commandText.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
  if (!scripts.has(match[1])) {
    problems.push(`unknown npm script in documentation: npm run ${match[1]}`);
  }
}
checks.push('checked documented npm scripts against package.json');

// --- Referenced local files -------------------------------------------------
const ignoredPath = /(^|\/)(node_modules|\.next|dist|\.git)(\/|$)/;
const pathPattern =
  /(?:^|[\s`"'(])((?:docs|scripts|docker|backend|frontend|openspec)\/[A-Za-z0-9._@/-]+)/g;

for (const match of commandText.matchAll(pathPattern)) {
  let target = match[1].replace(/[.,;:]+$/, '');
  if (target.includes('*') || target.includes('<') || ignoredPath.test(target)) {
    continue;
  }
  // Environment templates are intentionally absent from a clean checkout.
  if (/(^|\/)\.env(\.|$)/.test(target)) {
    continue;
  }
  if (!existsSync(join(ROOT, target))) {
    problems.push(`documented path does not exist: ${target}`);
  }
}
checks.push('checked documented local file references');

// --- Removed features must not reappear in the README ----------------------
const readme = await read(README);
for (const term of ['Bo3', 'Bo5', 'Fearless']) {
  if (new RegExp(`\\b${term}\\b`, 'i').test(readme)) {
    problems.push(`README still advertises removed feature: ${term}`);
  }
}
checks.push('checked README for removed series/Fearless claims');

// --- Report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error('✖ documentation check failed:\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

for (const check of checks) {
  console.log(`✔ ${check}`);
}
console.log('✔ documentation check passed');
