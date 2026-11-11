// Throwaway spike: can `dotnet pack` reproduce the published 2.3.6 / 2.4.6 packages?
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';
import { comparePackages } from '../../src/parity.js';

const repos = [
  { name: 'Solid', path: join(homedir(), 'Workspace/Solid'), version: '2.3.6' },
  { name: 'Attest', path: join(homedir(), 'Workspace/Attest'), version: '2.4.6' },
];
const out = {};
const cosmetic = (f) => /\.(pdb|xml|deps\.json)$/.test(f);
const relax = (r) => { r.onlyInA = r.onlyInA.filter((f) => !cosmetic(f)); r.onlyInB = r.onlyInB.filter((f) => !cosmetic(f)); r.same = !r.onlyInA.length && !r.onlyInB.length && !r.depsDiff.length; return r; };
const errText = (e) => String(e.stdout || e.stderr || e.message).split("\n").filter((l) => /error|Error/.test(l)).slice(0, 3).join(" | ").slice(0, 500);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', maxBuffer: 1 << 28, ...opts }).toString();

async function download(id, version, dest) {
  const l = id.toLowerCase();
  const res = await fetch(`https://api.nuget.org/v3-flatcontainer/${l}/${version}/${l}.${version}.nupkg`);
  if (!res.ok) return null;
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

for (const repo of repos) {
  const wt = mkdtempSync(join(tmpdir(), `pp-${repo.name}-`));
  rmSync(wt, { recursive: true });
  sh('git', ['-C', repo.path, 'worktree', 'add', '--detach', wt, 'HEAD']);
  const work = mkdtempSync(join(tmpdir(), 'pp-out-'));
  const slnPath = join(wt, 'src', `${repo.name}.sln`);
  try { sh('dotnet', ['build', slnPath, '-c', 'Release', '-v', 'q']); } catch (e) { out[`${repo.name}:solution-build`] = { projects: [], verdict: 'partial: ' + errText(e).slice(0, 160) }; }
  const packDir = join(wt, 'devops/pack');
  for (const dirName of readdirSync(packDir)) {
    const dir = join(packDir, dirName);
    if (!existsSync(join(dir, 'pack.bat'))) continue;
    const nuspecFile = readdirSync(join(dir, 'contents')).find((f) => f.endsWith('.nuspec'));
    const nuspecPath = join(dir, 'contents', nuspecFile);
    const nuspec = readFileSync(nuspecPath, 'utf8');
    const id = /<id>([^<]+)<\/id>/.exec(nuspec)[1];
    const copies = [...readFileSync(join(dir, 'pack.bat'), 'utf8').matchAll(/robocopy\s+(\S+)\s+(\S+)\s+(\S+)/gi)].map((m) => ({ dir: m[1].replace(/^(\.\.\/)+/, ''), tfm: m[2], glob: m[3] }));
    const projects = [...new Set(copies.map((c) => c.glob.replace(/\.(\*|dll|xml|deps\.json)$/i, '')))];
    const res = { id, repo: repo.name, packDir: dirName, nuspecPath: `devops/pack/${dirName}/contents/${nuspecFile}`, copies, projects, tfms: [...new Set(copies.map((c) => c.tfm))] };
    out[id] = res;
    const published = await download(id, repo.version, join(work, `${id}.published.nupkg`));
    if (!published) { res.verdict = 'new (not published)'; continue; }
    // attempt 1: dotnet pack of the single project
    const csproj = (p) => join(wt, 'src', p, `${p}.csproj`);
    if (projects.length === 1 && existsSync(csproj(projects[0]))) {
      try {
        const o = join(work, `${id}-dotnet`);
        sh('dotnet', ['pack', csproj(projects[0]), '-c', 'Release', '--no-build', '-o', o, '-v', 'q']);
        const nupkg = join(o, readdirSync(o).find((f) => f.endsWith('.nupkg') && !f.endsWith('.symbols.nupkg')));
        res.dotnet = relax(await comparePackages(published, nupkg));
        if (res.dotnet.same) { res.verdict = 'dotnet'; continue; }
      } catch (e) { res.dotnet = { error: errText(e) }; }
    }
    // attempt 2: the nuspec through dotnet pack -p:NuspecFile
    try {
      const staging = join(work, `${id}-nuspec`);
      mkdirSync(staging, { recursive: true });
      cpSync(join(dir, 'contents'), staging, { recursive: true });
      rmSync(join(staging, 'lib'), { recursive: true, force: true });
      for (const c of copies) {
        const srcDir = join(wt, c.dir);
        const dest = join(staging, 'lib', c.tfm);
        mkdirSync(dest, { recursive: true });
        const pat = new RegExp('^' + c.glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
        for (const f of readdirSync(srcDir)) if (pat.test(f)) cpSync(join(srcDir, f), join(dest, f));
      }
      const host = existsSync(csproj(projects[0])) ? csproj(projects[0]) : null;
      const o = join(work, `${id}-nuspecout`);
      sh('dotnet', ['pack', host, '-c', 'Release', '--no-build', `-p:NuspecFile=${join(staging, nuspecFile)}`, `-p:NuspecBasePath=${staging}`, '-o', o, '-v', 'q']);
      const nupkg = join(o, readdirSync(o).find((f) => f.endsWith('.nupkg') && !f.endsWith('.symbols.nupkg')));
      res.nuspec = relax(await comparePackages(published, nupkg));
      res.verdict = res.nuspec.same ? 'nuspec' : 'blocked';
    } catch (e) { res.nuspec = { error: errText(e) }; res.verdict = 'blocked'; }
  }
  sh('git', ['-C', repo.path, 'worktree', 'remove', '--force', wt]);
}
writeFileSync(join(process.argv[2] ?? '.', 'pack-parity.json'), JSON.stringify(out, null, 2));
for (const [id, r] of Object.entries(out)) console.log(id.padEnd(40), (r.verdict ?? '?').padEnd(22), r.projects.join(','));
