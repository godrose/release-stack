import { compareSemver } from './version.js';

const highest = (versions) => versions.reduce((a, b) => (compareSemver(a, b) >= 0 ? a : b));
const isStable = (v) => !v.includes('-');

export async function currentStack(manifest, record, published) {
  const stack = {};
  for (const [name, fam] of Object.entries(manifest.families ?? {})) {
    const inRecord = (record?.packages ?? []).filter((p) => p.id.startsWith(fam.prefix)).map((p) => p.version);
    if (inRecord.length) {
      stack[name] = { version: highest(inRecord), source: 'rc' };
      continue;
    }
    if (!fam.anchor) continue;
    try {
      const stable = (await published(fam.anchor)).filter(isStable);
      if (stable.length) stack[name] = { version: highest(stable), source: 'stable' };
    } catch {
      continue;
    }
  }
  return stack;
}
