import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listRepos, scanRepo } from '../src/scan.js';
import { makeRepo, put, tmp, git } from './helpers.js';

const families = { Solid: { prefix: 'Solid.' }, Attest: { prefix: 'Attest.' }, LogoFX: { prefix: 'LogoFX.' } };
const proj = (own, refs) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework>${own ? `<Version>${own}</Version>` : ''}</PropertyGroup>
  <ItemGroup>
${refs}
  </ItemGroup>
</Project>
`;

test('pins in the attribute and child forms and an old outlier are listed per family, sorted', async () => {
  const dir = makeRepo({
    'a/a.csproj': proj('2.3.6', '<PackageReference Include="Solid.Core" Version="2.3.6" />\n<PackageReference Include="Attest.Tests.Core" Version="2.4.6" />\n<PackageReference Include="Other" Version="9.9.9" />'),
    'b/b.csproj': proj(null, '<PackageReference Include="Solid.Core"><Version>2.3.7-rc.202611111530</Version></PackageReference>\n<PackageReference Include="Solid.Practices.Modularity" Version="1.2.1-rc4" />'),
    'obj/skip.csproj': proj(null, '<PackageReference Include="Solid.Core" Version="0.0.1" />'),
  });
  const r = await scanRepo(dir, families);
  assert.deepEqual(r.pins, { Solid: ['1.2.1-rc4', '2.3.6', '2.3.7-rc.202611111530'], Attest: ['2.4.6'] });
  assert.equal(r.branch, 'main');
  assert.equal(r.dirty, 0);
  assert.equal(r.unresolved, 0);
});

test('a family reference without a literal version is counted as unresolved and does not throw', async () => {
  const dir = makeRepo({
    'a/a.csproj': proj(null, '<PackageReference Include="LogoFX.Core" />\n<PackageReference Include="Solid.Core" Version="$(SolidVersion)" />\n<PackageReference Include="LogoFX.Client.Core" Version="2.2.7" />'),
  });
  const r = await scanRepo(dir, families);
  assert.equal(r.unresolved, 2);
  assert.deepEqual(r.pins, { LogoFX: ['2.2.7'] });
});

test('dirty counts tracked changes only and own lists the distinct project versions', async () => {
  const dir = makeRepo({
    'a/a.csproj': proj('2.2.7', ''),
    'b/b.csproj': proj('2.2.8', ''),
    'c/c.csproj': proj(null, ''),
    'd/d.csproj': proj('2.2.7', ''),
  });
  put(dir, 'untracked.txt', 'x\n');
  assert.equal((await scanRepo(dir, families)).dirty, 0);
  put(dir, 'a/a.csproj', proj('2.2.7', '<!-- edit -->'));
  const r = await scanRepo(dir, families);
  assert.equal(r.dirty, 1);
  assert.deepEqual(r.own, ['2.2.7', '2.2.8']);
});

test('a repo with no csproj files scans to empty pins without an error', async () => {
  const r = await scanRepo(makeRepo({ 'README.md': 'x\n' }), families);
  assert.deepEqual([r.pins, r.own, r.unresolved], [{}, [], 0]);
});

test('listRepos returns manifest repos and scanned children that are git repos, without duplicates', async () => {
  const root = tmp('root');
  const a = makeRepo();
  mkdirSync(join(root, 'plain'));
  const child = join(root, 'child');
  mkdirSync(child);
  git(child, 'init', '-q', '-b', 'main');
  const manifest = { repos: [{ name: 'LibA', path: a }, { name: 'child-by-manifest', path: child }], scan: [root] };
  const repos = await listRepos(manifest);
  assert.deepEqual(repos.map((r) => r.name), ['child-by-manifest', 'LibA']);
  assert.equal(repos.filter((r) => r.path === child).length, 1);
});

test('a range or two-part version does not break the sort when a family has two values', async () => {
  const dir = makeRepo({
    'a/a.csproj': proj('2.1', '<PackageReference Include="Solid.Core" Version="2.3.*" />'),
    'b/b.csproj': proj('2.2.7', '<PackageReference Include="Solid.Core" Version="2.3.6" />'),
  });
  const r = await scanRepo(dir, families);
  assert.deepEqual(r.pins.Solid.sort(), ['2.3.*', '2.3.6']);
  assert.deepEqual(r.own.sort(), ['2.1', '2.2.7']);
});
