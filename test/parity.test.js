import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comparePackages } from '../src/parity.js';

const root = mkdtempSync(join(tmpdir(), 'parity-'));

function makePkg(name, { extraLib = false, jsonVersion = '13.0.3' } = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><PackageId>Probe</PackageId><Version>1.0.0</Version></PropertyGroup>
  <ItemGroup><PackageReference Include="Newtonsoft.Json" Version="${jsonVersion}" /></ItemGroup>
  ${extraLib ? '<ItemGroup><None Include="extra.txt" Pack="true" PackagePath="lib/net10.0/" /></ItemGroup>' : ''}
</Project>`);
  writeFileSync(join(dir, 'C.cs'), 'namespace Probe { public class C {} }');
  writeFileSync(join(dir, 'extra.txt'), 'x');
  execFileSync('dotnet', ['pack', join(dir, 'Probe.csproj'), '-o', join(dir, 'out'), '-v', 'q'], { stdio: 'pipe' });
  return join(dir, 'out', readdirSync(join(dir, 'out')).find((f) => f.endsWith('.nupkg')));
}

let plain, same, different;
before(() => {
  plain = makePkg('plain');
  same = makePkg('same');
  different = makePkg('different', { extraLib: true, jsonVersion: '13.0.1' });
});

test('identical packages report same', async () => {
  const r = await comparePackages(plain, same);
  assert.equal(r.same, true);
  assert.deepEqual(r.onlyInA, []);
  assert.deepEqual(r.onlyInB, []);
  assert.deepEqual(r.depsDiff, []);
});

test('an extra lib file and a different dependency version are both reported', async () => {
  const r = await comparePackages(plain, different);
  assert.equal(r.same, false);
  assert.deepEqual(r.onlyInB, ['lib/net10.0/extra.txt']);
  assert.deepEqual(r.onlyInA, []);
  assert.equal(r.depsDiff.length, 2);
  assert.ok(r.depsDiff.some((d) => d.includes('Newtonsoft.Json 13.0.3')));
  assert.ok(r.depsDiff.some((d) => d.includes('Newtonsoft.Json 13.0.1')));
});
