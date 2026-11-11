import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmp } from './helpers.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('use --stable on a consumer with nothing to revert exits 1 with a one-line reason', () => {
  const r = run('use', '--stable', tmp('consumer'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing to revert/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
});

test('an unknown command prints the usage and exits 1', () => {
  const r = run('frobnicate');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: .*rc.*use/s);
});

test('rc with an unknown --ref format exits 1 naming the argument', () => {
  const r = run('rc', '--ref', 'Solid');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--ref expects <repo>=<ref>/);
});

test('drift prints the table, and --json prints the rows, without touching the repos', async () => {
  const { writeFileSync } = await import('node:fs');
  const { makeRepo } = await import('./helpers.js');
  const repo = makeRepo({ 'a/a.csproj': '<Project><PropertyGroup><Version>1.0.0</Version></PropertyGroup><ItemGroup><PackageReference Include="Solid.Core" Version="2.3.2" /></ItemGroup></Project>\n' });
  const manifest = join(tmp('m'), 'stack.json');
  writeFileSync(manifest, JSON.stringify({ feed: tmp('feed'), families: { Solid: { prefix: 'Solid.' } }, repos: [{ name: 'Lib', path: repo, platform: 'any', solution: 'x.sln', tests: [], packages: [] }] }));
  const table = run('drift', '--manifest', manifest);
  assert.equal(table.status, 0);
  assert.match(table.stdout, /^stack: Solid \?/);
  assert.match(table.stdout, /Lib\s+main\s+0\s+1\.0\.0\s+2\.3\.2\s+lagging/);
  const json = JSON.parse(run('drift', '--json', '--manifest', manifest).stdout);
  assert.equal(json.rows[0].status, 'lagging');
});
