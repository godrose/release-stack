import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  setProjectVersion, setPackageRefVersion, listPackageRefs, listProjectRefs,
  setNuspecVersion, setNuspecDependency,
} from '../src/xml-edit.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p) => readFileSync(join(here, 'fixtures', p), 'utf8');
const NEW = '9.9.9-test';

function onlyVersionBytesChanged(original, edited, oldVersions) {
  let restored = edited;
  for (const v of oldVersions) restored = restored.replace(NEW, v);
  return restored === original;
}

test('attribute form: only the version bytes change, in every pin of that id', () => {
  const xml = fx('csproj/attribute-form.csproj');
  const r = setPackageRefVersion(xml, 'Solid.Core', NEW);
  assert.equal(r.changed, true);
  assert.deepEqual(r.old, ['2.3.6']);
  assert.ok(onlyVersionBytesChanged(xml, r.xml, r.old));
});

test('child form: <Version> inside a multi-line PackageReference is edited', () => {
  const xml = fx('csproj/child-form.csproj');
  const before = listPackageRefs(xml).find((p) => p.id === 'Attest.Tests.Core');
  assert.ok(before, 'fixture has the child-form pin');
  const r = setPackageRefVersion(xml, 'Attest.Tests.Core', NEW);
  assert.equal(r.changed, true);
  assert.deepEqual(r.old, [before.version]);
  assert.ok(onlyVersionBytesChanged(xml, r.xml, r.old));
  assert.equal(listPackageRefs(r.xml).find((p) => p.id === 'Attest.Tests.Core').version, NEW);
});

test('an outlier old pin is read and rewritten like any other', () => {
  const xml = fx('csproj/outlier-1.2.1-rc4.csproj');
  const r = setPackageRefVersion(xml, 'Solid.Practices.Modularity', NEW);
  assert.deepEqual(r.old, ['1.2.1-rc4']);
  assert.ok(onlyVersionBytesChanged(xml, r.xml, r.old));
});

test('a BOM, CRLF, tabs and trailing spaces survive byte for byte', () => {
  const xml = '﻿<Project Sdk="Microsoft.NET.Sdk">\r\n\t<ItemGroup>\r\n\t\t<PackageReference Include="Solid.Core" Version="2.3.6" />   \r\n\t</ItemGroup>\r\n</Project>\r\n';
  const r = setPackageRefVersion(xml, 'Solid.Core', NEW);
  assert.equal(r.xml, xml.replace('2.3.6', NEW));
  assert.ok(r.xml.startsWith('﻿'));
});

test('an id is matched exactly, so a longer id is left alone', () => {
  const xml = '<Project><ItemGroup><PackageReference Include="Solid.Practices.IoC.Adapters" Version="1.0.0" /><PackageReference Include="solid.practices.ioc" Version="2.3.6" /></ItemGroup></Project>';
  const r = setPackageRefVersion(xml, 'Solid.Practices.IoC', NEW);
  assert.deepEqual(r.old, ['2.3.6']);
  assert.ok(r.xml.includes('Include="Solid.Practices.IoC.Adapters" Version="1.0.0"'));
});

test('an id that is not referenced reports changed false and leaves the text identical', () => {
  const xml = fx('csproj/attribute-form.csproj');
  const r = setPackageRefVersion(xml, 'Not.There', NEW);
  assert.equal(r.changed, false);
  assert.equal(r.xml, xml);
  assert.deepEqual(r.old, []);
});

test('listPackageRefs and listProjectRefs read the fixtures', () => {
  assert.ok(listPackageRefs(fx('csproj/attribute-form.csproj')).some((p) => p.id === 'Solid.Core' && p.version === '2.3.6'));
  assert.deepEqual(listProjectRefs(fx('csproj/project-ref.csproj')), ['..\\Solid.Core\\Solid.Core.csproj']);
});

test('setProjectVersion edits the project Version and not a package pin', () => {
  const xml = fx('csproj/project-ref.csproj');
  const edited = setProjectVersion(xml, NEW);
  assert.equal(edited, xml.replace('<Version>2.3.6</Version>', `<Version>${NEW}</Version>`));
});

test('setProjectVersion throws when the project has no Version', () => {
  assert.throws(() => setProjectVersion('<Project Sdk="x"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>', NEW), /no <Version>/);
});

test('nuspec: the package version and one dependency version are edited, nothing else', () => {
  const xml = fx('nuspec/specflow.nuspec');
  const v = setNuspecVersion(xml, NEW);
  assert.match(v, new RegExp(`<version>${NEW}</version>`));
  assert.equal(v.split(NEW).length, 2, 'only the package version changed');
  const d = setNuspecDependency(xml, 'Solid.Core', NEW);
  assert.equal(d.changed, true);
  assert.deepEqual(d.old, ['2.3.6']);
  assert.ok(d.xml.includes(`<dependency id="Solid.Core" version="${NEW}" />`));
  assert.ok(d.xml.includes('<dependency id="Solid.Patterns.Builder" version="2.3.6" />'));
});

test('getProjectVersion reads the project Version and throws when there is none', async () => {
  const { getProjectVersion } = await import('../src/xml-edit.js');
  assert.equal(getProjectVersion(fx('csproj/project-ref.csproj')), '2.3.6');
  assert.throws(() => getProjectVersion('<Project><PropertyGroup /></Project>'), /no <Version>/);
});

test('setPackageRefVersions sets each occurrence of an id to its own version', async () => {
  const { setPackageRefVersions } = await import('../src/xml-edit.js');
  const xml = '<Project><ItemGroup><PackageReference Include="Solid.Core" Version="1.0.0" /><PackageReference Include="Solid.Core" Version="2.0.0" /></ItemGroup></Project>';
  const out = setPackageRefVersions(xml, 'Solid.Core', ['3.0.0', '4.0.0']);
  assert.equal(out, xml.replace('1.0.0', '3.0.0').replace('2.0.0', '4.0.0'));
  assert.throws(() => setPackageRefVersions(xml, 'Solid.Core', ['3.0.0']), /2 occurrences/);
});
