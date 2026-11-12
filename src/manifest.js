import { readFileSync, existsSync } from 'node:fs';
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

function realDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
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
    need(typeof r.solution === 'string' && r.solution, `${f}.solution`, 'must be a non-empty string');
    need(Array.isArray(r.tests), `${f}.tests`, 'must be an array');
    need(Array.isArray(r.packages), `${f}.packages`, 'must be an array');
    const packages = r.packages.map((p, j) => {
      const pf = `${f}.packages[${j}]`;
      need(typeof p.id === 'string' && p.id, `${pf}.id`, 'must be a non-empty string');
      need(typeof p.project === 'string', `${pf}.project`, 'must be a string');
      need(['dotnet', 'nuspec'].includes(p.pack), `${pf}.pack`, "must be 'dotnet' or 'nuspec'");
      if (p.pack === 'nuspec') {
        need(typeof p.nuspec === 'string', `${pf}.nuspec`, "required when pack is 'nuspec'");
        need(Array.isArray(p.lib) && p.lib.length > 0, `${pf}.lib`, "required when pack is 'nuspec': the copy rules {dir, tfm, glob}");
      }
      need(p.platform === undefined || ['any', 'windows'].includes(p.platform), `${pf}.platform`, "must be 'any' or 'windows'");
      need(!seen.has(p.id), `${pf}.id`, `duplicate package id ${p.id} (also in ${seen.get(p.id)})`);
      seen.set(p.id, r.name);
      return { ...p, platform: p.platform ?? r.platform };
    });
    need(r.git === undefined || (typeof r.git === 'string' && r.git), `${f}.git`, 'must be a non-empty string');
    const known = r.knownFailing ?? [];
    need(Array.isArray(known), `${f}.knownFailing`, 'must be an array');
    const knownFailing = known.map((k, j) => {
      const kf = `${f}.knownFailing[${j}]`;
      need(typeof k.test === 'string' && k.test, `${kf}.test`, 'must be a non-empty string');
      need(typeof k.owner === 'string' && k.owner, `${kf}.owner`, 'must be a non-empty string');
      need(typeof k.expires === 'string' && realDate(k.expires), `${kf}.expires`, 'must be a real date as YYYY-MM-DD');
      return { test: k.test, owner: k.owner, expires: k.expires };
    });
    return { name: r.name, ...(r.git ? { git: r.git } : {}), path: expand(r.path, baseDir), platform: r.platform, solution: r.solution, tests: [...r.tests], packages, knownFailing };
  });
  const families = {};
  const prefixes = new Map();
  for (const [name, fam] of Object.entries(raw.families ?? {})) {
    need(fam && typeof fam.prefix === 'string' && fam.prefix, `families.${name}.prefix`, 'must be a non-empty string');
    need(fam.anchor === undefined || (typeof fam.anchor === 'string' && fam.anchor), `families.${name}.anchor`, 'must be a non-empty string');
    need(!prefixes.has(fam.prefix), `families.${name}.prefix`, `duplicate prefix ${fam.prefix} (also in ${prefixes.get(fam.prefix)})`);
    prefixes.set(fam.prefix, name);
    families[name] = { prefix: fam.prefix, ...(fam.anchor ? { anchor: fam.anchor } : {}) };
  }
  const rawScan = raw.scan ?? [];
  need(Array.isArray(rawScan), 'scan', 'must be an array');
  const scan = rawScan.map((p, i) => {
    need(typeof p === 'string', `scan[${i}]`, 'must be a string');
    const abs = expand(p, baseDir);
    need(existsSync(abs), `scan[${i}]`, `${abs} does not exist`);
    return abs;
  });
  need(raw.remote === undefined || (raw.remote && typeof raw.remote.source === 'string' && raw.remote.source), 'remote.source', 'must be a non-empty string');
  return { feed: expand(raw.feed, baseDir), repos, families, scan, ...(raw.remote ? { remote: { source: raw.remote.source } } : {}) };
}
