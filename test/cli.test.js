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
