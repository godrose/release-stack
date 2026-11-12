import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkout } from '../src/checkout.js';
import { makeRepo, put, tmp, git } from './helpers.js';

function setup() {
  const a = makeRepo({ 'a.txt': 'main\n' });
  git(a, 'checkout', '-q', '-b', 'feature');
  put(a, 'a.txt', 'feature\n');
  git(a, 'commit', '-q', '-am', 'feature');
  git(a, 'checkout', '-q', 'main');
  const b = makeRepo({ 'b.txt': 'b\n' });
  const manifestPath = join(tmp('m'), 'stack.json');
  const repo = (name, url) => ({ name, git: url, path: tmp('x'), platform: 'any', solution: 'x.sln', tests: [], packages: [] });
  writeFileSync(manifestPath, JSON.stringify({ feed: tmp('feed'), repos: [repo('A', a), repo('B', b)] }));
  return { a, b, manifestPath, root: join(tmp('root'), 'stack') };
}

test('every manifest repo is cloned under root at its default branch, and a given ref is checked out', async () => {
  const s = setup();
  const out = await checkout({ manifestPath: s.manifestPath, root: s.root, refs: { A: 'feature' } });
  assert.equal(readFileSync(join(s.root, 'A/a.txt'), 'utf8').trim(), 'feature');
  assert.equal(readFileSync(join(s.root, 'B/b.txt'), 'utf8').trim(), 'b');
  assert.deepEqual(out.map((r) => [r.name, r.ref]), [['A', 'feature'], ['B', 'main']]);
  assert.equal(out[0].sha, git(join(s.root, 'A'), 'rev-parse', 'HEAD'));
});

test('a ref that does not exist fails naming the repo and the ref, and an unknown repo name in refs is refused first', async () => {
  const s = setup();
  await assert.rejects(() => checkout({ manifestPath: s.manifestPath, root: s.root, refs: { Nope: 'x' } }), /Nope.*A, B|unknown repo/);
  assert.equal(existsSync(join(s.root, 'A')), false, 'nothing is cloned before the refs are checked');
  await assert.rejects(() => checkout({ manifestPath: s.manifestPath, root: s.root, refs: { A: 'no-such-branch' } }), /A: ref no-such-branch/);
});

test('a repo without a git url, or a destination that already exists, is refused', async () => {
  const s = setup();
  const m = JSON.parse(readFileSync(s.manifestPath, 'utf8'));
  delete m.repos[1].git;
  writeFileSync(s.manifestPath, JSON.stringify(m));
  await assert.rejects(() => checkout({ manifestPath: s.manifestPath, root: s.root }), /B has no git url/);
  const t = setup();
  put(join(t.root, '..'), 'stack/A/keep.txt', 'x\n');
  await assert.rejects(() => checkout({ manifestPath: t.manifestPath, root: t.root }), /A already exists/);
});
