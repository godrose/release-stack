import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertClean, createWorktree, removeWorktree, currentRef, DirtyTreeError } from '../src/worktree.js';
import { makeRepo, git, put, tmp } from './helpers.js';

test('a clean tree passes and an untracked file does not count', async () => {
  const repo = makeRepo();
  put(repo, 'untracked.txt', 'x');
  await assertClean(repo);
});

test('a modified tracked file is refused and named', async () => {
  const repo = makeRepo();
  put(repo, 'a.txt', 'changed\n');
  await assert.rejects(() => assertClean(repo), (e) => e instanceof DirtyTreeError && e.message.includes('a.txt'));
});

test('a worktree at a branch has that branch content and the right sha and tree hash', async () => {
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'feature');
  put(repo, 'a.txt', 'feature\n');
  git(repo, 'commit', '-q', '-am', 'feature');
  git(repo, 'checkout', '-q', 'main');
  const dest = join(tmp('wt'), 'w');
  const wt = await createWorktree(repo, 'feature', dest);
  assert.equal(wt.sha, git(repo, 'rev-parse', 'feature'));
  assert.equal(wt.treeHash, git(repo, 'rev-parse', 'feature^{tree}'));
  assert.equal(readFileSync(join(dest, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'feature\n', 'content is the feature branch (line endings follow the machine autocrlf setting)');
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'one\n', 'main checkout untouched');
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('removeWorktree deletes the folder and the registration', async () => {
  const repo = makeRepo();
  const dest = join(tmp('wt'), 'w');
  await createWorktree(repo, 'main', dest);
  await removeWorktree(repo, dest);
  assert.equal(existsSync(dest), false);
  assert.ok(!git(repo, 'worktree', 'list').includes(dest.replace(/^\/private/, '')));
});

test('currentRef returns the branch name', async () => {
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'topic');
  assert.equal(await currentRef(repo), 'topic');
});
