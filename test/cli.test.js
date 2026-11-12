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

async function bumpFixture(secondRun) {
  const { writeFileSync, mkdirSync, chmodSync } = await import('node:fs');
  const { makeRepo } = await import('./helpers.js');
  const { writeRecord } = await import('../src/record.js');
  const repo = makeRepo({ 'a/a.csproj': '<Project><PropertyGroup><Version>1.0.0</Version></PropertyGroup><ItemGroup><PackageReference Include="Solid.Core" Version="2.3.2" /></ItemGroup></Project>\n', 'src/X.sln': 'x\n' });
  const feed = tmp('feed');
  await writeRecord(feed, { runId: '202611111530', createdAt: '2026-11-11T15:30:00.000Z', origin: 'local', repos: [], packages: [{ id: 'Solid.Core', version: '2.3.7-rc.202611111530' }] });
  const manifest = join(tmp('m'), 'stack.json');
  writeFileSync(manifest, JSON.stringify({ feed, families: { Solid: { prefix: 'Solid.' } }, repos: [{ name: 'Lib', path: repo, platform: 'any', solution: 'x.sln', tests: [], packages: [] }] }));
  const bin = tmp('bin');
  const counter = join(tmp('count'), 'n');
  writeFileSync(join(bin, 'dotnet'), `#!/bin/sh\nn=$(cat "${counter}" 2>/dev/null || echo 0)\necho $((n+1)) > "${counter}"\nif [ "$n" = 0 ]; then\n  echo "Passed! - Failed: 0, Passed: 1, Skipped: 0, Total: 1"\nelse\n${secondRun}\nfi\n`);
  chmodSync(join(bin, 'dotnet'), 0o755);
  mkdirSync(bin, { recursive: true });
  return { manifest, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

test('bump prints the changes and the verdict and exits 0 when nothing got worse', async () => {
  const { manifest, env } = await bumpFixture('echo "Passed! - Failed: 0, Passed: 1, Skipped: 0, Total: 1"');
  const r = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 pins changed in 1 files/);
  assert.match(r.stdout, /a\/a\.csproj Solid\.Core 2\.3\.2 -> 2\.3\.7-rc\.202611111530/);
  assert.match(r.stdout, /verdict: same/);
});

test('bump exits 1 and names the new failure when the after-run fails a test the baseline passed', async () => {
  const { manifest, env } = await bumpFixture('printf "  Failed Some.Test [12 ms]\\nFailed! - Failed: 1, Passed: 0, Skipped: 0, Total: 1\\n"; exit 1');
  const r = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /verdict: worse, new failures: Some\.Test/);
});

test('bump with no repo name exits 1 with a one-line reason first', () => {
  const r = run('bump');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bump needs a repo name/);
});

test('bump says no test result, not did not build, when the run produced no summary', async () => {
  const { manifest, env } = await bumpFixture('echo "Test Run Aborted."; exit 1');
  const r = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--manifest', manifest], { encoding: 'utf8', env });
  assert.match(r.stdout, /after: no test result/);
  assert.doesNotMatch(r.stdout, /did not build/);
});

test('bump --sln is resolved from the shell folder and a missing file is refused before anything runs', async () => {
  const { manifest, env } = await bumpFixture('echo "Passed! - Failed: 0, Passed: 1, Skipped: 0, Total: 1"');
  const r = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--sln', 'nope/Missing.sln', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--sln .*Missing\.sln.* does not exist/);
});

test('bump stops on a baseline with no test result and --allow-no-baseline lets it continue', async () => {
  const { manifest, env } = await bumpFixture('echo "Test Run Aborted."; exit 1');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(env.PATH.split(':')[0], 'dotnet'), '#!/bin/sh\necho "Test Run Aborted."\nexit 1\n');
  const stopped = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /--allow-no-baseline/);
  const go = spawnSync(process.execPath, [cli, 'bump', 'Lib', '--allow-no-baseline', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(go.status, 0, go.stderr);
  assert.match(go.stdout, /baseline: no test result, after: no test result/);
});

test('rc --remote without GITHUB_TOKEN exits 1 with one line naming it, and needs --root', async () => {
  const { writeFileSync } = await import('node:fs');
  const manifest = join(tmp('m'), 'stack.json');
  writeFileSync(manifest, JSON.stringify({ feed: tmp('feed'), remote: { source: tmp('remote') }, repos: [{ name: 'Lib', path: join(tmp('none'), 'missing'), platform: 'any', solution: 'x.sln', tests: [], packages: [] }] }));
  const env = { ...process.env, GITHUB_TOKEN: '' };
  const noRoot = spawnSync(process.execPath, [cli, 'rc', '--remote', '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(noRoot.status, 1);
  assert.match(noRoot.stderr, /--root/);
  const r = spawnSync(process.execPath, [cli, 'rc', '--remote', '--root', tmp('root'), '--manifest', manifest], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITHUB_TOKEN/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
});
