// One-off: turn docs/findings/pack-parity.json plus each repo's test-all.bat into stack.json.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(readFileSync(join(here, '../../docs/findings/pack-parity.json'), 'utf8'));
const repos = [
  { name: 'Solid', solution: 'src/Solid.sln' },
  { name: 'Attest', solution: 'src/Attest.sln' },
];
const SKIP_TESTS = ['IntegrationTests.App', 'Attest.Fake.FakeItEasy.Tests'];
const manifest = {
  feed: '~/Workspace/packages/rc-feed',
  families: { Solid: { prefix: 'Solid.' }, Attest: { prefix: 'Attest.' }, LogoFX: { prefix: 'LogoFX.', anchor: 'LogoFX.Core' } },
  scan: ['~/Workspace/logofx-project'],
  repos: [],
};
for (const r of repos) {
  const testAll = readFileSync(join(homedir(), 'Workspace', r.name, 'devops/test/test-all.bat'), 'utf8');
  const tests = [...testAll.matchAll(/call test-(?:specs|tests)-single\.bat\s+(\S+)/g)].map((m) => `src/${m[1]}/${m[1]}.csproj`).filter((p) => !SKIP_TESTS.some((s) => p.includes(s)));
  const packages = Object.entries(results)
    .filter(([, v]) => v.repo === r.name)
    .map(([id, v]) => {
      const project = `src/${v.projects[0]}/${v.projects[0]}.csproj`;
      if (v.verdict === 'dotnet' && id === v.projects[0]) return { id, project, pack: 'dotnet' };
      const contents = join(homedir(), 'Workspace', r.name, 'devops/pack', v.packDir, 'contents');
      const nuspec = `devops/pack/${v.packDir}/contents/${readdirSync(contents).find((f) => f.endsWith('.nuspec'))}`;
      const p = { id, project, pack: 'nuspec', nuspec, lib: v.copies };
      if (v.verdict === 'blocked') p.platform = 'windows';
      return p;
    });
  manifest.repos.push({ name: r.name, git: `https://github.com/godrose/${r.name}.git`, path: `~/Workspace/${r.name}`, platform: 'any', solution: r.solution, tests, packages });
}
function logofx(name, path, git) {
  const root = join(homedir(), 'Workspace/logofx-project', path);
  const sln = readdirSync(join(root, 'src')).find((f) => f.endsWith('.sln'));
  const projects = readdirSync(join(root, 'src'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, 'src', e.name, e.name + '.csproj'))).map((e) => e.name);
  const packs = join(root, 'devops/pack');
  const packages = [];
  for (const dir of readdirSync(packs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const contents = join(packs, dir, 'contents');
    const nuspecFile = readdirSync(contents).find((f) => f.endsWith('.nuspec'));
    const id = /<id>([^<]+)<\/id>/.exec(readFileSync(join(contents, nuspecFile), 'utf8'))[1];
    const rules = [...readFileSync(join(packs, dir, 'pack.bat'), 'utf8').matchAll(/robocopy\s+\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => ({ dir: m[1], tfm: m[2], glob: m[3] }));
    const lib = rules.filter((l, i) => rules.findIndex((o) => o.dir === l.dir && o.tfm === l.tfm && o.glob === l.glob) === i);
    const prefix = lib[0].glob.replace(/\*$/, '').replace(/\.$/, '');
    const project = projects.find((p) => p === prefix) ?? projects.filter((p) => p.startsWith(prefix) && !/Specs|Tests/.test(p)).sort()[0] ?? projects.find((p) => p === id) ?? projects[0];
    const winOnly = lib.some((l) => !l.dir.includes('netstandard'));
    packages.push({ id, project: `src/${project}/${project}.csproj`, pack: 'nuspec', nuspec: `devops/pack/${dir}/contents/${nuspecFile}`, lib, ...(winOnly ? { platform: 'windows' } : {}) });
  }
  const testAll = join(root, 'devops/test/test-all.bat');
  const tests = existsSync(testAll) ? [...readFileSync(testAll, 'utf8').matchAll(/call test-(?:specs|tests)-single(?:\.bat)?\s+(\S+)/g)].map((m) => m[1]).filter((p) => !/Platform\.NET/.test(p)).map((p) => `src/${p}/${p}.csproj`) : [];
  return { name, git, path: `~/Workspace/logofx-project/${path}`, platform: 'any', solution: `src/${sln}`, tests, packages };
}
manifest.repos.push(logofx('LogoFX.Core', 'core', 'https://github.com/LogoFX/core.git'), logofx('LogoFX.Testing', 'testing', 'https://github.com/LogoFX/logofx-client-testing.git'));
manifest.remote = { source: 'https://nuget.pkg.github.com/godrose/index.json' };
writeFileSync(join(here, '../../stack.json'), JSON.stringify(manifest, null, 2) + '\n');
