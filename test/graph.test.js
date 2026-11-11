import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, ManifestOrderError } from '../src/graph.js';

const repo = (name, ids) => ({ name, packages: ids.map((id) => ({ id })) });
const solid = repo('Solid', ['Solid.Core', 'Solid.Practices.IoC']);
const attest = repo('Attest', ['Attest.Tests.Core']);
const logofx = repo('LogoFXCore', ['LogoFX.Core']);

const refs = new Map([
  ['Solid', ['Newtonsoft.Json']],
  ['Attest', ['Solid.Core', 'Solid.Practices.IoC', 'Newtonsoft.Json']],
  ['LogoFXCore', ['Attest.Tests.Core', 'Solid.Core']],
]);

test('order follows the manifest and dependents are transitive, in manifest order', () => {
  const g = buildGraph([solid, attest, logofx], refs);
  assert.deepEqual(g.order, ['Solid', 'Attest', 'LogoFXCore']);
  assert.deepEqual(g.dependents('Solid'), ['Attest', 'LogoFXCore']);
  assert.deepEqual(g.dependents('Attest'), ['LogoFXCore']);
  assert.deepEqual(g.dependents('LogoFXCore'), []);
});

test('a repo listed before the repo it depends on throws ManifestOrderError naming both', () => {
  assert.throws(() => buildGraph([attest, solid], refs), (e) =>
    e instanceof ManifestOrderError && e.message.includes('Attest') && e.message.includes('Solid'));
});

test('a repo referencing its own packages is not a dependency on itself', () => {
  const own = new Map([['Solid', ['Solid.Core']]]);
  const g = buildGraph([solid], own);
  assert.deepEqual(g.dependents('Solid'), []);
});

test('dependents of an unknown repo throws', () => {
  const g = buildGraph([solid], new Map());
  assert.throws(() => g.dependents('Nope'), /Nope/);
});
