// One-off: turn docs/findings/pack-parity.json plus each repo's test-all.bat into stack.json.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(readFileSync(join(here, '../../docs/findings/pack-parity.json'), 'utf8'));
const repos = [
  { name: 'Solid', solution: 'src/Solid.sln' },
  { name: 'Attest', solution: 'src/Attest.sln' },
];
const manifest = { feed: '~/Workspace/packages/rc-feed', repos: [] };
for (const r of repos) {
  const testAll = readFileSync(join(homedir(), 'Workspace', r.name, 'devops/test/test-all.bat'), 'utf8');
  const tests = [...testAll.matchAll(/call test-(?:specs|tests)-single\.bat\s+(\S+)/g)].map((m) => `src/${m[1]}/${m[1]}.csproj`);
  const packages = Object.entries(results)
    .filter(([, v]) => v.repo === r.name)
    .map(([id, v]) => {
      const project = `src/${v.projects[0]}/${v.projects[0]}.csproj`;
      if (v.verdict === 'dotnet') return { id, project, pack: 'dotnet' };
      const contents = join(homedir(), 'Workspace', r.name, 'devops/pack', v.packDir, 'contents');
      const nuspec = `devops/pack/${v.packDir}/contents/${readdirSync(contents).find((f) => f.endsWith('.nuspec'))}`;
      const p = { id, project, pack: 'nuspec', nuspec, lib: v.copies };
      if (v.verdict === 'blocked') p.platform = 'windows';
      return p;
    });
  manifest.repos.push({ name: r.name, path: `~/Workspace/${r.name}`, platform: 'any', solution: r.solution, tests, packages });
}
writeFileSync(join(here, '../../stack.json'), JSON.stringify(manifest, null, 2) + '\n');
