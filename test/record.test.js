import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeRecord, latestRecord } from '../src/record.js';
import { tmp } from './helpers.js';

const rec = (runId) => ({ runId, createdAt: '2026-11-11T15:30:00.000Z', origin: 'local', repos: [], packages: [] });

test('latestRecord is null when there are no records', async () => {
  assert.equal(await latestRecord(tmp('feed')), null);
});

test('latestRecord returns the record with the highest run id', async () => {
  const feed = tmp('feed');
  await writeRecord(feed, rec('202611111530'));
  await writeRecord(feed, rec('202611121000'));
  await writeRecord(feed, rec('202611110900'));
  assert.equal((await latestRecord(feed)).runId, '202611121000');
});

test('a record is never overwritten', async () => {
  const feed = tmp('feed');
  await writeRecord(feed, rec('202611111530'));
  await assert.rejects(() => writeRecord(feed, rec('202611111530')), /already exists/);
});
