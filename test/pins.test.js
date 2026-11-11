import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePin } from '../src/pins.js';

const owners = new Map([['Solid.Core', 'Solid'], ['Solid.Common', 'Solid'], ['Attest.Fake.Core', 'Attest']]);
const base = (over) => ({
  owners, repo: 'Attest', kind: 'csproj', built: new Map(), rebuiltRepos: new Set(['Attest']), latest: null, ...over,
});

test('an id no repo in the manifest owns is never pinned', () => {
  assert.equal(resolvePin({ ...base(), id: 'Newtonsoft.Json' }), null);
});

test('a csproj pin to the repo\'s own package is left alone (it may be a deliberate older version)', () => {
  const ctx = base({ repo: 'Solid', rebuiltRepos: new Set(['Solid']), built: new Map([['Solid.Core', '2.3.7-rc.1']]) });
  assert.equal(resolvePin({ ...ctx, id: 'Solid.Core' }), null);
});

test('a nuspec dependency on the repo\'s own package gets the run version', () => {
  const ctx = base({ repo: 'Solid', kind: 'nuspec', rebuiltRepos: new Set(['Solid']), built: new Map([['Solid.Core', '2.3.7-rc.1']]) });
  assert.deepEqual(resolvePin({ ...ctx, id: 'Solid.Core' }), { version: '2.3.7-rc.1', fromRecord: null });
});

test('an upstream package rebuilt in this run gets the run version', () => {
  const ctx = base({ rebuiltRepos: new Set(['Solid', 'Attest']), built: new Map([['Solid.Core', '2.3.7-rc.1']]) });
  assert.deepEqual(resolvePin({ ...ctx, id: 'Solid.Core' }), { version: '2.3.7-rc.1', fromRecord: null });
});

test('an upstream package that was not rebuilt uses the latest record, and says which', () => {
  const latest = { runId: '202611111530', packages: [{ id: 'Solid.Core', version: '2.3.7-rc.202611111530' }] };
  assert.deepEqual(resolvePin({ ...base({ latest }), id: 'Solid.Core' }), { version: '2.3.7-rc.202611111530', fromRecord: '202611111530', owner: 'Solid' });
});

test('an upstream package with no record falls back to its stable pin', () => {
  assert.equal(resolvePin({ ...base(), id: 'Solid.Core' }), null);
});

test('a package of a rebuilt repo that was not built here (windows only) is not pinned', () => {
  const ctx = base({ rebuiltRepos: new Set(['Solid', 'Attest']), built: new Map([['Solid.Core', '2.3.7-rc.1']]) });
  assert.equal(resolvePin({ ...ctx, id: 'Solid.Common' }), null);
});
