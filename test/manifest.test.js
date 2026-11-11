import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, ManifestError } from '../src/manifest.js';

function write(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
  const file = join(dir, 'stack.json');
  writeFileSync(file, JSON.stringify(obj));
  return file;
}

const good = () => ({
  feed: '~/feed',
  repos: [
    { name: 'Solid', path: '../Solid', platform: 'any', solution: 'src/Solid.sln', tests: ['src/A/A.csproj'],
      packages: [{ id: 'Solid.Core', project: 'src/Solid.Core/Solid.Core.csproj', pack: 'dotnet' }] },
    { name: 'Attest', path: '../Attest', platform: 'any', solution: 'src/Attest.sln', tests: [],
      packages: [{ id: 'Attest.Tests.Core', project: 'src/X/X.csproj', pack: 'nuspec', nuspec: 'devops/x.nuspec', lib: [{ dir: 'src/Bin/netstandard/Release', tfm: 'netstandard2.0', glob: 'X.*' }] }] },
  ],
});

test('a valid manifest loads and resolves paths', () => {
  const file = write(good());
  const m = loadManifest(file);
  assert.equal(m.repos.length, 2);
  assert.equal(m.repos[0].name, 'Solid');
  assert.ok(m.feed.startsWith('/'), 'feed is expanded to an absolute path');
  assert.ok(m.repos[0].path.startsWith('/'), 'repo path is absolute');
});

test('a missing repo name names its field path', () => {
  const bad = good();
  delete bad.repos[0].name;
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('repos[0].name'));
});

test('a package id used in two repos is rejected', () => {
  const bad = good();
  bad.repos[1].packages[0].id = 'Solid.Core';
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('Solid.Core'));
});

test('pack nuspec without a nuspec path is rejected', () => {
  const bad = good();
  delete bad.repos[1].packages[0].nuspec;
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('repos[1].packages[0].nuspec'));
});

test('a repo without a solution is rejected', () => {
  const bad = good();
  delete bad.repos[0].solution;
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('repos[0].solution'));
});

test('pack nuspec without lib rules is rejected', () => {
  const bad = good();
  delete bad.repos[1].packages[0].lib;
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('repos[1].packages[0].lib'));
});

test('a package platform defaults to the repo platform and rejects unknown values', () => {
  const m = good();
  m.repos[0].packages[0].platform = 'windows';
  const loaded = loadManifest(write(m));
  assert.equal(loaded.repos[0].packages[0].platform, 'windows');
  assert.equal(loaded.repos[1].packages[0].platform, 'any');
  const bad = good();
  bad.repos[0].packages[0].platform = 'linux';
  assert.throws(() => loadManifest(write(bad)), (e) =>
    e instanceof ManifestError && e.message.includes('repos[0].packages[0].platform'));
});

test('families, scan and knownFailing load, with defaults when absent', () => {
  const plain = loadManifest(write(good()));
  assert.deepEqual([plain.families, plain.scan, plain.repos[0].knownFailing], [{}, [], []]);
  const root = mkdtempSync(join(tmpdir(), 'scan-'));
  const m = good();
  m.families = { Solid: { prefix: 'Solid.' }, LogoFX: { prefix: 'LogoFX.', anchor: 'LogoFX.Core' } };
  m.scan = [root];
  m.repos[0].knownFailing = [{ test: 'A should work', owner: 'godrose', expires: '2026-12-31' }];
  const loaded = loadManifest(write(m));
  assert.equal(loaded.families.LogoFX.anchor, 'LogoFX.Core');
  assert.deepEqual(loaded.scan, [root]);
  assert.equal(loaded.repos[0].knownFailing[0].owner, 'godrose');
});

test('a knownFailing entry without an owner or with a bad date names its field', () => {
  const noOwner = good();
  noOwner.repos[0].knownFailing = [{ test: 't', expires: '2026-12-31' }];
  assert.throws(() => loadManifest(write(noOwner)), (e) => e instanceof ManifestError && e.message.includes('repos[0].knownFailing[0].owner'));
  const badDate = good();
  badDate.repos[0].knownFailing = [{ test: 't', owner: 'o', expires: '11/11/2026' }];
  assert.throws(() => loadManifest(write(badDate)), (e) => e instanceof ManifestError && e.message.includes('repos[0].knownFailing[0].expires'));
  const impossible = good();
  impossible.repos[0].knownFailing = [{ test: 't', owner: 'o', expires: '2026-02-31' }];
  assert.throws(() => loadManifest(write(impossible)), (e) => e.message.includes('expires'));
});

test('a scan root that does not exist is named', () => {
  const m = good();
  m.scan = ['/no/such/root'];
  assert.throws(() => loadManifest(write(m)), (e) => e instanceof ManifestError && e.message.includes('scan[0]'));
});

test('two families with the same prefix are refused', () => {
  const m = good();
  m.families = { A: { prefix: 'Solid.' }, B: { prefix: 'Solid.' } };
  assert.throws(() => loadManifest(write(m)), (e) => e instanceof ManifestError && e.message.includes('families.B.prefix'));
});
