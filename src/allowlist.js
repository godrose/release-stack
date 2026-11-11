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
