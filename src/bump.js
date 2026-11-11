import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadManifest } from './manifest.js';
import { latestRecord } from './record.js';
import { listRepos } from './scan.js';
import { assertClean } from './worktree.js';
import { parseFailures, complete } from './allowlist.js';
import { listPackageRefs, listVersionlessRefs, setPackageRefVersion } from './xml-edit.js';

const exec = promisify(execFile);

async function trackedFiles(repoPath) {
  const out = (await exec('git', ['ls-files', '-z', '--', '*.csproj', '*.props', '*.targets'], { cwd: repoPath, maxBuffer: 1 << 26 })).stdout;
  const files = [];
  for (const f of out.split('\0').filter(Boolean)) if (!(await lstat(join(repoPath, f))).isSymbolicLink()) files.push(f);
  return files;
}

export function defaultSln(repoPath) {
  const found = [];
  for (const dir of [repoPath, join(repoPath, 'src')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.sln')) found.push(join(dir, f));
  }
  if (found.length !== 1) throw new Error(`${repoPath}: found ${found.length} .sln files in the root or src/, pass --sln <path>`);
  return found[0];
}

export function verdictOf(baseline, after) {
  const newFailures = after.failed.filter((f) => !baseline.failed.includes(f));
  if (newFailures.length || (baseline.built && !after.built)) return { verdict: 'worse', newFailures };
  const fixed = baseline.failed.some((f) => !after.failed.includes(f));
  if ((!baseline.built && after.built) || fixed) return { verdict: 'better', newFailures };
  return { verdict: 'same', newFailures };
}

export const dotnetTests = (sln) => async (repoPath, feedDir) => {
  let out;
  try {
    out = (await exec('dotnet', ['test', sln, '-c', 'Release', `-p:RestoreAdditionalProjectSources=${feedDir}`], { cwd: repoPath, maxBuffer: 1 << 28 })).stdout;
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  return { built: complete(out), failed: parseFailures(out) };
};

export async function bump({ manifestPath, repo, sln, runTests, allowNoBaseline = false }) {
  const manifest = loadManifest(manifestPath);
  const repos = await listRepos(manifest);
  const target = repos.find((r) => r.name === repo);
  if (!target) throw new Error(`unknown repo "${repo}", known: ${repos.map((r) => r.name).join(', ')}`);
  const record = await latestRecord(manifest.feed);
  if (!record) throw new Error(`no rc record in ${manifest.feed}, run rc first`);
  await assertClean(target.path);
  const run = runTests ?? dotnetTests(sln ?? defaultSln(target.path));

  const versions = new Map(record.packages.map((p) => [p.id.toLowerCase(), p.version]));
  const inFamily = (id) => Object.values(manifest.families).some((f) => id.startsWith(f.prefix));
  const baseline = await run(target.path, manifest.feed);
  if (!baseline.built && !allowNoBaseline) {
    throw new Error(`${repo}: the baseline run gave no test result (build or test host failed), nothing changed. Use --allow-no-baseline (option allowNoBaseline) to bump anyway`);
  }

  const changed = [];
  const unaligned = [];
  const unresolved = [];
  const noteUnresolved = (file, id, reason) => {
    if (!unresolved.some((u) => u.file === file && u.id === id)) unresolved.push({ file, id, reason });
  };
  for (const file of (await trackedFiles(target.path)).sort()) {
    const path = join(target.path, file);
    const before = await readFile(path, 'utf8');
    let xml = before;
    if (file.endsWith('.csproj')) {
      for (const id of listVersionlessRefs(before)) if (inFamily(id)) noteUnresolved(file, id, 'no version on the reference');
      for (const m of before.matchAll(/<PackageReference\b[^>]*\bUpdate\s*=\s*"([^"]+)"/g)) if (inFamily(m[1])) noteUnresolved(file, m[1], 'Update item');
      const seen = new Set();
      for (const { id, version } of listPackageRefs(before)) {
        if (inFamily(id) && version.startsWith('$(')) noteUnresolved(file, id, 'version is a property');
        if (seen.has(id.toLowerCase()) || version.startsWith('$(')) continue;
        seen.add(id.toLowerCase());
        const to = versions.get(id.toLowerCase());
        if (to === undefined) {
          if (inFamily(id)) unaligned.push({ file, id, version });
          continue;
        }
        const r = setPackageRefVersion(xml, id, to, { skipProperty: true });
        if (r.old.some((v) => v !== to)) changed.push({ file, id, old: r.old, new: to });
        xml = r.xml;
      }
    } else {
      for (const m of before.matchAll(/<PackageVersion\b[^>]*\bInclude\s*=\s*"([^"]+)"/g)) if (inFamily(m[1])) noteUnresolved(file, m[1], 'central package version');
    }
    if (xml !== before) await writeFile(path, xml);
  }

  const after = await run(target.path, manifest.feed);
  return { repo, unaligned, unresolved, changed, baseline, after, ...verdictOf(baseline, after) };
}
