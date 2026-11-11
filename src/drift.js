import { loadManifest } from './manifest.js';
import { latestRecord } from './record.js';
import { currentStack } from './stack.js';
import { listRepos, scanRepo } from './scan.js';
import { publishedVersions } from './version.js';

function statusOf(scan, stack) {
  const fams = Object.keys(scan.pins);
  if (scan.own.length > 1 || fams.some((f) => scan.pins[f].length > 1)) return 'unaligned';
  if (!fams.length) return 'none';
  return fams.every((f) => stack[f] && scan.pins[f][0] === stack[f].version) ? 'current' : 'lagging';
}

export async function drift({ manifestPath, published = publishedVersions }) {
  const manifest = loadManifest(manifestPath);
  const stack = await currentStack(manifest, await latestRecord(manifest.feed), published);
  const rows = [];
  for (const repo of await listRepos(manifest)) {
    const s = await scanRepo(repo.path, manifest.families);
    rows.push({ name: repo.name, branch: s.branch, dirty: s.dirty, own: s.own, versions: s.pins, unresolved: s.unresolved, status: statusOf(s, stack) });
  }
  return { stack, families: Object.keys(manifest.families), rows };
}

export function formatDrift({ stack, families, rows }) {
  const head = `stack: ${families.map((f) => `${f} ${stack[f]?.version ?? '?'}`).join(', ')}`;
  const cells = (r) => [
    r.name, r.branch, String(r.dirty), r.own.join(',') || '-',
    ...families.map((f) => r.versions[f]?.join(',') || '-'),
    r.unresolved ? `${r.status}, ${r.unresolved} unresolved` : r.status,
  ];
  const table = [['repo', 'branch', 'dirty', 'own', ...families, 'status'], ...rows.map(cells)];
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  return [head, ...table.map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd())].join('\n');
}
