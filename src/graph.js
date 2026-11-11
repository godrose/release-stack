export class ManifestOrderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestOrderError';
  }
}

export function buildGraph(repos, refs) {
  const owner = new Map();
  for (const r of repos) for (const p of r.packages) owner.set(p.id, r.name);
  const names = repos.map((r) => r.name);
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const r of repos) {
    for (const id of refs.get(r.name) ?? []) {
      const o = owner.get(id);
      if (o && o !== r.name) deps.get(r.name).add(o);
    }
  }
  names.forEach((name, i) => {
    for (const d of deps.get(name)) {
      if (names.indexOf(d) > i) {
        throw new ManifestOrderError(`${name} depends on ${d}, so ${d} must be listed before ${name} in the manifest`);
      }
    }
  });
  const dependents = (name) => {
    if (!deps.has(name)) throw new Error(`unknown repo ${name}`);
    const out = new Set();
    let grew = true;
    const seen = new Set([name]);
    while (grew) {
      grew = false;
      for (const n of names) {
        if (seen.has(n)) continue;
        if ([...deps.get(n)].some((d) => seen.has(d))) { seen.add(n); out.add(n); grew = true; }
      }
    }
    return names.filter((n) => out.has(n));
  };
  return { order: names, dependents };
}
