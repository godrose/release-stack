import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function listEntries(nupkg) {
  const { stdout } = await run('tar', ['-tf', nupkg], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function readNuspec(nupkg, entries) {
  const name = entries.find((e) => !e.includes('/') && e.endsWith('.nuspec'));
  if (!name) throw new Error(`${nupkg}: no nuspec at the package root`);
  const { stdout } = await run('tar', ['-xOf', nupkg, name], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function dependencies(nuspec) {
  const set = new Set();
  for (const m of nuspec.matchAll(/<dependency\s+([^>]*?)\/?>/g)) {
    const id = /id="([^"]*)"/.exec(m[1])?.[1];
    const version = /version="([^"]*)"/.exec(m[1])?.[1] ?? '';
    if (id) set.add(`${id} ${version}`);
  }
  return set;
}

export async function comparePackages(a, b) {
  const [ea, eb] = await Promise.all([listEntries(a), listEntries(b)]);
  const libA = new Set(ea.filter((e) => e.startsWith('lib/') && !e.endsWith('/')));
  const libB = new Set(eb.filter((e) => e.startsWith('lib/') && !e.endsWith('/')));
  const onlyInA = [...libA].filter((e) => !libB.has(e)).sort();
  const onlyInB = [...libB].filter((e) => !libA.has(e)).sort();
  const [na, nb] = await Promise.all([readNuspec(a, ea), readNuspec(b, eb)]);
  const da = dependencies(na);
  const db = dependencies(nb);
  const depsDiff = [
    ...[...da].filter((d) => !db.has(d)).map((d) => `only in a: ${d}`),
    ...[...db].filter((d) => !da.has(d)).map((d) => `only in b: ${d}`),
  ].sort();
  return { same: !onlyInA.length && !onlyInB.length && !depsDiff.length, onlyInA, onlyInB, depsDiff };
}
