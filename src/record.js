import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const dirOf = (feedDir) => join(feedDir, 'records');

export async function writeRecord(feedDir, rec) {
  await mkdir(dirOf(feedDir), { recursive: true });
  try {
    await writeFile(join(dirOf(feedDir), `${rec.runId}.json`), JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`record ${rec.runId} already exists`);
    throw e;
  }
}

export async function latestRecord(feedDir) {
  let names;
  try {
    names = (await readdir(dirOf(feedDir))).filter((f) => f.endsWith('.json'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (!names.length) return null;
  names.sort();
  return JSON.parse(await readFile(join(dirOf(feedDir), names[names.length - 1]), 'utf8'));
}
