import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, basename, dirname } from 'node:path';
import { loadManifest } from './manifest.js';
import { buildGraph } from './graph.js';
import { assertClean, createWorktree, removeWorktree, currentRef } from './worktree.js';
import { publishStaging, FeedConflictError } from './feed.js';
import { writeRecord, latestRecord, hasRecord } from './record.js';
import { resolvePin } from './pins.js';
import { nextStable, rcVersion, runStamp, publishedVersions } from './version.js';
import {
  getProjectVersion, setProjectVersion, setPackageRefVersion, listPackageRefs,
  setNuspecVersion, setNuspecDependency,
} from './xml-edit.js';

const exec = promisify(execFile);

export class CommandError extends Error {
  constructor(cmd, args, e) {
    const tail = `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter((l) => /error|fail/i.test(l)).slice(-12).join('\n');
    super(`${cmd} ${args.join(' ')} failed\n${tail || e.message}`);
    this.name = 'CommandError';
  }
}

async function run(cwd, cmd, args) {
  try {
    return await exec(cmd, args, { cwd, maxBuffer: 1 << 28, env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' } });
  } catch (e) {
    throw new CommandError(cmd, args, e);
  }
}

const exists = (p) => access(p).then(() => true, () => false);

async function csprojFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['obj', 'bin', 'Bin', 'node_modules', '.git'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await csprojFiles(p)));
    else if (e.name.endsWith('.csproj')) out.push(p);
  }
  return out;
}

export const buildArgs = (slnfRel, sources) => ['build', slnfRel, '-c', 'Release', `-p:RestoreAdditionalProjectSources=${sources.join('%3B')}`];

const globToRegex = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

export async function rc(opts) {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const published = opts.published ?? publishedVersions;
  const manifest = loadManifest(opts.manifestPath);
  const runId = runStamp(now);
  if (await hasRecord(manifest.feed, runId)) throw new FeedConflictError([`records/${runId}.json`]);

  const work = await mkdtemp(join(tmpdir(), `rc-stack-${runId}-`));
  const staging = join(work, 'staging');
  await mkdir(staging);
  const worktrees = [];
  try {
    const trees = new Map();
    for (const repo of manifest.repos) {
      const ref = opts.refs?.[repo.name] ?? (await currentRef(repo.path));
      const wt = await createWorktree(repo.path, ref, join(work, repo.name));
      worktrees.push({ repo, path: wt.path });
      trees.set(repo.name, { ...wt, ref });
    }

    const refs = new Map();
    for (const repo of manifest.repos) {
      const ids = new Set();
      for (const pkg of repo.packages.filter((p) => p.platform === 'any')) {
        const file = join(trees.get(repo.name).path, pkg.project);
        if (!(await exists(file))) throw new Error(`${repo.name}: package ${pkg.id} project ${pkg.project} not found at ${trees.get(repo.name).ref}`);
        for (const r of listPackageRefs(await readFile(file, 'utf8'))) ids.add(r.id);
      }
      refs.set(repo.name, [...ids]);
    }
    const graph = buildGraph(manifest.repos, refs);

    let selected = graph.order;
    if (opts.from) {
      if (!graph.order.includes(opts.from)) throw new Error(`--from ${opts.from}: no such repo in the manifest`);
      selected = [opts.from, ...graph.dependents(opts.from)];
    }
    const toBuild = manifest.repos.filter((r) => selected.includes(r.name) && r.platform === 'any');
    for (const r of manifest.repos) if (selected.includes(r.name) && r.platform !== 'any') log(`skipping ${r.name}: needs ${r.platform}`);
    for (const r of toBuild) await assertClean(r.path);

    const latest = await latestRecord(manifest.feed);
    const idOwner = new Map();
    for (const r of manifest.repos) for (const p of r.packages) idOwner.set(p.id, r);
    const rebuilt = new Map();
    const builtVersion = new Map();
    const packed = [];
    const repoRecords = [];
    const sources = [staging];
    if (await exists(manifest.feed)) sources.push(manifest.feed);

    for (const repo of toBuild) {
      const wt = trees.get(repo.name);
      const buildPackages = repo.packages.filter((p) => p.platform === 'any');
      const localVersion = getProjectVersion(await readFile(join(wt.path, buildPackages[0].project), 'utf8'));
      const all = (await Promise.all(buildPackages.map((p) => published(p.id)))).flat();
      const version = rcVersion(nextStable(localVersion, all), now);
      rebuilt.set(repo.name, version);
      for (const p of buildPackages) builtVersion.set(p.id, version);
      log(`${repo.name}: ${version}`);

      const upstream = {};
      const idToOwner = new Map([...idOwner].map(([id, r]) => [id, r.name]));
      const pinFor = (id, kind) => {
        const pin = resolvePin({ id, repo: repo.name, kind, owners: idToOwner, built: builtVersion, rebuiltRepos: new Set(rebuilt.keys()), latest });
        if (pin?.fromRecord) upstream[pin.owner] = { version: pin.version, fromRecord: pin.fromRecord };
        return pin?.version ?? null;
      };

      const packageProjects = new Set(buildPackages.map((p) => join(wt.path, p.project)));
      for (const file of await csprojFiles(wt.path)) {
        const before = await readFile(file, 'utf8');
        let xml = before;
        if (packageProjects.has(file)) xml = setProjectVersion(xml, version);
        for (const { id } of listPackageRefs(xml)) {
          const pin = pinFor(id, 'csproj');
          if (pin) xml = setPackageRefVersion(xml, id, pin).xml;
        }
        if (xml !== before) await writeFile(file, xml);
      }

      const slnPath = join(wt.path, repo.solution);
      const slnf = join(dirname(slnPath), 'rc-stack.slnf');
      const inSln = [...buildPackages.map((p) => p.project), ...repo.tests].map((p) => relative(dirname(slnPath), join(wt.path, p)).replace(/\//g, '\\'));
      await writeFile(slnf, JSON.stringify({ solution: { path: basename(slnPath), projects: [...new Set(inSln)] } }, null, 2));
      log(`${repo.name}: build`);
      await run(wt.path, 'dotnet', buildArgs(relative(wt.path, slnf).replace(/\\/g, '/'), sources));
      for (const t of repo.tests) {
        log(`${repo.name}: test ${t}`);
        await run(wt.path, 'dotnet', ['test', join(wt.path, t), '-c', 'Release', '--no-build']);
      }

      for (const pkg of buildPackages) {
        const project = join(wt.path, pkg.project);
        if (pkg.pack === 'dotnet') {
          await run(wt.path, 'dotnet', ['pack', project, '-c', 'Release', '--no-build', '-o', staging]);
        } else {
          const dir = join(work, 'nuspec', pkg.id);
          await mkdir(dir, { recursive: true });
          let xml = await readFile(join(wt.path, pkg.nuspec), 'utf8');
          xml = setNuspecVersion(xml, version);
          for (const dep of xml.matchAll(/<dependency\b[^>]*\bid="([^"]+)"/g)) {
            const pin = pinFor(dep[1], 'nuspec');
            if (pin) xml = setNuspecDependency(xml, dep[1], pin).xml;
          }
          const nuspecFile = join(dir, basename(pkg.nuspec));
          await writeFile(nuspecFile, xml);
          for (const rule of pkg.lib) {
            const from = join(wt.path, rule.dir);
            const re = globToRegex(rule.glob);
            for (const f of (await readdir(from)).filter((n) => re.test(n))) {
              await mkdir(join(dir, 'lib', rule.tfm), { recursive: true });
              await cp(join(from, f), join(dir, 'lib', rule.tfm, f));
            }
          }
          await run(wt.path, 'dotnet', ['pack', project, '-c', 'Release', '--no-build', `-p:NuspecFile=${nuspecFile}`, `-p:NuspecBasePath=${dir}`, '-o', staging]);
        }
        packed.push({ id: pkg.id, version });
      }
      repoRecords.push({ name: repo.name, ref: wt.ref, sha: wt.sha, treeHash: wt.treeHash, version, rebuilt: true, upstream });
    }

    await publishStaging(staging, manifest.feed);
    const record = { runId, createdAt: now.toISOString(), origin: 'local', repos: repoRecords, packages: packed };
    await writeRecord(manifest.feed, record);
    return record;
  } finally {
    if (process.env.RC_STACK_KEEP) {
      log(`RC_STACK_KEEP set: leaving ${work} and its worktrees in place`);
    } else {
      for (const w of worktrees) await removeWorktree(w.repo.path, w.path).catch(() => {});
      await rm(work, { recursive: true, force: true });
    }
  }
}
