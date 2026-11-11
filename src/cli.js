#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadManifest } from './manifest.js';
import { rc } from './rc.js';
import { use, useStable } from './use.js';

const defaultManifest = join(dirname(fileURLToPath(import.meta.url)), '../stack.json');
const USAGE = 'usage: stack rc [--from <repo>] [--ref <repo>=<ref>]... [--manifest <file>]\n       stack use --local <consumer> [--manifest <file>]\n       stack use --stable <consumer>';

class UsageError extends Error {}

function parse(argv) {
  const out = { positional: [], refs: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--manifest') out.manifest = resolve(argv[++i]);
    else if (a === '--local') out.local = true;
    else if (a === '--stable') out.stable = true;
    else if (a === '--ref') {
      const v = argv[++i] ?? '';
      const at = v.indexOf('=');
      if (at < 1) throw new UsageError(`--ref expects <repo>=<ref>, got "${v}"`);
      out.refs[v.slice(0, at)] = v.slice(at + 1);
    } else out.positional.push(a);
  }
  return out;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== 'rc' && command !== 'use') throw new UsageError(USAGE);
  const o = parse(rest);
  const manifestPath = o.manifest ?? defaultManifest;
  if (command === 'rc') {
    const record = await rc({ manifestPath, from: o.from, refs: o.refs, log: (s) => console.log(s) });
    console.log(`rc ${record.runId}: ${record.packages.length} packages in the feed`);
    return;
  }
  const consumer = resolve(o.positional[0] ?? '');
  if (!o.positional[0]) throw new UsageError('use needs a consumer folder\n' + USAGE);
  if (o.stable) {
    const r = await useStable({ consumer });
    console.log(`restored ${r.changed.length} pins, skipped ${r.skipped.length}, nuget.config ${r.nugetConfig ?? 'untouched'}`);
    for (const s of r.skipped) console.log(`skipped ${s.file} ${s.id}: ${s.reason}`);
    return;
  }
  const r = await use({ consumer, feedDir: loadManifest(manifestPath).feed });
  console.log(r.noop ? `already using rc ${r.runId}` : `using rc ${r.runId}: ${r.changed.length} pins changed`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
