import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { latestRecord } from './record.js';
import { listPackageRefs, setPackageRefVersion, setPackageRefVersions } from './xml-edit.js';

export class UseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UseError';
  }
}

const STATE = '.rc-stack/use.json';
const SKIP_DIRS = new Set(['obj', 'bin', 'Bin', 'node_modules', '.git', '.rc-stack']);

async function csprojFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await csprojFiles(p)));
    else if (e.name.endsWith('.csproj')) out.push(p);
  }
  return out;
}

const readJson = async (p) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const slash = (p) => p.split('\\').join('/');
const same = (id) => (r) => r.id.toLowerCase() === id.toLowerCase();

function nugetConfigFor(feedDir, ids) {
  const patterns = ids.map((id) => `      <package pattern="${id}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <!-- rc-stack:begin -->
  <packageSources>
    <add key="rc-stack-local" value="${feedDir}" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="rc-stack-local">
${patterns}
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
  <!-- rc-stack:end -->
</configuration>
`;
}

export async function use({ consumer, feedDir }) {
  const record = await latestRecord(feedDir);
  if (!record) throw new UseError(`no rc record in ${feedDir}: run rc first`);
  const existing = await readJson(join(consumer, STATE));
  if (existing) {
    if (existing.runId === record.runId) return { runId: record.runId, changed: [], skipped: [], noop: true };
    const reverted = await useStable({ consumer });
    if (reverted.skipped.length) throw new UseError('an earlier use left pins that were edited by hand; resolve them first');
  }
  const present = (await readdir(consumer)).find((n) => n.toLowerCase() === 'nuget.config');
  if (present) throw new UseError(`${consumer} has its own ${present}: merging into an existing nuget.config is not supported yet`);

  const edits = [];
  const entries = [];
  for (const file of await csprojFiles(consumer)) {
    const before = await readFile(file, 'utf8');
    let xml = before;
    for (const { id, version } of record.packages) {
      const olds = listPackageRefs(xml).filter(same(id)).map((r) => r.version);
      if (!olds.length || olds.every((v) => v === version)) continue;
      xml = setPackageRefVersion(xml, id, version).xml;
      entries.push({ file: slash(relative(consumer, file)), id, old: olds, new: version });
    }
    if (xml !== before) edits.push([file, xml]);
  }
  const config = nugetConfigFor(feedDir, record.packages.map((p) => p.id));
  for (const [file, xml] of edits) await writeFile(file, xml);
  await writeFile(join(consumer, 'nuget.config'), config);
  await mkdir(join(consumer, '.rc-stack'), { recursive: true });
  await writeFile(join(consumer, STATE), JSON.stringify({ runId: record.runId, feedDir, entries, nugetConfig: { created: true, content: config } }, null, 2) + '\n');
  return { runId: record.runId, changed: entries, skipped: [], noop: false };
}

export async function useStable({ consumer }) {
  const state = await readJson(join(consumer, STATE));
  if (!state) throw new UseError(`nothing to revert: ${STATE} not found in ${consumer}`);
  const changed = [];
  const skipped = [];
  for (const entry of state.entries) {
    const file = join(consumer, entry.file);
    let xml;
    try {
      xml = await readFile(file, 'utf8');
    } catch {
      skipped.push({ file: entry.file, id: entry.id, reason: 'file is missing' });
      continue;
    }
    const current = listPackageRefs(xml).filter(same(entry.id)).map((r) => r.version);
    if (current.length !== entry.old.length || !current.every((v) => v === entry.new)) {
      skipped.push({ file: entry.file, id: entry.id, reason: 'changed since use' });
      continue;
    }
    await writeFile(file, setPackageRefVersions(xml, entry.id, entry.old));
    changed.push(entry);
  }
  let nugetConfig = null;
  if (state.nugetConfig?.created) {
    const path = join(consumer, 'nuget.config');
    const now = await readFile(path, 'utf8').catch(() => null);
    if (now === state.nugetConfig.content) { await rm(path); nugetConfig = 'removed'; } else nugetConfig = now === null ? 'missing' : 'kept';
  }
  if (skipped.length) {
    const left = state.entries.filter((e) => skipped.some((s) => s.file === e.file && s.id === e.id));
    await writeFile(join(consumer, STATE), JSON.stringify({ ...state, entries: left, nugetConfig: null }, null, 2) + '\n');
  } else {
    await rm(join(consumer, '.rc-stack'), { recursive: true, force: true });
  }
  return { changed, skipped, nugetConfig };
}
