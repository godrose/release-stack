import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pushPackages, listVersions } from '../src/remote.js';
import { tmp } from './helpers.js';

function nupkg(dir, id, version) {
  const src = tmp('pk');
  writeFileSync(join(src, 'a.cs'), 'namespace A { public class B {} }');
  writeFileSync(join(src, 'p.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>netstandard2.0</TargetFramework><PackageId>${id}</PackageId><Version>${version}</Version></PropertyGroup></Project>`);
  execFileSync('dotnet', ['pack', join(src, 'p.csproj'), '-o', dir], { stdio: 'pipe' });
}

const all = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.nupkg'));

test('pushPackages pushes every nupkg, and pushing the same files again is not an error', async () => {
  const staging = tmp('staging');
  nupkg(staging, 'Remote.One', '1.0.0-rc.202611121000');
  nupkg(staging, 'Remote.Two', '1.0.0-rc.202611121000');
  const target = tmp('remote');
  assert.deepEqual((await pushPackages(staging, target, 'key')).sort(), ['Remote.One.1.0.0-rc.202611121000.nupkg', 'Remote.Two.1.0.0-rc.202611121000.nupkg']);
  assert.equal(all(target).length, 2);
  await pushPackages(staging, target, 'key');
  assert.equal(all(target).length, 2);
});

test('a failing push throws and names the packages that did not go', async () => {
  const staging = tmp('staging');
  nupkg(staging, 'Remote.Three', '1.0.0-rc.202611121000');
  await assert.rejects(() => pushPackages(staging, 'not a source', 'key'), /Remote\.Three\.1\.0\.0-rc\.202611121000\.nupkg/);
});

test('listVersions reads the versions of an id from a folder source', async () => {
  const staging = tmp('staging');
  nupkg(staging, 'Remote.Four', '1.0.0-rc.202611121000');
  nupkg(staging, 'Remote.Four', '1.0.0-rc.202611121100');
  const target = tmp('remote');
  await pushPackages(staging, target, 'key');
  assert.deepEqual((await listVersions(target, 'remote.four')).sort(), ['1.0.0-rc.202611121000', '1.0.0-rc.202611121100']);
  assert.deepEqual(await listVersions(target, 'Remote.Missing'), []);
});

test('listVersions on an http source reads the service index, sends the token and returns an empty list for a 404', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    if (req.url === '/feed/index.json') res.end(JSON.stringify({ resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': `http://127.0.0.1:${server.address().port}/flat/` }] }));
    else if (req.url === '/flat/some.id/index.json') res.end(JSON.stringify({ versions: ['1.0.0-rc.1', '1.0.0-rc.2'] }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const source = `http://127.0.0.1:${server.address().port}/feed/index.json`;
    assert.deepEqual(await listVersions(source, 'Some.Id', 'tok'), ['1.0.0-rc.1', '1.0.0-rc.2']);
    assert.ok(seen.every((h) => h === `Basic ${Buffer.from('token:tok').toString('base64')}`), seen.join());
    assert.deepEqual(await listVersions(source, 'Other.Id', 'tok'), []);
  } finally {
    server.close();
  }
});

test('an http source that answers 401 is an error, not an empty list', async () => {
  const server = createServer((req, res) => { res.statusCode = 401; res.end('{}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(() => listVersions(`http://127.0.0.1:${server.address().port}/feed/index.json`, 'Some.Id', 'bad'), /401/);
  } finally {
    server.close();
  }
});
