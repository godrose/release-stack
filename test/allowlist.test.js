import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFailures, hasSummary, evaluate } from '../src/allowlist.js';

const OUT = `Starting test execution, please wait...
[xUnit.net 00:00:00.30]     Using discovery aspect should discover required assemblies [FAIL]
  Failed Using discovery aspect should discover required assemblies [38 ms]
  Error Message:
   boom
  Failed Compose modules (a: [1, 2]) should create types [12 ms]
  Failed Using discovery aspect should discover required assemblies [38 ms]
Failed!  - Failed:     2, Passed:     2, Skipped:     0, Total:     4, Duration: 60 ms - X.dll (net6.0)
`;

test('parseFailures reads the failed test names once each and ignores the summary and xunit lines', () => {
  assert.deepEqual(parseFailures(OUT), ['Using discovery aspect should discover required assemblies', 'Compose modules (a: [1, 2]) should create types']);
});

test('hasSummary is false for an aborted run and true when dotnet printed its totals', () => {
  assert.equal(hasSummary(OUT), true);
  assert.equal(hasSummary('Testhost process exited with error\nThe specified framework could not be found\nTest Run Aborted.\n'), false);
  assert.equal(hasSummary('Passed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4, Duration: 5 ms - X.dll (net6.0)'), true);
});

const entry = (test, expires = '2026-12-31') => ({ test, owner: 'godrose', expires });

test('evaluate sorts failures into allowed, unexpected, stale and expired entries', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const entries = [entry('A'), entry('B'), entry('C', '2026-11-10')];
  const r = evaluate({ failed: ['A', 'X'], entries, now });
  assert.deepEqual(r.allowed.map((e) => e.test), ['A']);
  assert.deepEqual(r.unexpected, ['X']);
  assert.deepEqual(r.stale.map((e) => e.test), ['B']);
  assert.deepEqual(r.expired.map((e) => e.test), ['C']);
});

test('an expired entry does not allow its failing test, and the expiry day itself is still valid', () => {
  const r = evaluate({ failed: ['C'], entries: [entry('C', '2026-11-10')], now: new Date('2026-11-11T00:00:00Z') });
  assert.deepEqual(r.unexpected, ['C']);
  const last = evaluate({ failed: ['C'], entries: [entry('C', '2026-11-11')], now: new Date('2026-11-11T23:59:59Z') });
  assert.deepEqual([last.unexpected, last.expired], [[], []]);
});

import { complete } from '../src/allowlist.js';

const RUN = (n) => `Test run for /w/${n}/bin/Release/${n}.dll (.NETCoreApp,Version=v10.0)\n`;
const SUM = (n, f = 0) => `${f ? 'Failed!' : 'Passed!'}  - Failed:     ${f}, Passed:     1, Skipped:     0, Total:     1, Duration: 5 ms - ${n}.dll (net10.0)\n`;

test('complete needs one totals line per test run and no build error or abort', () => {
  assert.equal(complete(RUN('A') + SUM('A')), true);
  assert.equal(complete(RUN('A') + SUM('A') + RUN('B') + SUM('B', 1)), true);
});

test('complete is false when a project stopped compiling but another project printed totals', () => {
  const out = `/w/Broken/Broken.cs(3,5): error CS0029: Cannot implicitly convert type 'int' to 'string' [/w/Broken/Broken.csproj]\n${RUN('Pass')}${SUM('Pass')}`;
  assert.equal(complete(out), false);
});

test('complete is false when one test host crashed and another run printed totals', () => {
  const out = `${RUN('T')}${SUM('T', 1)}${RUN('T')}The active test run was aborted. Reason: Test host process crashed\nTest Run Aborted.\n`;
  assert.equal(complete(out), false);
  assert.equal(complete(`${RUN('T')}${SUM('T', 1)}${RUN('T')}Could not find 'dotnet' host for the 'X64' architecture.\n`), false);
});

test('complete is false with no totals at all', () => {
  assert.equal(complete('Test Run Aborted.\n'), false);
  assert.equal(complete(''), false);
});
