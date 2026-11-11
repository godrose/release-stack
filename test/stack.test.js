import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStack } from '../src/stack.js';

const manifest = { families: { Solid: { prefix: 'Solid.' }, Attest: { prefix: 'Attest.' }, LogoFX: { prefix: 'LogoFX.', anchor: 'LogoFX.Core' } } };
const record = { runId: '202611111530', packages: [{ id: 'Solid.Core', version: '2.3.7-rc.202611111530' }, { id: 'Solid.Practices.IoC', version: '2.3.7-rc.202611111530' }, { id: 'Attest.Tests.Core', version: '2.4.7-rc.202611111530' }] };
const published = async (id) => (id === 'LogoFX.Core' ? ['2.2.6', '2.2.7', '2.2.8-rc1', '2.2.2'] : []);

test('families in the record take the record version and the others the latest stable of their anchor', async () => {
  assert.deepEqual(await currentStack(manifest, record, published), {
    Solid: { version: '2.3.7-rc.202611111530', source: 'rc' },
    Attest: { version: '2.4.7-rc.202611111530', source: 'rc' },
    LogoFX: { version: '2.2.7', source: 'stable' },
  });
});

test('with no record every family with an anchor comes from nuget and the others are left out', async () => {
  const s = await currentStack(manifest, null, published);
  assert.deepEqual(Object.keys(s), ['LogoFX']);
});

test('a failing nuget lookup leaves that family out instead of failing the command', async () => {
  const s = await currentStack(manifest, record, async () => { throw new Error('offline'); });
  assert.deepEqual(Object.keys(s).sort(), ['Attest', 'Solid']);
});
