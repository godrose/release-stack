import { readdir, mkdir, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export class FeedConflictError extends Error {
  constructor(names) {
    super(`the feed already holds: ${names.join(', ')}. Published versions are never overwritten.`);
    this.name = 'FeedConflictError';
  }
}

const exists = (p) => access(p).then(() => true, () => false);

export async function publishStaging(stagingDir, feedDir) {
  const names = (await readdir(stagingDir)).filter((f) => f.endsWith('.nupkg'));
  await mkdir(feedDir, { recursive: true });
  const taken = [];
  for (const n of names) if (await exists(join(feedDir, n))) taken.push(n);
  if (taken.length) throw new FeedConflictError(taken);
  for (const n of names) await copyFile(join(stagingDir, n), join(feedDir, n));
  return names;
}
