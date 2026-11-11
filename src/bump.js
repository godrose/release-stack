import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadManifest } from './manifest.js';
import { latestRecord } from './record.js';
import { listRepos, csprojFiles } from './scan.js';
import { assertClean } from './worktree.js';
import { parseFailures, hasSummary } from './allowlist.js';
import { listPackageRefs, setPackageRefVersion } from './xml-edit.js';

const exec = promisify(execFile);

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
  return { built: hasSummary(out), failed: parseFailures(out) };
};

export async function bump({ manifestPath, repo, sln, runTests }) {
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

  const changed = [];
  const unaligned = [];
  for (const path of await csprojFiles(target.path)) {
    const file = relative(target.path, path).split('\\').join('/');
    const before = await readFile(path, 'utf8');
    let xml = before;
    const seen = new Set();
    for (const { id, version } of listPackageRefs(before)) {
      if (seen.has(id.toLowerCase()) || version.startsWith('$(')) continue;
      seen.add(id.toLowerCase());
      const to = versions.get(id.toLowerCase());
      if (to === undefined) {
        if (inFamily(id)) unaligned.push({ file, id, version });
        continue;
      }
      const r = setPackageRefVersion(xml, id, to);
      if (r.old.some((v) => v !== to)) changed.push({ file, id, old: r.old, new: to });
      xml = r.xml;
    }
    if (xml !== before) await writeFile(path, xml);
  }

  const after = await run(target.path, manifest.feed);
  return { repo, unaligned, changed, baseline, after, ...verdictOf(baseline, after) };
}
