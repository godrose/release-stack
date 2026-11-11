# rc-stack Plan 2: drift, bump and the known-failing allowlist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `drift` (read-only table of every repo against the current stack), `bump <repo>` (retarget one lagging repo onto the current stack and compare its tests with a baseline), and the known-failing allowlist for `rc`.

**Architecture:** The manifest gains `families` (which package ids belong to Solid, Attest, LogoFX), `scan` (folders whose child repos `drift` and `bump` see) and per-repo `knownFailing` entries. Scanning reads `PackageReference` pins with the existing `xml-edit.js`. The current stack is the latest rc record, falling back to the latest stable on nuget.org for a family the record does not contain. `bump` edits in place, never touches `nuget.config`, and restores through `-p:RestoreAdditionalProjectSources=<feed>`.

**Tech Stack:** Node 24, ESM, zero dependencies, `node:test`. Same as Plan 1.

**Spec:** `docs/superpowers/specs/2026-11-11-rc-stack-design.md` (Commands, Acceptance 3 and 4, author calls 4, 6, 11, 12). Plan 1: `docs/superpowers/plans/2026-11-11-rc-stack-local-rc-and-use.md`.

## Global Constraints

- Node only, no dependencies, no global Python. Must also run on a Windows runner (use `node:path`, no shell pipelines).
- No em-dashes anywhere (code, comments, docs, commits, PR bodies). Short sentences, no redundant code comments.
- Commit and PR bodies omit session URLs. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- One branch and one PR per task group, merged with a merge commit so it can be reverted. Never force-push or rewrite `main`.
- Never change an expected value to make a test pass. A regression test must fail before the fix.
- `drift` never writes anything. `bump` writes only version values in `.csproj` files and never commits.
- Environment for dotnet: `DOTNET_ROOT=~/.dotnet-arm64 PATH=~/.dotnet-arm64:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1`.
- The machine has git `core.autocrlf=true`. Fixtures that need exact bytes are marked `-text`.
- Many repos under `~/Workspace/logofx-project` have uncommitted work (for example `core` on `chore/bump-deps`). Real acceptance runs touch only a clean repo and undo with `git checkout .`.

## Review Focus

Each line has a test in the task named.

1. `bump` on a repo with uncommitted changes to tracked files refuses and changes nothing. `drift` still lists that repo and shows it as dirty (Tasks 3 and 5).
2. A pin without a literal version (central package management, props-driven) does not crash `drift`. It is counted as `unresolved` and shown (Task 2).
3. A known-failing entry whose `expires` date has passed fails the run even when its test passes or is not run (Task 4).
4. A test that fails and is not in the allowlist still fails `rc` and publishes nothing, exactly as in Plan 1 (Task 4).
5. `bump` where the after-run fails a test that passed in the baseline exits 1 and says which test. Identical failures or fewer failures exit 0 (Task 5).
6. A directory in a scan root that is not a git repo, or a repo with no `.csproj`, is listed or skipped without an error (Task 3).

## File Structure

```
stack.json                 add families, scan, knownFailing
src/manifest.js            validate the three new fields
src/scan.js                list repos in the scan roots, read a repo's pins
src/stack.js               the current stack per family
src/drift.js               drift rows and the table text
src/allowlist.js           parse failed tests, evaluate against entries
src/bump.js                the bump command
src/rc.js                  use the allowlist, CommandError keeps stdout
src/cli.js                 drift and bump commands
test/*.test.js, README.md
```

### Task 1: Manifest fields

**Files:** Modify `src/manifest.js`, `test/manifest.test.js`, `stack.json`.

**Interfaces:**
- Produces: `Manifest.families: { [name: string]: { prefix: string, anchor?: string } }`, `Manifest.scan: string[]` (`~` expanded, each must exist), `Repo.knownFailing: { test: string, owner: string, expires: string }[]` (`expires` is `YYYY-MM-DD`). All three default to `{}`, `[]`, `[]`.

- [ ] **Step 1:** Tests: a manifest with the new fields loads; a `knownFailing` entry without `owner` or with `expires: '11/11/2026'` throws `ManifestError` naming `repos[0].knownFailing[0].owner` or `.expires`; a `scan` root that does not exist throws naming `scan[0]`; two families with the same prefix throw.
- [ ] **Step 2:** Run `node --test test/manifest.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the validation in `loadManifest`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Add to `stack.json`: `families` `Solid` (`Solid.`), `Attest` (`Attest.`), `LogoFX` (`LogoFX.`, anchor: an id that exists on nuget.org, check with `curl https://api.nuget.org/v3-flatcontainer/<id>/index.json` and pick one that LogoFX repos actually pin), `scan: ["~/Workspace/logofx-project"]`. Branch `plan2/manifest`, commit, push, open a PR.

### Task 2: Scanning a repo's pins

**Files:** Create `src/scan.js`, `test/scan.test.js`.

**Interfaces:**
- Produces: `listRepos(manifest: Manifest): Promise<{ name: string, path: string }[]>`: every manifest repo plus every immediate child of a `scan` root that contains `.git`, sorted by name, no duplicates by path.
- Produces: `scanRepo(repoPath: string, families: Manifest['families']): Promise<RepoPins>` with `RepoPins = { branch: string, dirty: number, pins: { [family: string]: string[] }, unresolved: number }`. `dirty` counts tracked files with changes (untracked files are not counted). `pins` holds the distinct versions per family, sorted by `compareSemver`. `unresolved` counts package references of a family id that have no literal version. Skips `obj`, `bin`, `Bin`, `node_modules`, `.git`.

- [ ] **Step 1:** Tests on temp git repos: pins in the attribute form, the `<Version>` child form and the outlier `1.2.1-rc4` give the right distinct sorted versions per family; a reference with no `Version` counts as `unresolved` and does not throw (Review Focus 2); an untracked new file leaves `dirty` at 0 and a modified tracked file makes it 1; `listRepos` includes a manifest repo and a scanned child and skips a child without `.git`.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement with `listPackageRefs` from `xml-edit.js` and `git status --porcelain` (raw, as in `worktree.js`). Step 4: run, expect PASS. Step 5: branch `plan2/scan`, commit, push, PR.

### Task 3: The current stack and `drift`

**Files:** Create `src/stack.js`, `src/drift.js`, `test/stack.test.js`, `test/drift.test.js`. Modify `src/cli.js`, `README.md`.

**Interfaces:**
- Consumes: `loadManifest`, `latestRecord`, `listRepos`, `scanRepo`, `publishedVersions`, `compareSemver`.
- Produces: `currentStack(manifest: Manifest, record: Record | null, published: (id: string) => Promise<string[]>): Promise<{ [family: string]: { version: string, source: 'rc' | 'stable' } }>`. A family with a package in the record takes the highest record version of its packages (`source: 'rc'`). A family without one takes the highest stable version of its `anchor` from `published` (`source: 'stable'`). A family with neither is left out.
- Produces: `drift(opts: { manifestPath: string, published?: ... }): Promise<{ stack, rows: DriftRow[] }>`, `DriftRow = { name: string, branch: string, dirty: number, versions: { [family: string]: string[] }, unresolved: number, status: 'current' | 'lagging' | 'none' }`. `none` means no family pins. `current` means every pin of every family in the stack equals the stack version. Everything else is `lagging`.
- Produces: `formatDrift(result): string`, a fixed-width table: `repo  branch  dirty  Solid  Attest  LogoFX  status`, the current stack on the first line, `a,b` for several versions, `-` for none.
- CLI: `node src/cli.js drift [--json]`, exit 0.

- [ ] **Step 1:** Tests: `currentStack` takes the rc version for Solid and Attest from a record and the stable version for LogoFX through an injected `published`; with no record every family comes from `published`; `drift` rows for a fixture of three repos (one on the current versions, one on older ones, one with no pins and no `.csproj`) give `current`, `lagging`, `none` and keep the dirty count (Review Focus 1, 6); a scan root with a plain folder inside does not throw; `formatDrift` output contains each repo name and `lagging`.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement, wire the CLI (`--json` prints the result object). Step 4: run, expect PASS. Step 5: run the real command `node src/cli.js drift` and check that it lists every repo under `~/Workspace/logofx-project`, Solid and Attest (Acceptance 3); paste the first lines into the PR. Branch `plan2/drift`, commit, push, PR.

### Task 4: The known-failing allowlist

**Files:** Create `src/allowlist.js`, `test/allowlist.test.js`. Modify `src/rc.js`, `test/rc.test.js`, `test/fixtures/make-stack.js`, `README.md`.

**Interfaces:**
- Produces: `parseFailures(output: string): string[]`: the test names from lines like `  Failed <name> [12 ms]` in `dotnet test` output, in order, no duplicates.
- Produces: `evaluate(input: { failed: string[], entries: KnownFailing[], now: Date }): { unexpected: string[], allowed: KnownFailing[], expired: KnownFailing[], stale: KnownFailing[] }`. An entry is expired when `now` (UTC date) is after `expires`. `allowed` are non-expired entries whose test failed, `stale` are non-expired entries whose test did not fail, `unexpected` are failures matching no non-expired entry.
- Changes: `CommandError` keeps `stdout` and `stderr` as properties.
- Changes: `rc` checks every repo's entries before building and throws `AllowlistError` (names repo, test, owner, expiry) if any is expired. After a failed `dotnet test`, it keeps going only when `parseFailures` finds at least one failure and `unexpected` is empty. Otherwise it rethrows as before. It logs every entry on every run as `known failing: <repo> <test> (owner <o>, expires <d>)` and `stale` ones as such.

- [ ] **Step 1:** Unit tests: `parseFailures` on a real-looking `dotnet test` excerpt; `evaluate` for allowed, stale, unexpected and expired; the day of `expires` itself is still valid.
- [ ] **Step 2:** Integration tests in `test/rc.test.js` with a fixture repo that has one test failing on purpose: (a) listed and not expired, the run publishes and the log contains the entry (b) listed but expired, the run throws `AllowlistError` before building and the feed is empty (Review Focus 3) (c) not listed, the run fails and publishes nothing (Review Focus 4) (d) listed and expired while the test passes still fails the run (e) a test run that aborts with no parsable failure (for example a missing framework) is never treated as allowed.
- [ ] **Step 3:** Run, expect FAIL. Step 4: implement. Step 5: run all tests, expect PASS. Then, in `stack.json`, add Solid's `IntegrationTests.App` back to `tests` only if its failing test names are stable across two `rc` runs; if so add the entries with owner `godrose` and an expiry 30 days out, otherwise leave it excluded and say so in the PR. Branch `plan2/allowlist`, commit, push, PR.

### Task 5: `bump`

**Files:** Create `src/bump.js`, `test/bump.test.js`. Modify `src/cli.js`, `README.md`.

**Interfaces:**
- Consumes: `drift` data (`currentStack`, `listRepos`), `latestRecord`, `listPackageRefs`, `setPackageRefVersion`, `assertClean`, `parseFailures`.
- Produces: `bump(opts: { manifestPath: string, repo: string, sln?: string, runTests?: (repoPath: string, feedDir: string) => Promise<TestResult>, published?: ... }): Promise<BumpReport>`.
- `TestResult = { built: boolean, failed: string[] }`. `BumpReport = { repo: string, changed: { file: string, id: string, old: string[], new: string }[], baseline: TestResult, after: TestResult, verdict: 'same' | 'better' | 'worse', newFailures: string[] }`.
- Behaviour: resolve `repo` by name among `listRepos`; refuse a repo with changes to tracked files (`DirtyTreeError`, nothing changed, Review Focus 1); run the baseline tests; rewrite, in every `.csproj`, the pins of package ids that appear in the latest record to the record's version (nothing else, no `nuget.config`); run the tests again; leave everything uncommitted. `verdict` is `worse` when `after.failed` has a name not in `baseline.failed`, or the baseline built and the after-run did not. It is `better` when the baseline did not build or had failures the after-run lacks and nothing is new. Otherwise `same`.
- Default `runTests`: `dotnet test <sln> -c Release -p:RestoreAdditionalProjectSources=<feed>`; `<sln>` is the only `.sln` in the repo root or `src/`, else `opts.sln` is required and a clear error says so. `built` is false when the run produces no test summary line.
- CLI: `node src/cli.js bump <repo> [--sln <path>]`. Prints the changed pins (count and first lines), baseline and after results, and the verdict. Exit 1 when the verdict is `worse`.

- [ ] **Step 1:** Unit tests with an injected `runTests` on a temp git repo whose `.csproj` pins a `Solid.*` id and an unrelated id: only the `Solid.*` version changes and a byte diff shows nothing else changed; a repo with a modified tracked file is refused and the bytes are unchanged (Review Focus 1); baseline `{failed: ['A']}` and after `{failed: ['A']}` gives `same` and exit 0; after `{failed: ['A','B']}` gives `worse`, `newFailures: ['B']` and exit 1; after `{failed: []}` gives `better`; an unknown repo name lists the known names in the error (Review Focus 5).
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement. Step 4: run all tests, expect PASS.
- [ ] **Step 5 (acceptance 4):** Pick one clean lagging LogoFX repo from the `drift` output (for example `cl-bs`). Run `node src/cli.js bump <repo>`. Check `git diff --stat` there touches only `.csproj` files and `git diff` shows only version values, report the verdict, then undo with `git checkout .` and confirm `git status` is clean. Put the output in the PR. Branch `plan2/bump`, commit, push, PR.

## Self-Review

- **Spec coverage:** drift and Acceptance 3 (Tasks 1 to 3), bump and Acceptance 4 with the baseline rule (Task 5), author call 11 allowlist with owner and expiry and printing every entry every run (Task 4), call 12 (`bump` is the only path for repos outside the manifest, Task 5), call 4 (`bump` edits in place and leaves changes uncommitted, Task 5).
- **Rulings made in this plan (override if wrong):** the current stack is the latest rc record, with latest stable of the family anchor as the fallback. `bump` retargets only ids present in the latest rc record. `bump` refuses dirty tracked files instead of stashing. Untracked files do not count as dirty. A test run that aborts without a parsable failure is never allowed by the allowlist.
- **Left for later plans:** the Windows workflow and `use --remote` (Plan 3), `release` (Plan 4), LogoFX in the manifest as a build target (Plan 3), and the deferred minors M1 to M9 from the Plan 1 review.
