import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { compareSemver } from './version.js';
import { listPackageRefs, listVersionlessRefs, hasProjectVersion, getProjectVersion } from './xml-edit.js';

const run = promisify(execFile);
const git = async (cwd, ...args) => (await run('git', args, { cwd, maxBuffer: 1 << 26 })).stdout;
const SKIP_DIRS = new Set(['obj', 'bin', 'Bin', 'node_modules', '.git']);
const exists = (p) => access(p).then(() => true, () => false);

export async function csprojFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await csprojFiles(p)));
    else if (e.name.endsWith('.csproj')) out.push(p);
  }
  return out;
}

const byVersion = (a, b) => compareSemver(a, b);
const familyOf = (id, families) => Object.entries(families).find(([, f]) => id.startsWith(f.prefix))?.[0] ?? null;

export async function scanRepo(repoPath, families) {
  const branch = (await git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'HEAD\n')).trim();
  const dirty = (await git(repoPath, 'status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean).length;
  const pins = {};
  const own = new Set();
  let unresolved = 0;
  for (const file of await csprojFiles(repoPath)) {
    const xml = await readFile(file, 'utf8');
    if (hasProjectVersion(xml)) own.add(getProjectVersion(xml));
    for (const { id, version } of listPackageRefs(xml)) {
      const fam = familyOf(id, families);
      if (!fam) continue;
      if (version.startsWith('$(')) unresolved += 1;
      else (pins[fam] ??= new Set()).add(version);
    }
    for (const id of listVersionlessRefs(xml)) if (familyOf(id, families)) unresolved += 1;
  }
  return {
    branch,
    dirty,
    own: [...own].sort(byVersion),
    pins: Object.fromEntries(Object.entries(pins).map(([k, v]) => [k, [...v].sort(byVersion)])),
    unresolved,
  };
}

export async function listRepos(manifest) {
  const found = new Map();
  for (const r of manifest.repos) found.set(r.path, { name: r.name, path: r.path });
  for (const root of manifest.scan ?? []) {
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(root, e.name);
      if (!(await exists(join(p, '.git'))) || found.has(p)) continue;
      found.set(p, { name: basename(p), path: p });
    }
  }
  return [...found.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
