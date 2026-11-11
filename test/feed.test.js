import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { publishStaging, FeedConflictError } from '../src/feed.js';
import { tmp, put } from './helpers.js';

test('publishStaging copies every nupkg and returns their names', async () => {
  const staging = tmp('stg');
  const feed = tmp('feed');
  put(staging, 'A.1.0.0-rc.1.nupkg', 'a');
  put(staging, 'B.1.0.0-rc.1.nupkg', 'b');
  put(staging, 'notes.txt', 'ignored');
  const names = await publishStaging(staging, feed);
  assert.deepEqual(names.sort(), ['A.1.0.0-rc.1.nupkg', 'B.1.0.0-rc.1.nupkg']);
  assert.deepEqual(readdirSync(feed).sort(), ['A.1.0.0-rc.1.nupkg', 'B.1.0.0-rc.1.nupkg']);
});

test('one existing file blocks the whole publish and nothing is copied', async () => {
  const staging = tmp('stg');
  const feed = tmp('feed');
  put(staging, 'A.1.0.0-rc.1.nupkg', 'new a');
  put(staging, 'B.1.0.0-rc.1.nupkg', 'new b');
  put(feed, 'B.1.0.0-rc.1.nupkg', 'old b');
  await assert.rejects(() => publishStaging(staging, feed), (e) =>
    e instanceof FeedConflictError && e.message.includes('B.1.0.0-rc.1.nupkg'));
  assert.deepEqual(readdirSync(feed), ['B.1.0.0-rc.1.nupkg']);
});
