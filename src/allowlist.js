export class AllowlistError extends Error {
  constructor(expired) {
    super(`known-failing entries have expired: ${expired.map((e) => `${e.repo} ${e.test} (owner ${e.owner}, expired ${e.expires})`).join('; ')}`);
    this.name = 'AllowlistError';
  }
}

export function parseFailures(output) {
  const names = [];
  for (const line of output.split('\n')) {
    const m = /^\s*Failed (.+) \[[^\]]*\]\s*$/.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function hasSummary(output) {
  return /^(Failed|Passed)!\s+- Failed:\s+\d+/m.test(output);
}

export function evaluate({ failed, entries, now }) {
  const today = now.toISOString().slice(0, 10);
  const expired = entries.filter((e) => e.expires < today);
  const live = entries.filter((e) => e.expires >= today);
  const allowed = live.filter((e) => failed.includes(e.test));
  const stale = live.filter((e) => !failed.includes(e.test));
  const unexpected = failed.filter((t) => !live.some((e) => e.test === t));
  return { unexpected, allowed, expired, stale };
}

export function complete(output) {
  const runs = (output.match(/^Test run for /gm) ?? []).length;
  const totals = (output.match(/^(Failed|Passed)!\s+- Failed:\s+\d+/gm) ?? []).length;
  if (totals === 0 || totals < runs) return false;
  if (/Test Run Aborted|The active test run was aborted/.test(output)) return false;
  return !/: error [A-Z]+\d+:/.test(output);
}
