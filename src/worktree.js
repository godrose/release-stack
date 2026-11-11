import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const gitRaw = async (cwd, ...args) => (await run('git', args, { cwd, maxBuffer: 1 << 26 })).stdout;
const git = async (cwd, ...args) => (await gitRaw(cwd, ...args)).trim();

export class DirtyTreeError extends Error {
  constructor(repoPath, files) {
    super(`${repoPath} has uncommitted changes to tracked files: ${files.join(', ')}`);
    this.name = 'DirtyTreeError';
  }
}

export async function assertClean(repoPath) {
  const out = await gitRaw(repoPath, 'status', '--porcelain', '--untracked-files=no');
  const files = out.split('\n').filter(Boolean).map((l) => l.slice(3));
  if (files.length) throw new DirtyTreeError(repoPath, files);
}

export async function currentRef(repoPath) {
  const name = await git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
  return name === 'HEAD' ? git(repoPath, 'rev-parse', 'HEAD') : name;
}

export async function createWorktree(repoPath, ref, dest) {
  await git(repoPath, 'worktree', 'add', '-q', '--detach', dest, ref);
  const sha = await git(dest, 'rev-parse', 'HEAD');
  const treeHash = await git(dest, 'rev-parse', 'HEAD^{tree}');
  return { path: dest, sha, treeHash };
}

export async function removeWorktree(repoPath, path) {
  await git(repoPath, 'worktree', 'remove', '--force', path);
}
