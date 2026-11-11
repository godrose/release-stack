import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
