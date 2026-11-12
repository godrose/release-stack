#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest } from './manifest.js';
import { rc } from './rc.js';
import { use, useStable, useRemote } from './use.js';
import { drift, formatDrift } from './drift.js';
import { bump } from './bump.js';

const defaultManifest = join(dirname(fileURLToPath(import.meta.url)), '../stack.json');
const USAGE = 'usage: stack rc [--from <repo>] [--ref <repo>=<ref>]... [--manifest <file>]\n       stack rc --remote --root <folder> [--ref <repo>=<ref>]... [--manifest <file>]\n       stack use --local <consumer> [--manifest <file>]\n       stack use --stable <consumer>\\n       stack use --remote <run-id> <consumer> [--manifest <file>]\n       stack drift [--json] [--manifest <file>]\n       stack bump <repo> [--sln <path>] [--allow-no-baseline] [--manifest <file>]';

class UsageError extends Error {}

function parse(argv) {
  const out = { positional: [], refs: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--manifest') out.manifest = resolve(argv[++i]);
    else if (a === '--local') out.local = true;
    else if (a === '--stable') out.stable = true;
    else if (a === '--json') out.json = true;
    else if (a === '--remote') out.remote = true;
    else if (a === '--root') out.root = resolve(argv[++i] ?? '');
    else if (a === '--sln') out.sln = argv[++i];
    else if (a === '--allow-no-baseline') out.allowNoBaseline = true;
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
  if (!(['rc', 'use', 'drift', 'bump'].includes(command))) throw new UsageError(USAGE);
  const o = parse(rest);
  const manifestPath = o.manifest ?? defaultManifest;
  if (command === 'drift') {
    const result = await drift({ manifestPath });
    console.log(o.json ? JSON.stringify(result, null, 2) : formatDrift(result));
    return;
  }
  if (command === 'bump') {
    if (!o.positional[0]) throw new UsageError('bump needs a repo name\n' + USAGE);
    const sln = o.sln ? resolve(o.sln) : undefined;
    if (sln && !existsSync(sln)) throw new UsageError(`--sln ${sln} does not exist`);
    const r = await bump({ manifestPath, repo: o.positional[0], sln, allowNoBaseline: o.allowNoBaseline });
    console.log(`${r.repo}: ${r.changed.length} pins changed in ${new Set(r.changed.map((c) => c.file)).size} files`);
    for (const c of r.changed.slice(0, 10)) console.log(`  ${c.file} ${c.id} ${c.old.join(',')} -> ${c.new}`);
    if (r.changed.length > 10) console.log(`  ... ${r.changed.length - 10} more`);
    for (const u of r.unaligned) console.log(`unaligned: ${u.file} ${u.id} ${u.version} (not in the rc record)`);
    for (const u of r.unresolved) console.log(`unresolved: ${u.file} ${u.id} (${u.reason}), not changed`);
    const show = (t) => (t.built ? `${t.failed.length} failed` : 'no test result');
    console.log(`baseline: ${show(r.baseline)}, after: ${show(r.after)}`);
    console.log(`verdict: ${r.verdict}${r.newFailures.length ? `, new failures: ${r.newFailures.join(', ')}` : ''}`);
    console.log('changes are left uncommitted in the repo');
    if (r.verdict === 'worse') process.exitCode = 1;
    return;
  }
  if (command === 'rc') {
    if (o.remote && !o.root) throw new UsageError('rc --remote needs --root <folder holding the repo checkouts>');
    const record = await rc({ manifestPath, from: o.from, refs: o.refs, origin: o.remote ? 'remote' : 'local', root: o.root, log: (s) => console.log(s) });
    console.log(`rc ${record.runId}: ${record.packages.length} packages in the feed`);
    return;
  }
  if (o.remote) {
    const [runId, folder] = o.positional;
    if (!/^\d{12}$/.test(runId ?? '') || !folder) throw new UsageError('use --remote needs a 12-digit run id and a consumer folder\n' + USAGE);
    const r = await useRemote({ consumer: resolve(folder), runId, manifest: loadManifest(manifestPath) });
    console.log(r.noop ? `already using remote run ${r.runId}` : `using remote run ${r.runId}: ${r.changed.length} pins changed`);
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
