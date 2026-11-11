import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bump, verdictOf, defaultSln } from '../src/bump.js';
import { writeRecord } from '../src/record.js';
import { DirtyTreeError } from '../src/worktree.js';
import { makeRepo, put, tmp, git } from './helpers.js';

const RC = '2.3.7-rc.202611111530';
const ref = (id, v) => `<PackageReference Include="${id}" Version="${v}" />`;
const proj = (own, refs) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><Version>${own}</Version></PropertyGroup>
  <ItemGroup>${refs}</ItemGroup>
</Project>
`;

async function setup(files, { record = true } = {}) {
  const feed = tmp('feed');
  if (record) {
    await writeRecord(feed, {
      runId: '202611111530', createdAt: '2026-11-11T15:30:00.000Z', origin: 'local', repos: [],
      packages: [{ id: 'Solid.Core', version: RC }, { id: 'Solid.Practices.IoC', version: RC }, { id: 'Attest.Tests.Core', version: '2.4.7-rc.202611111530' }],
    });
  }
  const root = tmp('root');
  const dir = join(root, 'consumer');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  const manifestPath = join(tmp('manifest'), 'stack.json');
  writeFileSync(manifestPath, JSON.stringify({
    feed,
    families: { Solid: { prefix: 'Solid.' }, Attest: { prefix: 'Attest.' } },
    scan: [root],
    repos: [{ name: 'Lib', path: makeRepo({ 'x.txt': 'x\n' }), platform: 'any', solution: 'x.sln', tests: [], packages: [] }],
  }));
  return { manifestPath, dir };
}

const tests = (baseline, after) => {
  const results = [baseline, after];
  const calls = [];
  const fn = async (repoPath, feedDir) => {
    calls.push({ repoPath, feedDir, content: readFileSync(join(repoPath, 'a/a.csproj'), 'utf8') });
    return results.shift();
  };
  fn.calls = calls;
  return fn;
};
const ok = (...failed) => ({ built: true, failed });

test('only pins of ids in the record change, nothing else changes, and the repo is left uncommitted', async () => {
  const before = proj('2.2.7', ref('Solid.Core', '2.3.2') + ref('Other.Lib', '9.9.9') + ref('Attest.Tests.Core', '2.4.6'));
  const { manifestPath, dir } = await setup({ 'a/a.csproj': before, 'README.md': 'keep\n' });
  const r = await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: tests(ok(), ok()) });
  const after = readFileSync(join(dir, 'a/a.csproj'), 'utf8');
  assert.equal(after, before.replace('Version="2.3.2"', `Version="${RC}"`).replace('Version="2.4.6"', 'Version="2.4.7-rc.202611111530"'));
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'keep\n');
  assert.deepEqual(r.changed, [
    { file: 'a/a.csproj', id: 'Solid.Core', old: ['2.3.2'], new: RC },
    { file: 'a/a.csproj', id: 'Attest.Tests.Core', old: ['2.4.6'], new: '2.4.7-rc.202611111530' },
  ]);
  assert.equal(git(dir, 'status', '--porcelain'), 'M a/a.csproj');
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1');
  assert.match(r.changed[0].file, /^a\//);
});

test('the own version is never changed', async () => {
  const { manifestPath, dir } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) });
  await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: tests(ok(), ok()) });
  assert.match(readFileSync(join(dir, 'a/a.csproj'), 'utf8'), /<Version>2\.2\.7<\/Version>/);
});

test('a repo with a modified tracked file is refused and its bytes are unchanged', async () => {
  const { manifestPath, dir } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) });
  put(dir, 'a/a.csproj', proj('2.2.7', ref('Solid.Core', '2.3.2') + '<!-- edit -->'));
  const bytes = readFileSync(join(dir, 'a/a.csproj'), 'utf8');
  const runTests = tests(ok(), ok());
  await assert.rejects(bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests }), DirtyTreeError);
  assert.equal(readFileSync(join(dir, 'a/a.csproj'), 'utf8'), bytes);
  assert.equal(runTests.calls.length, 0);
});

test('the baseline runs before the edit and the after-run sees the edit', async () => {
  const { manifestPath } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) });
  const runTests = tests(ok(), ok());
  const r = await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests });
  assert.match(runTests.calls[0].content, /Version="2\.3\.2"/);
  assert.match(runTests.calls[1].content, new RegExp(`Version="${RC}"`));
  assert.equal(runTests.calls[1].feedDir, JSON.parse(readFileSync(manifestPath, 'utf8')).feed);
  assert.equal(r.baseline.built, true);
});

test('the same failures give same, a new failure gives worse with its name, fewer give better', async () => {
  const files = { 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) };
  const run = async (b, a) => bump({ manifestPath: (await setup(files)).manifestPath, repo: 'consumer', sln: 'x.sln', runTests: tests(b, a) });
  const same = await run(ok('A'), ok('A'));
  assert.equal(same.verdict, 'same');
  const worse = await run(ok('A'), ok('A', 'B'));
  assert.equal(worse.verdict, 'worse');
  assert.deepEqual(worse.newFailures, ['B']);
  const better = await run(ok('A'), ok());
  assert.equal(better.verdict, 'better');
});

test('verdictOf: a build that broke is worse, a baseline that did not build and now does is better, both broken is same', () => {
  assert.equal(verdictOf(ok(), { built: false, failed: [] }).verdict, 'worse');
  assert.equal(verdictOf({ built: false, failed: [] }, ok()).verdict, 'better');
  assert.equal(verdictOf({ built: false, failed: [] }, { built: false, failed: [] }).verdict, 'same');
  assert.equal(verdictOf(ok('A'), ok('B')).verdict, 'worse');
  assert.equal(verdictOf({ built: false, failed: [] }, ok('A')).verdict, 'worse');
});

test('an unknown repo name lists the known names', async () => {
  const { manifestPath } = await setup({ 'a/a.csproj': proj('2.2.7', '') });
  await assert.rejects(bump({ manifestPath, repo: 'nope', sln: 'x.sln', runTests: tests(ok(), ok()) }), /unknown repo "nope".*(Lib.*consumer|consumer.*Lib)/s);
});

test('a family id missing from the record stays and is reported as unaligned', async () => {
  const { manifestPath, dir } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2') + ref('Solid.Windows.Only', '2.3.2')) });
  const r = await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: tests(ok(), ok()) });
  assert.match(readFileSync(join(dir, 'a/a.csproj'), 'utf8'), /Solid\.Windows\.Only" Version="2\.3\.2"/);
  assert.deepEqual(r.unaligned, [{ file: 'a/a.csproj', id: 'Solid.Windows.Only', version: '2.3.2' }]);
});

test('a repo that pinned one family at two versions ends with one value for it', async () => {
  const { manifestPath, dir } = await setup({
    'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')),
    'b/b.csproj': proj('2.2.7', ref('Solid.Practices.IoC', '2.3.6') + ref('Solid.Core', '2.3.6')),
  });
  await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: async () => ok() });
  for (const f of ['a/a.csproj', 'b/b.csproj']) {
    const versions = [...readFileSync(join(dir, f), 'utf8').matchAll(/Version="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(versions)], [RC]);
  }
});

test('a record that does not exist is a clear error and nothing changes', async () => {
  const { manifestPath, dir } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) }, { record: false });
  await assert.rejects(bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: async () => ok() }), /no rc record/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('a failing run keeps the edits so the owner can look', async () => {
  const { manifestPath, dir } = await setup({ 'a/a.csproj': proj('2.2.7', ref('Solid.Core', '2.3.2')) });
  const r = await bump({ manifestPath, repo: 'consumer', sln: 'x.sln', runTests: tests(ok(), ok('B')) });
  assert.equal(r.verdict, 'worse');
  assert.equal(git(dir, 'status', '--porcelain'), 'M a/a.csproj');
});

test('defaultSln finds the only .sln in the root or src and demands --sln otherwise', () => {
  const one = makeRepo({ 'src/A.sln': 'x\n' });
  assert.equal(defaultSln(one), join(one, 'src/A.sln'));
  const rootOne = makeRepo({ 'R.sln': 'x\n' });
  assert.equal(defaultSln(rootOne), join(rootOne, 'R.sln'));
  const two = makeRepo({ 'src/A.sln': 'x\n', 'src/B.sln': 'x\n' });
  assert.throws(() => defaultSln(two), /--sln/);
  const none = makeRepo({ 'a.txt': 'x\n' });
  assert.throws(() => defaultSln(none), /--sln/);
});
