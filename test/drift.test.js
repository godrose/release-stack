import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { drift, formatDrift } from '../src/drift.js';
import { writeRecord } from '../src/record.js';
import { makeRepo, put, tmp, git } from './helpers.js';

const proj = (own, refs) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>${own ? `<Version>${own}</Version>` : ''}</PropertyGroup>
  <ItemGroup>${refs}</ItemGroup>
</Project>
`;
const ref = (id, v) => `<PackageReference Include="${id}" Version="${v}" />`;
const RC = '2.3.7-rc.202611111530';

async function setup() {
  const feed = tmp('feed');
  await writeRecord(feed, { runId: '202611111530', createdAt: '2026-11-11T15:30:00.000Z', origin: 'local', repos: [], packages: [{ id: 'Solid.Core', version: RC }, { id: 'Attest.Tests.Core', version: '2.4.7-rc.202611111530' }] });
  const root = tmp('root');
  const mk = (name, files) => {
    const d = join(root, name);
    mkdirSync(d);
    git(d, 'init', '-q', '-b', 'main');
    for (const [rel, text] of Object.entries(files)) put(d, rel, text);
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'init');
    return d;
  };
  mk('fresh', { 'a/a.csproj': proj('2.2.8', ref('Solid.Core', RC) + ref('Attest.Tests.Core', '2.4.7-rc.202611111530') + ref('LogoFX.Core', '2.2.7')) });
  mk('old', { 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2') + ref('LogoFX.Core', '2.2.2')) });
  const mixed = mk('mixed', { 'a/a.csproj': proj('2.2.7', ref('Solid.Core', RC)), 'b/b.csproj': proj('2.2.7', ref('Solid.Practices.IoC', '2.3.6')) });
  mk('docs', { 'README.md': 'x\n' });
  mk('own-only', { 'a/a.csproj': proj('2.2.2', '') });
  mkdirSync(join(root, 'not-a-repo'));
  put(mixed, 'a/a.csproj', proj('2.2.7', ref('Solid.Core', RC) + '<!-- edit -->'));
  const manifestPath = join(tmp('manifest'), 'stack.json');
  writeFileSync(manifestPath, JSON.stringify({
    feed,
    families: { Solid: { prefix: 'Solid.' }, Attest: { prefix: 'Attest.' }, LogoFX: { prefix: 'LogoFX.', anchor: 'LogoFX.Core' } },
    scan: [root],
    repos: [{ name: 'Lib', path: makeRepo({ 'x.txt': 'x\n' }), platform: 'any', solution: 'x.sln', tests: [], packages: [] }],
  }));
  return { manifestPath };
}
const published = async () => ['2.2.2', '2.2.7'];

test('rows say current, lagging, unaligned or none and keep the dirty count', async () => {
  const { manifestPath } = await setup();
  const { rows } = await drift({ manifestPath, published });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.fresh.status, 'current');
  assert.equal(by.old.status, 'lagging');
  assert.equal(by.docs.status, 'none');
  assert.equal(by['own-only'].status, 'none', 'no family pins is none, not current');
  assert.equal(by.mixed.status, 'unaligned');
  assert.equal(by.mixed.dirty, 1);
  assert.ok(!('not-a-repo' in by), 'a folder without .git is skipped');
  assert.ok('Lib' in by, 'a manifest repo is listed');
});

test('a family with two pins is unaligned even when one equals the current stack', async () => {
  const { manifestPath } = await setup();
  const { rows } = await drift({ manifestPath, published });
  const mixed = rows.find((r) => r.name === 'mixed');
  assert.deepEqual(mixed.versions.Solid, ['2.3.6', RC]);
});

test('a repo with two own versions is unaligned', async () => {
  const { manifestPath } = await setup();
  const m = JSON.parse((await import('node:fs')).readFileSync(manifestPath, 'utf8'));
  const d = join(m.scan[0], 'two-own');
  mkdirSync(d);
  git(d, 'init', '-q', '-b', 'main');
  put(d, 'a/a.csproj', proj('2.2.7', ref('Solid.Core', RC)));
  put(d, 'b/b.csproj', proj('2.2.8', ref('Solid.Core', RC)));
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'init');
  const { rows } = await drift({ manifestPath, published });
  assert.equal(rows.find((r) => r.name === 'two-own').status, 'unaligned');
});

test('the table names every repo, the stack line and the statuses', async () => {
  const { manifestPath } = await setup();
  const text = formatDrift(await drift({ manifestPath, published }));
  for (const word of ['fresh', 'old', 'mixed', 'docs', 'Lib', 'lagging', 'unaligned', 'current', 'none', 'Solid 2.3.7-rc.202611111530', 'LogoFX 2.2.7']) assert.ok(text.includes(word), word);
});
