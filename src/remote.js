import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
const isUrl = (s) => /^https?:\/\//i.test(s);
const auth = (token) => (token ? { Authorization: `Basic ${Buffer.from(`token:${token}`).toString('base64')}` } : {});

export async function pushPackages(staging, source, apiKey) {
  const files = (await readdir(staging)).filter((f) => f.endsWith('.nupkg')).sort();
  const failed = [];
  for (const f of files) {
    try {
      await exec('dotnet', ['nuget', 'push', join(staging, f), '-s', source, '-k', apiKey, '--skip-duplicate'], { maxBuffer: 1 << 26 });
    } catch (e) {
      failed.push(f);
    }
  }
  if (failed.length) throw new Error(`push to ${source} failed for: ${failed.join(', ')}`);
  return files;
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: auth(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

export async function listVersions(source, id, token) {
  if (!isUrl(source)) {
    const re = new RegExp(`^${id.replace(/[.+^${}()|[\]\\]/g, '\\$&')}\\.(\\d.*)\\.nupkg$`, 'i');
    const out = [];
    for (const f of await readdir(source, { recursive: true })) {
      const m = re.exec(f.split('/').pop());
      if (m) out.push(m[1]);
    }
    return out;
  }
  const index = await getJson(source, token);
  const base = index?.resources?.find((r) => String(r['@type']).startsWith('PackageBaseAddress'))?.['@id'];
  if (!base) throw new Error(`${source} has no PackageBaseAddress resource`);
  const data = await getJson(`${base.replace(/\/?$/, '/')}${id.toLowerCase()}/index.json`, token);
  return data?.versions ?? [];
}
