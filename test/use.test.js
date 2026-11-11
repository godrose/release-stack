import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, cpSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { use, useStable, UseError } from '../src/use.js';
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
