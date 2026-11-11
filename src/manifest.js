import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

function expand(p, baseDir) {
  if (p === '~' || p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(baseDir, p);
}

function need(cond, field, what) {
  if (!cond) throw new ManifestError(`${field}: ${what}`);
}

export function loadManifest(file) {
  const baseDir = dirname(resolve(file));
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  need(typeof raw.feed === 'string', 'feed', 'must be a string');
  need(Array.isArray(raw.repos) && raw.repos.length > 0, 'repos', 'must be a non-empty array');
  const seen = new Map();
  const repos = raw.repos.map((r, i) => {
    const f = `repos[${i}]`;
    need(typeof r.name === 'string' && r.name, `${f}.name`, 'must be a non-empty string');
    need(typeof r.path === 'string', `${f}.path`, 'must be a string');
    need(['any', 'windows'].includes(r.platform), `${f}.platform`, "must be 'any' or 'windows'");
    need(Array.isArray(r.tests), `${f}.tests`, 'must be an array');
    need(Array.isArray(r.packages), `${f}.packages`, 'must be an array');
    const packages = r.packages.map((p, j) => {
      const pf = `${f}.packages[${j}]`;
      need(typeof p.id === 'string' && p.id, `${pf}.id`, 'must be a non-empty string');
      need(typeof p.project === 'string', `${pf}.project`, 'must be a string');
      need(['dotnet', 'nuspec'].includes(p.pack), `${pf}.pack`, "must be 'dotnet' or 'nuspec'");
      if (p.pack === 'nuspec') need(typeof p.nuspec === 'string', `${pf}.nuspec`, "required when pack is 'nuspec'");
      need(!seen.has(p.id), `${pf}.id`, `duplicate package id ${p.id} (also in ${seen.get(p.id)})`);
      seen.set(p.id, r.name);
      return { ...p };
    });
    return { name: r.name, path: expand(r.path, baseDir), platform: r.platform, tests: [...r.tests], packages };
  });
  return { feed: expand(raw.feed, baseDir), repos };
}
