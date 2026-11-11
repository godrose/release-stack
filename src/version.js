function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) throw new Error(`not a semantic version: ${v}`);
  return { core: [m[1], m[2], m[3], m[4] ?? '0'].map(BigInt), pre: m[5] ? m[5].split('.') : [] };
}

function compareIdentifier(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareSemver(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 4; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const c = compareIdentifier(pa.pre[i], pb.pre[i]);
    if (c) return c;
  }
  return 0;
}

const coreOf = (v) => parse(v).core.slice(0, 3).join('.');
const bumpPatch = (core) => { const [a, b, c] = core.split('.').map(BigInt); return `${a}.${b}.${c + 1n}`; };

export function nextStable(local, published) {
  const stable = published.filter((v) => !parse(v).pre.length);
  const localCore = coreOf(local);
  const unreleasedPrerelease = parse(local).pre.length > 0;
  const top = stable.reduce((hi, v) => (compareSemver(v, hi) > 0 ? v : hi), localCore);
  if (unreleasedPrerelease && compareSemver(top, localCore) === 0 && !stable.includes(localCore)) return localCore;
  return bumpPatch(coreOf(top));
}

export function runStamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

export function rcVersion(base, now) {
  return `${base}-rc.${runStamp(now)}`;
}

export async function publishedVersions(id, fetchFn = fetch) {
  const res = await fetchFn(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`nuget.org returned ${res.status} for ${id}`);
  return (await res.json()).versions;
}
