import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rc } from '../src/rc.js';
import { latestRecord } from '../src/record.js';
import { FeedConflictError } from '../src/feed.js';
import { DirtyTreeError } from '../src/worktree.js';
import { makeStack } from './fixtures/make-stack.js';
import { put, git } from './helpers.js';

const published = async () => [];
const nuspecOf = (feed, file) => execFileSync('tar', ['-xOf', join(feed, file), file.replace(/\.\d.*$/, '') + '.nuspec']).toString();
const nupkgs = (feed) => readdirSync(feed).filter((f) => f.endsWith('.nupkg')).sort();

test('a full run publishes both packages at one run id with LibB depending on LibA at the rc version', async () => {
  const s = makeStack();
  const now = new Date('2026-11-11T15:30:00Z');
  const rec = await rc({ manifestPath: s.manifestPath, now, published });
  assert.deepEqual(nupkgs(s.feed), ['LibA.1.0.1-rc.202611111530.nupkg', 'LibB.1.0.1-rc.202611111530.nupkg']);
  assert.match(nuspecOf(s.feed, 'LibB.1.0.1-rc.202611111530.nupkg'), /<dependency id="LibA" version="1.0.1-rc.202611111530"/);
  assert.equal(rec.runId, '202611111530');
  assert.deepEqual(rec.repos.map((r) => [r.name, r.rebuilt, r.version]), [['LibA', true, '1.0.1-rc.202611111530'], ['LibB', true, '1.0.1-rc.202611111530']]);
  assert.equal(rec.repos[0].sha, git(s.repos.LibA, 'rev-parse', 'HEAD'));
  assert.deepEqual((await latestRecord(s.feed)).packages.map((p) => p.id).sort(), ['LibA', 'LibB']);
  assert.equal(git(s.repos.LibB, 'status', '--porcelain'), '', 'the owner checkout is untouched');
});

test('a second run in the same UTC minute fails with a conflict and changes nothing', async () => {
  const s = makeStack();
  const now = new Date('2026-11-11T15:30:00Z');
  await rc({ manifestPath: s.manifestPath, now, published });
  const before = readdirSync(s.feed).sort();
  await assert.rejects(() => rc({ manifestPath: s.manifestPath, now, published }), FeedConflictError);
  assert.deepEqual(readdirSync(s.feed).sort(), before);
});

test('a failing test in the second repo publishes nothing', async () => {
  const s = makeStack({ failingB: true });
  await assert.rejects(() => rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T16:00:00Z'), published }), (e) =>
    e.name === 'CommandError' && /dotnet test .*LibB\.Tests/.test(e.message) && /Failed Tests\.Works/.test(e.message));
  assert.deepEqual(nupkgs(s.feed), []);
  assert.equal(await latestRecord(s.feed), null);
  assert.equal(git(s.repos.LibB, 'worktree', 'list').split('\n').length, 1, 'no worktree is left behind');
});

test('--from LibB keeps LibA out of the build and pins LibB to the version in the earlier record', async () => {
  const s = makeStack();
  const first = await rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T15:30:00Z'), published });
  put(s.repos.LibB, 'src/LibB/Code.cs', 'namespace LibB { public static class B { public static int Two() => 2; public static int Three() => 3; } }\n');
  git(s.repos.LibB, 'commit', '-q', '-am', 'change B');
  const second = await rc({ manifestPath: s.manifestPath, from: 'LibB', now: new Date('2026-11-11T16:10:00Z'), published });
  assert.deepEqual(second.repos.map((r) => r.name), ['LibB']);
  assert.deepEqual(second.repos[0].upstream, { LibA: { version: first.repos[0].version, fromRecord: first.runId } });
  assert.ok(nupkgs(s.feed).includes('LibB.1.0.1-rc.202611111610.nupkg'));
  assert.ok(!nupkgs(s.feed).includes('LibA.1.0.1-rc.202611111610.nupkg'));
  assert.match(nuspecOf(s.feed, 'LibB.1.0.1-rc.202611111610.nupkg'), /<dependency id="LibA" version="1.0.1-rc.202611111530"/);
});

test('a dirty checkout of a repo that must be built is refused before anything is built', async () => {
  const s = makeStack();
  put(s.repos.LibB, 'src/LibB/Code.cs', '// dirty\n');
  await assert.rejects(() => rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T17:00:00Z'), published }), DirtyTreeError);
  assert.deepEqual(readdirSync(s.feed), []);
});

test('a windows-only package whose project file does not exist here is skipped, not an error', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const s = makeStack();
  const m = JSON.parse(readFileSync(s.manifestPath, 'utf8'));
  m.repos[0].packages.push({ id: 'LibWin', project: 'src/LibWin/Nope.csproj', pack: 'dotnet', platform: 'windows' });
  writeFileSync(s.manifestPath, JSON.stringify(m));
  const rec = await rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T18:00:00Z'), published });
  assert.deepEqual(rec.packages.map((p) => p.id).sort(), ['LibA', 'LibB']);
});

test('buildArgs passes the slnf relative to the repo root', async () => {
  const { buildArgs } = await import('../src/rc.js');
  const args = buildArgs('src/rc-stack.slnf', ['/a', '/b']);
  assert.equal(args[1], 'src/rc-stack.slnf');
  assert.ok(args.includes('-p:RestoreAdditionalProjectSources=/a%3B/b'));
});

test('a partial run records the whole stack and a later partial run still pins the carried-over upstream', async () => {
  const s = makeStack();
  const first = await rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T15:30:00Z'), published });
  put(s.repos.LibB, 'src/LibB/Code.cs', 'namespace LibB { public static class B { public static int Two() => 2; public static int Three() => 3; } }\n');
  git(s.repos.LibB, 'commit', '-q', '-am', 'change B');
  const second = await rc({ manifestPath: s.manifestPath, from: 'LibB', now: new Date('2026-11-11T16:10:00Z'), published });
  const byId = Object.fromEntries(second.packages.map((p) => [p.id, p.version]));
  assert.deepEqual(byId, { LibA: first.repos[0].version, LibB: '1.0.1-rc.202611111610' });
  put(s.repos.LibB, 'src/LibB/Code.cs', 'namespace LibB { public static class B { public static int Two() => 2; public static int Four() => 4; } }\n');
  git(s.repos.LibB, 'commit', '-q', '-am', 'change B again');
  const third = await rc({ manifestPath: s.manifestPath, from: 'LibB', now: new Date('2026-11-11T16:40:00Z'), published });
  assert.deepEqual(third.repos[0].upstream, { LibA: { version: first.repos[0].version, fromRecord: second.runId } });
  assert.match(nuspecOf(s.feed, 'LibB.1.0.1-rc.202611111640.nupkg'), /<dependency id="LibA" version="1.0.1-rc.202611111530"/);
});

test('worktrees left behind by an interrupted run are pruned at the start of the next run', async () => {
  const { rmSync } = await import('node:fs');
  const { tmp } = await import('./helpers.js');
  const s = makeStack();
  const stale = join(tmp('stale'), 'LibA');
  git(s.repos.LibA, 'worktree', 'add', '-q', '--detach', stale, 'HEAD');
  rmSync(stale, { recursive: true, force: true });
  assert.equal(git(s.repos.LibA, 'worktree', 'list').split('\n').length, 2);
  await rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T15:30:00Z'), published });
  assert.equal(git(s.repos.LibA, 'worktree', 'list').split('\n').length, 1);
});

test('every project that declares its own version gets the run version and the record lists the edits', async () => {
  const s = makeStack();
  const rec = await rc({ manifestPath: s.manifestPath, now: new Date('2026-11-11T15:30:00Z'), published });
  const v = '1.0.1-rc.202611111530';
  const b = rec.repos.find((r) => r.name === 'LibB');
  assert.deepEqual(b.projects, [
    { file: 'src/LibB.Shared/LibB.Shared.csproj', old: '1.0.0', new: v },
    { file: 'src/LibB/LibB.csproj', old: '1.0.0', new: v },
  ]);
  assert.deepEqual(rec.repos.find((r) => r.name === 'LibA').projects, [{ file: 'src/LibA/LibA.csproj', old: '1.0.0', new: v }]);
});

async function withKnownFailing(s, entries) {
  const { writeFileSync } = await import('node:fs');
  const m = JSON.parse(readFileSync(s.manifestPath, 'utf8'));
  m.repos[1].knownFailing = entries;
  writeFileSync(s.manifestPath, JSON.stringify(m));
}
const NOW = new Date('2026-11-11T15:30:00Z');
const known = (test, expires) => ({ test, owner: 'godrose', expires });

test('a known failing test that is listed and not expired lets the run publish, and the entry is printed', async () => {
  const s = makeStack({ failingB: true });
  await withKnownFailing(s, [known('Tests.Works', '2026-12-31')]);
  const lines = [];
  await rc({ manifestPath: s.manifestPath, now: NOW, published, log: (l) => lines.push(l) });
  assert.deepEqual(nupkgs(s.feed), ['LibA.1.0.1-rc.202611111530.nupkg', 'LibB.1.0.1-rc.202611111530.nupkg']);
  assert.ok(lines.some((l) => l.includes('known failing: LibB Tests.Works (owner godrose, expires 2026-12-31)')), lines.join('\n'));
});

test('an expired entry fails the run before anything is built, even when its test passes', async () => {
  const { AllowlistError } = await import('../src/allowlist.js');
  for (const failingB of [true, false]) {
    const s = makeStack({ failingB });
    await withKnownFailing(s, [known('Tests.Works', '2026-11-10')]);
    await assert.rejects(() => rc({ manifestPath: s.manifestPath, now: NOW, published }), (e) => e instanceof AllowlistError && /LibB.*Tests\.Works.*godrose.*2026-11-10/.test(e.message));
    assert.deepEqual(readdirSync(s.feed), []);
  }
});

test('a failing test that is not in the allowlist still fails the run and publishes nothing', async () => {
  const s = makeStack({ failingB: true });
  await withKnownFailing(s, [known('Tests.SomethingElse', '2026-12-31')]);
  await assert.rejects(() => rc({ manifestPath: s.manifestPath, now: NOW, published }), (e) => e.name === 'CommandError' && /Failed Tests\.Works/.test(e.message));
  assert.deepEqual(readdirSync(s.feed), []);
});

test('a stale entry (its test passes) is reported but does not fail the run', async () => {
  const s = makeStack();
  await withKnownFailing(s, [known('Tests.Works', '2026-12-31')]);
  const lines = [];
  await rc({ manifestPath: s.manifestPath, now: NOW, published, log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => l.includes('stale known failing: LibB Tests.Works')), lines.join('\n'));
});

test('an allowlisted failure does not let the run through when a second test host crashed', async () => {
  const { mkdtempSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const s = makeStack({ failingB: true });
  await withKnownFailing(s, [known('Tests.Works', '2026-12-31')]);
  const real = execFileSync('which', ['dotnet']).toString().trim();
  const bin = mkdtempSync(join(tmpdir(), 'wrap-'));
  writeFileSync(join(bin, 'dotnet'), `#!/bin/sh\n\"${real}\" \"\$@\"\ncode=\$?\nif [ \"\$1\" = test ] && echo \"\$2\" | grep -q LibB.Tests; then\n  echo 'Test run for /w/LibB.Tests.dll (.NETCoreApp,Version=v8.0)'\n  echo 'The active test run was aborted. Reason: Test host process crashed'\n  echo 'Test Run Aborted.'\n  exit 1\nfi\nexit \$code\n`);
  chmodSync(join(bin, 'dotnet'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try {
    await assert.rejects(() => rc({ manifestPath: s.manifestPath, now: NOW, published }), (e) => e.name === 'CommandError' && /^dotnet test /.test(e.message));
  } finally {
    process.env.PATH = saved;
  }
  assert.deepEqual(readdirSync(s.feed), []);
});
