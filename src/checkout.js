import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';

const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec('git', args, { cwd, maxBuffer: 1 << 26 })).stdout.trim();
const exists = (p) => access(p).then(() => true, () => false);

export async function checkout({ manifestPath, root, refs = {} }) {
  const manifest = loadManifest(manifestPath);
  const names = manifest.repos.map((r) => r.name);
  const unknown = Object.keys(refs).filter((n) => !names.includes(n));
  if (unknown.length) throw new Error(`unknown repo ${unknown.join(', ')} in refs, known: ${names.join(', ')}`);
  for (const repo of manifest.repos) {
    if (!repo.git) throw new Error(`${repo.name} has no git url in the manifest`);
    if (await exists(join(root, repo.name))) throw new Error(`${join(root, repo.name)} already exists`);
  }
  await mkdir(root, { recursive: true });
  const out = [];
  for (const repo of manifest.repos) {
    const dest = join(root, repo.name);
    await git(root, 'clone', '--quiet', repo.git, dest);
    if (refs[repo.name]) {
      try {
        await git(dest, 'checkout', '--quiet', refs[repo.name]);
      } catch {
        throw new Error(`${repo.name}: ref ${refs[repo.name]} not found in ${repo.git}`);
      }
    }
    out.push({ name: repo.name, ref: refs[repo.name] ?? (await git(dest, 'rev-parse', '--abbrev-ref', 'HEAD')), sha: await git(dest, 'rev-parse', 'HEAD') });
  }
  return out;
}
