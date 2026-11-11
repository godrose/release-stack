// Decides which version a dependency pin gets during an rc run.
// Returns { version, fromRecord, owner? } or null when the pin must stay as it is.
export function resolvePin({ id, repo, kind, owners, built, rebuiltRepos, latest }) {
  const owner = owners.get(id);
  if (!owner) return null;
  if (owner === repo) {
    return kind === 'nuspec' && built.has(id) ? { version: built.get(id), fromRecord: null } : null;
  }
  if (built.has(id)) return { version: built.get(id), fromRecord: null };
  if (rebuiltRepos.has(owner)) return null;
  const fromRecord = latest?.packages.find((p) => p.id === id);
  return fromRecord ? { version: fromRecord.version, fromRecord: latest.runId, owner } : null;
}
