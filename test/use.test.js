import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, cpSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { use, useStable, useRemote, UseError } from '../src/use.js';
import { writeRecord } from '../src/record.js';
import { tmp, put } from './helpers.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/consumer');

function snapshot(dir, base = dir, out = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) snapshot(p, base, out);
    else out[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return out;
}

async function setup() {
  const consumer = tmp('consumer');
  cpSync(fixture, consumer, { recursive: true });
  const feed = tmp('feed');
  await writeRecord(feed, {
    runId: '202611111530', createdAt: '2026-11-11T15:30:00.000Z', origin: 'local', repos: [],
    packages: [
      { id: 'Solid.Core', version: '2.3.7-rc.202611111530' },
      { id: 'Attest.Tests.Core', version: '2.4.7-rc.202611111530' },
      { id: 'Solid.Practices.Modularity', version: '2.3.7-rc.202611111530' },
    ],
  });
  return { consumer, feed };
}

test('use rewrites attribute, child and outlier pins and useStable restores the whole tree byte for byte', async () => {
  const { consumer, feed } = await setup();
  const before = snapshot(consumer);
  const report = await use({ consumer, feedDir: feed });
  assert.equal(report.changed.length, 4);
  const after = snapshot(consumer);
  assert.match(after['/a/attr.csproj'], /Include="Solid.Core" Version="2.3.7-rc.202611111530"/);
  assert.match(after['/b/child.csproj'], /<Version>2.4.7-rc.202611111530<\/Version>/);
  assert.match(after['/c/outlier.csproj'], /Include="Solid.Practices.Modularity" Version="2.3.7-rc.202611111530"/);
  assert.equal(after['/obj/ignored.csproj'], before['/obj/ignored.csproj'], 'obj is skipped');
  assert.ok(existsSync(join(consumer, 'nuget.config')));
  assert.ok(existsSync(join(consumer, '.rc-stack/use.json')));
  const stable = await useStable({ consumer });
  assert.deepEqual(stable.skipped, []);
  assert.deepEqual(snapshot(consumer), before);
});

test('the nuget.config maps each exact package id to the rc feed and everything else to nuget.org', async () => {
  const { consumer, feed } = await setup();
  await use({ consumer, feedDir: feed });
  const cfg = readFileSync(join(consumer, 'nuget.config'), 'utf8');
  for (const id of ['Solid.Core', 'Attest.Tests.Core', 'Solid.Practices.Modularity']) assert.ok(cfg.includes(`<package pattern="${id}" />`), id);
  assert.ok(cfg.includes(`<add key="rc-stack-local" value="${feed}" />`));
  assert.ok(cfg.includes('<package pattern="*" />'));
  assert.ok(!/pattern="[A-Za-z.]+\.\*"/.test(cfg), 'no family wildcard');
});

test('a file edited by hand after use is skipped and reported, and the rest is restored', async () => {
  const { consumer, feed } = await setup();
  await use({ consumer, feedDir: feed });
  const edited = join(consumer, 'a/attr.csproj');
  writeFileSync(edited, readFileSync(edited, 'utf8').replace('2.3.7-rc.202611111530', '9.9.9'));
  const stable = await useStable({ consumer });
  assert.deepEqual(stable.skipped.map((s) => [s.file, s.id]), [['a/attr.csproj', 'Solid.Core']]);
  assert.match(readFileSync(edited, 'utf8'), /Version="9.9.9"/, 'the hand edit is left alone');
  assert.match(readFileSync(join(consumer, 'b/child.csproj'), 'utf8'), /<Version>2.4.6<\/Version>/);
  assert.ok(existsSync(join(consumer, '.rc-stack/use.json')), 'the record of what is still pinned stays');
});

test('a consumer with its own nuget.config is refused and nothing changes', async () => {
  const { consumer, feed } = await setup();
  put(consumer, 'nuget.config', '<configuration><packageSourceMapping /></configuration>');
  const before = snapshot(consumer);
  await assert.rejects(() => use({ consumer, feedDir: feed }), (e) => e instanceof UseError && /nuget.config/.test(e.message));
  assert.deepEqual(snapshot(consumer), before);
});

test('use twice with the same record is a no-op', async () => {
  const { consumer, feed } = await setup();
  await use({ consumer, feedDir: feed });
  const once = snapshot(consumer);
  const again = await use({ consumer, feedDir: feed });
  assert.equal(again.noop, true);
  assert.deepEqual(snapshot(consumer), once);
});

test('use without any record in the feed says so and changes nothing', async () => {
  const consumer = tmp('consumer');
  cpSync(fixture, consumer, { recursive: true });
  const before = snapshot(consumer);
  await assert.rejects(() => use({ consumer, feedDir: tmp('empty') }), (e) => e instanceof UseError && /no rc record/.test(e.message));
  assert.deepEqual(snapshot(consumer), before);
});

test('useStable with nothing to revert says so', async () => {
  const { consumer } = await setup();
  await assert.rejects(() => useStable({ consumer }), (e) => e instanceof UseError && /nothing to revert/.test(e.message));
});

const newerRecord = (feed) => writeRecord(feed, {
  runId: '202611121000', createdAt: '2026-11-12T10:00:00.000Z', origin: 'local', repos: [],
  packages: [
    { id: 'Solid.Core', version: '2.3.7-rc.202611121000' },
    { id: 'Attest.Tests.Core', version: '2.4.7-rc.202611121000' },
    { id: 'Solid.Practices.Modularity', version: '2.3.7-rc.202611121000' },
  ],
});

test('use with a newer record reverts the old pins first and applies the new run', async () => {
  const { consumer, feed } = await setup();
  const clean = snapshot(consumer);
  await use({ consumer, feedDir: feed });
  await newerRecord(feed);
  const r = await use({ consumer, feedDir: feed });
  assert.equal(r.runId, '202611121000');
  const all = Object.values(snapshot(consumer)).join('\n');
  assert.ok(!all.includes('202611111530'), 'no pin of the old run is left');
  assert.ok(all.includes('2.3.7-rc.202611121000'));
  await useStable({ consumer });
  assert.deepEqual(snapshot(consumer), clean);
});

test('a skipped pin put back to the stable version by hand lets use --stable finish', async () => {
  const { consumer, feed } = await setup();
  const clean = snapshot(consumer);
  await use({ consumer, feedDir: feed });
  const edited = join(consumer, 'a/attr.csproj');
  writeFileSync(edited, readFileSync(edited, 'utf8').replace('2.3.7-rc.202611111530', '9.9.9'));
  assert.equal((await useStable({ consumer })).skipped.length, 1);
  writeFileSync(edited, readFileSync(edited, 'utf8').replace('9.9.9', '2.3.6'));
  const again = await useStable({ consumer });
  assert.deepEqual(again.skipped, []);
  assert.deepEqual(snapshot(consumer), clean);
});

test('after a partial use --stable the nuget.config stays and use does not report a no-op', async () => {
  const { consumer, feed } = await setup();
  await use({ consumer, feedDir: feed });
  const edited = join(consumer, 'a/attr.csproj');
  writeFileSync(edited, readFileSync(edited, 'utf8').replace('2.3.7-rc.202611111530', '9.9.9'));
  await useStable({ consumer });
  assert.ok(existsSync(join(consumer, 'nuget.config')), 'the config stays while a pin is skipped');
  await assert.rejects(() => use({ consumer, feedDir: feed }), (e) => e instanceof UseError && /a\/attr.csproj/.test(e.message));
});

const RUN = '202611121100';
const REMOTE = 'https://nuget.pkg.github.com/godrose/index.json';
const manifestOf = (...ids) => ({ remote: { source: REMOTE }, repos: [{ name: 'R', packages: ids.map((id) => ({ id })) }] });
const IDS = ['Solid.Core', 'Attest.Tests.Core', 'Solid.Practices.Modularity', 'LogoFX.Core'];
const lister = (missing = []) => {
  const calls = [];
  const fn = async (source, id, token) => {
    calls.push({ source, id, token });
    const base = id.startsWith('Attest.') ? '2.4.7' : '2.3.7';
    return missing.includes(id) ? ['1.0.0'] : ['1.0.0', `${base}-rc.${RUN}`, `${base}-rc.202611111530`];
  };
  fn.calls = calls;
  return fn;
};
const remoteOpts = (consumer, extra = {}) => ({ consumer, runId: RUN, manifest: manifestOf(...IDS), env: { GITHUB_TOKEN: 'secret-token' }, listVersions: lister(), ...extra });

test('use --remote retargets pins to the run id and maps every manifest id to the remote source with a token reference only', async () => {
  const { consumer } = await setup();
  const report = await useRemote(remoteOpts(consumer));
  assert.equal(report.runId, RUN);
  assert.equal(report.changed.length, 4);
  const text = Object.entries(snapshot(consumer)).filter(([f]) => f.endsWith('.csproj')).map(([, c]) => c).join('\n');
  assert.ok(text.includes(`2.3.7-rc.${RUN}`) && text.includes(`2.4.7-rc.${RUN}`) && !text.includes('2.3.7-rc.202611111530'));
  const config = readFileSync(join(consumer, 'nuget.config'), 'utf8');
  for (const id of IDS) assert.match(config, new RegExp(`<package pattern="${id}" />`));
  assert.match(config, /nuget\.pkg\.github\.com\/godrose\/index\.json/);
  assert.match(config, /%GITHUB_TOKEN%/);
  assert.match(config, /value="godrose"/);
  assert.doesNotMatch(config, /rc-stack-local/);
  for (const [, text] of Object.entries(snapshot(consumer))) assert.ok(!text.includes('secret-token'));
});

test('a manifest id with no version for the run id refuses and changes nothing', async () => {
  const { consumer } = await setup();
  const before = snapshot(consumer);
  await assert.rejects(() => useRemote(remoteOpts(consumer, { listVersions: lister(['LogoFX.Core']) })), (e) => e instanceof UseError && /LogoFX\.Core/.test(e.message) && new RegExp(RUN).test(e.message));
  assert.deepEqual(snapshot(consumer), before);
});

test('a missing token stops with one line naming it before anything is listed', async () => {
  const { consumer } = await setup();
  const list = lister();
  await assert.rejects(() => useRemote(remoteOpts(consumer, { env: {}, listVersions: list })), (e) => e instanceof UseError && /GITHUB_TOKEN/.test(e.message) && !e.message.includes('\n'));
  assert.equal(list.calls.length, 0);
});

test('the two origins exclude each other and nothing changes on a refusal', async () => {
  const a = await setup();
  await use({ consumer: a.consumer, feedDir: a.feed });
  const localState = snapshot(a.consumer);
  await assert.rejects(() => useRemote(remoteOpts(a.consumer)), (e) => e instanceof UseError && /local/.test(e.message) && /--stable/.test(e.message));
  assert.deepEqual(snapshot(a.consumer), localState);
  const b = await setup();
  await useRemote(remoteOpts(b.consumer));
  const remoteState = snapshot(b.consumer);
  await assert.rejects(() => use({ consumer: b.consumer, feedDir: b.feed }), (e) => e instanceof UseError && /remote/.test(e.message) && /--stable/.test(e.message));
  assert.deepEqual(snapshot(b.consumer), remoteState);
});

test('use --stable puts a remote use back byte for byte, and the same run id twice is a no-op', async () => {
  const { consumer } = await setup();
  const before = snapshot(consumer);
  await useRemote(remoteOpts(consumer));
  assert.equal((await useRemote(remoteOpts(consumer))).noop, true);
  await useStable({ consumer });
  assert.deepEqual(snapshot(consumer), before);
});
