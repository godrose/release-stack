import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, nextStable, rcVersion, publishedVersions } from '../src/version.js';

test('rcVersion formats the UTC minute', () => {
  assert.equal(rcVersion('2.3.7', new Date('2026-11-11T15:30:00Z')), '2.3.7-rc.202611111530');
});

test('rcVersion uses UTC, not local time', () => {
  assert.equal(rcVersion('2.4.7', new Date('2026-01-01T00:05:59Z')), '2.4.7-rc.202601010005');
});

test('nextStable bumps the patch of the higher of local and published stable', () => {
  assert.equal(nextStable('2.3.6', ['2.3.5', '2.3.6', '2.3.6-rc1']), '2.3.7');
  assert.equal(nextStable('2.3.8', ['2.3.6']), '2.3.9');
  assert.equal(nextStable('2.3.5', ['2.3.6']), '2.3.7');
});

test('nextStable keeps the base of an unreleased local prerelease', () => {
  assert.equal(nextStable('2.3.7-rc1', ['2.3.6']), '2.3.7');
  assert.equal(nextStable('2.3.7-rc1', ['2.3.6', '2.3.7']), '2.3.8');
});

test('compareSemver follows SemVer 2 ordering', () => {
  assert.equal(compareSemver('2.3.7-rc.1', '2.3.7'), -1);
  assert.equal(compareSemver('2.3.7', '2.3.7-rc.1'), 1);
  assert.equal(compareSemver('2.3.7-rc.202611121000', '2.3.7-rc.202611111530'), 1);
  assert.equal(compareSemver('2.3.7-rc1', '2.3.7-rc.202611111530'), 1);
  assert.equal(compareSemver('2.10.0', '2.9.0'), 1);
  assert.equal(compareSemver('2.3.7', '2.3.7+build5'), 0);
});

test('publishedVersions reads the flat container and treats 404 as no versions', async () => {
  const ok = async (url) => {
    assert.equal(url, 'https://api.nuget.org/v3-flatcontainer/solid.core/index.json');
    return { ok: true, status: 200, json: async () => ({ versions: ['2.3.5', '2.3.6'] }) };
  };
  assert.deepEqual(await publishedVersions('Solid.Core', ok), ['2.3.5', '2.3.6']);
  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.deepEqual(await publishedVersions('Nope.Pkg', missing), []);
  const broken = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => publishedVersions('Solid.Core', broken), /500/);
});
