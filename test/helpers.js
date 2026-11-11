import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export const tmp = (prefix) => mkdtempSync(join(tmpdir(), `${prefix}-`));

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();

export function put(dir, rel, text) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

export function makeRepo(files = { 'a.txt': 'one\n' }) {
  const dir = tmp('repo');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
