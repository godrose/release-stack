# rc-stack Plan 1: local `rc` and `use` for Solid and Attest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command builds and tests Solid then Attest as an rc stack into a local folder feed, and one command points bdd-netcore at it and back.

**Architecture:** A zero-dependency Node CLI. A manifest (`stack.json`) lists repos in build order. `rc` builds each repo in a git worktree, rewrites versions with structured XML edits, runs tests, packs to a staging folder, and publishes to the feed only when every repo is green. `use` edits the consumer's pins and `nuget.config`, and records exactly what it changed.

**Tech Stack:** Node 24 (ESM, built-in `node:test`, built-in `fetch`), .NET SDK 10 at `~/.dotnet-arm64`, git worktrees, `tar` (bsdtar) for reading nupkgs.

**Spec:** `docs/superpowers/specs/2026-11-11-rc-stack-design.md`

**Scope of this plan:** spec milestone 1 (Solid and Attest, Mac, local feed, `use --local`). Later plans, each written after the previous one ships: (2) `drift` and `bump`, (3) the Windows Actions workflow, the remote feed and `use --remote`, (4) `release`.

## Global Constraints

- The tool runs on macOS arm64 and on a Windows Actions runner. No global Python.
- `.NET` runs with `DOTNET_ROOT=~/.dotnet-arm64 PATH=~/.dotnet-arm64:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1`.
- rc version format: `<base>-rc.<UTC yyyymmddHHMM>`. Base is the patch bump of the higher of the `.csproj` `<Version>` and the latest stable on nuget.org.
- Versions are edited with element-scoped edits, never by replacing the text `2.3.6`.
- `rc` builds in worktrees and never dirties the owner's checkouts. A dirty working tree is refused.
- Nothing is published unless every repo is green. Published versions are never overwritten.
- Solid and Attest `devops` scripts stay working and unchanged.
- No em-dashes anywhere. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and carry no session URL. Every commit is pushed to `origin/main`.

## Review Focus

Each line has a test in the task named.

1. A `.csproj` with a BOM, CRLF line endings, tabs and trailing spaces keeps every byte except the version (Task 4).
2. The same package is pinned as an attribute in one file and as a `<Version>` child in another, plus an old outlier pin (`Solid.Practices.Modularity 1.2.1-rc4`). `use` rewrites all of them and `use --stable` restores each (Task 8).
3. A test failure in the second repo publishes nothing and leaves the feed unchanged (Task 7).
4. A second run in the same UTC minute fails with a conflict instead of overwriting (Task 7).
5. A consumer file edited by hand after `use` is skipped on `use --stable` and reported, not clobbered (Task 8).

## File Structure

```
package.json                  type module, "test": "node --test"
stack.json                    manifest (Solid, Attest)
src/cli.js                    argv parsing, calls rc/use
src/manifest.js               load and validate stack.json
src/xml-edit.js               csproj version edits and reads
src/version.js                semver compare, nextStable, rcVersion
src/graph.js                  dependency graph and order check
src/worktree.js               worktree create/remove, clean check, tree hash
src/feed.js                   staging and folder-feed publish
src/record.js                 run records in the feed
src/parity.js                 compare a dotnet-packed nupkg with a published one
src/rc.js                     the rc orchestrator
src/use.js                    use / use --stable
test/*.test.js, test/fixtures/
docs/findings/*.md            results of the spikes
spikes/                       throwaway spike scripts
```

### Task 1: Scaffold and manifest

**Files:** Create `package.json`, `src/manifest.js`, `test/manifest.test.js`, `stack.json` (repos only, no packages yet), `README.md` (usage stub).

**Interfaces:**
- Produces: `loadManifest(path: string): Manifest`, throws `ManifestError` with the field path in the message.
- `Manifest = { feed: string, repos: Repo[] }`, `Repo = { name: string, path: string, platform: 'any'|'windows', tests: string[], packages: Pkg[] }`, `Pkg = { id: string, project: string, pack: 'dotnet'|'nuspec', nuspec?: string }`. Paths are relative to the manifest, `~` is expanded.

- [ ] **Step 1:** Write `test/manifest.test.js`: valid manifest loads; missing `repos[0].name` throws `ManifestError` naming `repos[0].name`; duplicate package id across repos throws; `pack: 'nuspec'` without `nuspec` throws.
- [ ] **Step 2:** Run `node --test test/manifest.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `loadManifest` in `src/manifest.js`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Write `stack.json` with `feed: "~/Workspace/packages/rc-feed"` and the repos `Solid` (`~/Workspace/Solid`) and `Attest` (`~/Workspace/Attest`), `platform: any`, empty `packages` and `tests` for now. Commit and push: `git commit -m "feat: scaffold the CLI and the manifest loader"`.

### Task 2: Spike, version ordering (can change the spec)

**Files:** Create `spikes/ordering/run.sh`, `docs/findings/version-ordering.md`.

- [ ] **Step 1:** In `spikes/ordering/run.sh`, create a tiny `netstandard2.0` library `Probe.Pkg` and pack versions `2.3.7-rc.202611111530`, `2.3.7-rc.202611121000`, `2.3.7-rc1`, `2.3.7` into a temp folder feed.
- [ ] **Step 2:** Make a consumer project that references `Probe.Pkg` as `2.3.7-rc.*` and restore with only that feed. Record which version restore picks (`obj/project.assets.json`).
- [ ] **Step 3:** Repeat with an exact pin of each version, and with `Version="2.3.7-rc.202611111530"` plus a second reference path that needs `>= 2.3.7-rc.202611111530` to confirm no NU1605/NU1107.
- [ ] **Step 4:** Write `docs/findings/version-ordering.md`: the picks and the verdict. Expected: floating `2.3.7-rc.*` picks `rc.202611121000`. If the 12-digit identifier misorders, change the format in the spec (Versions section) and in Global Constraints to a form that orders correctly, and say so in the findings. Commit and push.

### Task 3: Spike and parity tool, `dotnet pack` against the published packages

**Files:** Create `src/parity.js`, `test/parity.test.js`, `spikes/pack-parity/run.js`, `docs/findings/pack-parity.md`. Modify `stack.json`.

**Interfaces:**
- Produces: `comparePackages(a: string, b: string): Promise<ParityReport>` where `a`, `b` are nupkg paths and `ParityReport = { same: boolean, onlyInA: string[], onlyInB: string[], depsDiff: string[] }`. It lists `lib/**` files and `<dependency>` entries from the nuspec, read with `tar -xOf`. File lists compare `lib/` entries only. Dependency ids and versions compare after normalising group order.

- [ ] **Step 1:** Write `test/parity.test.js` with two tiny hand-built nupkgs (made by `dotnet pack` in a temp folder): identical packages report `same: true`; a package with one extra `lib/` file and one different dependency version reports both.
- [ ] **Step 2:** Run it, expect FAIL. Implement `comparePackages`, run it, expect PASS.
- [ ] **Step 3:** In `spikes/pack-parity/run.js`, for every package of Solid and Attest: take the id from each `devops/pack/*/contents/*.nuspec`, find the project from the `robocopy ... <Name>.*` glob in that folder's `pack.bat`, run `dotnet pack <project> -c Release -p:Version=2.3.6` (Attest `2.4.6`), download the published nupkg from `https://api.nuget.org/v3-flatcontainer/<id>/<version>/<id>.<version>.nupkg`, and compare with `comparePackages`.
- [ ] **Step 4:** For each package that differs, try `dotnet pack <project> -p:NuspecFile=<nuspec> -p:NuspecBasePath=<contents dir>` and compare again. Record per package one of `dotnet`, `nuspec` or `blocked` in `docs/findings/pack-parity.md`.
- [ ] **Step 5:** Fill the `packages` arrays and each repo's `tests` in `stack.json` from the findings. The Solid and Attest test projects are the ones listed in `devops/test/test-all.bat` (run as `dotnet test <project> -c Release`). Packages marked `blocked` stop the plan: report to the owner before continuing. Commit and push.

### Task 4: Structured version edits

**Files:** Create `src/xml-edit.js`, `test/xml-edit.test.js`, `test/fixtures/csproj/*.csproj` (copied from real Solid, Attest and bdd-netcore files: attribute form, `<Version>` child form, multi-line form, `1.2.1-rc4` outlier).

**Interfaces:**
- Produces: `setProjectVersion(xml: string, version: string): string`, edits the first `<Version>` inside a `<PropertyGroup>`.
- `setPackageRefVersion(xml: string, id: string, version: string): { xml: string, old: string[], changed: boolean }`, handles `Version="x"` and a `<Version>x</Version>` child, matches `Include` exactly and case-insensitively.
- `listPackageRefs(xml: string): { id: string, version: string }[]`, `listProjectRefs(xml: string): string[]`.

- [ ] **Step 1:** Write the tests: each fixture round-trips with only the version bytes changed (compare with a byte diff); the BOM, CRLF, tab and trailing-space fixture (Review Focus 1); `Solid.Practices.IoC` does not match `Solid.Practices.IoC.Adapters`; an id with no version returns `changed: false`.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement with element-scoped regexes that touch only the matched value. Step 4: run, expect PASS. Step 5: commit and push.

### Task 5: Versions and the dependency graph

**Files:** Create `src/version.js`, `src/graph.js`, `test/version.test.js`, `test/graph.test.js`.

**Interfaces:**
- `compareSemver(a: string, b: string): -1|0|1` with SemVer 2 rules, `nextStable(local: string, published: string[]): string` (patch bump of the higher stable, ignoring prereleases), `rcVersion(base: string, now: Date): string`, `latestStable(id: string): Promise<string[]>` returns all published versions from nuget.org flat container.
- `buildGraph(repos: Repo[], refs: Map<string, string[]>): Graph`, where `refs` maps repo name to the package ids it references. `Graph = { order: string[], dependents(name: string): string[] }`. It throws `ManifestOrderError` if the manifest order is not a valid topological order.

- [ ] **Step 1:** Tests: `rcVersion('2.3.7', new Date('2026-11-11T15:30:00Z')) === '2.3.7-rc.202611111530'`; `nextStable('2.3.6', ['2.3.5','2.3.6','2.3.6-rc1']) === '2.3.7'`; `nextStable('2.3.8', ['2.3.6']) === '2.3.9'`; `compareSemver('2.3.7-rc.1','2.3.7') === -1`; Attest listed before Solid throws; `dependents('Solid')` is `['Attest']`.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS. Step 5: commit and push.

### Task 6: Worktrees, feed and run records

**Files:** Create `src/worktree.js`, `src/feed.js`, `src/record.js`, `test/worktree.test.js`, `test/feed.test.js`, `test/record.test.js`.

**Interfaces:**
- `assertClean(repoPath: string): Promise<void>`, throws `DirtyTreeError` listing the files.
- `createWorktree(repoPath: string, ref: string, dest: string): Promise<{ path: string, sha: string, treeHash: string }>`, `removeWorktree(repoPath: string, path: string): Promise<void>`.
- `publishStaging(stagingDir: string, feedDir: string): Promise<string[]>`, copies every `*.nupkg`, throws `FeedConflictError` before copying anything if any file already exists.
- `Record = { runId: string, createdAt: string, origin: 'local', repos: RepoRecord[], packages: { id: string, version: string }[] }`, `RepoRecord = { name, ref, sha, treeHash, version, rebuilt: boolean, upstream: { [repo: string]: { version: string, fromRecord: string|null } } }`.
- `writeRecord(feedDir: string, rec: Record): Promise<void>` to `<feed>/records/<runId>.json`, `latestRecord(feedDir: string): Promise<Record|null>`.

- [ ] **Step 1:** Tests against a temp git repo: dirty file refused with its name; worktree at a branch ref returns the right sha and tree hash and leaves the main checkout untouched; `publishStaging` into a feed that already has one of the files throws and copies nothing; `latestRecord` returns the newest by `runId`.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS. Step 5: commit and push.

### Task 7: The `rc` orchestrator

**Files:** Create `src/rc.js`, `test/rc.test.js`, `test/fixtures/make-stack.js` (builds two tiny git repos in a temp dir: `LibA` with one package, `LibB` whose `.csproj` has a `PackageReference` to `LibA` and a test project, plus a `stack.json` for them).

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces: `rc(opts: { manifestPath: string, from?: string, refs?: Record<string, string>, now?: Date, log?: (s: string) => void }): Promise<Record>`.
- Per repo, in manifest order: `assertClean`, `createWorktree` (ref from `opts.refs[name]`, default the repo's current branch), compute the base with `nextStable` and the rc version with `rcVersion`, set `<Version>` in each package project, set pins to upstream packages (rebuilt in this run: the run version; not rebuilt with `--from`: the latest record's version, else the stable one), `dotnet test` each test project, `dotnet pack` each package into `<tmp>/staging` using the mode in the manifest. Restore reads staging as an extra source (`-p:RestoreAdditionalProjectSources=<staging>`).
- After every repo is green: `publishStaging`, `writeRecord`, remove worktrees and staging. On any failure: remove worktrees and staging, publish nothing, rethrow.

- [ ] **Step 1:** Tests on the fixture: (a) full run publishes `LibA` and `LibB` at the same run id and `LibB`'s nuspec depends on `LibA` at the rc version; (b) a failing test in `LibB` leaves the feed folder empty and removes the staging and worktrees (Review Focus 3); (c) a second run with the same `now` throws `FeedConflictError` and the feed is unchanged (Review Focus 4); (d) `--from LibB` after (a) keeps `LibA` out of the build, pins `LibB` to `LibA`'s version from the latest record and the new record says `fromRecord` is the earlier run id; (e) a dirty `LibB` checkout is refused before anything is built.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement `rc` with `child_process` for `dotnet` and `git`, logging each step. Step 4: run, expect PASS. Step 5: commit and push.

### Task 8: `use` and `use --stable`

**Files:** Create `src/use.js`, `test/use.test.js`, `test/fixtures/consumer/` (a small tree with csproj files in the attribute form, the child form and the `1.2.1-rc4` outlier, no `nuget.config`).

**Interfaces:**
- `use(opts: { consumer: string, feedDir: string }): Promise<UseReport>`: reads `latestRecord`, rewrites every `PackageReference` whose id is in the record (all `*.csproj` under the consumer, skipping `obj`, `bin`, `node_modules`), writes `nuget.config` with `packageSourceMapping`: the rc feed source maps each exact package id in the record, `nuget.org` maps `*`. Writes `.rc-stack/use.json` listing `{ file, id, old, new }` entries and whether `nuget.config` was created.
- `useStable(opts: { consumer: string }): Promise<UseReport>`: restores each entry whose current value still equals `new`, skips and reports the others, removes `nuget.config` only if `use` created it and it is unchanged, then removes `.rc-stack`.
- A consumer that already has `packageSourceMapping` in its `nuget.config` is refused with a clear message.

- [ ] **Step 1:** Tests: all three pin forms are rewritten and then restored byte for byte (Review Focus 2); a file edited by hand after `use` is skipped and reported by `useStable` (Review Focus 5); a consumer with its own `packageSourceMapping` is refused and nothing changes; `use` twice is a no-op.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS. Step 5: commit and push.

### Task 9: CLI and the acceptance runs

**Files:** Create `src/cli.js`. Modify `README.md`.

**Interfaces:**
- `node src/cli.js rc [--from <repo>] [--ref <repo>=<ref>]...`, `node src/cli.js use --local <consumer>`, `node src/cli.js use --stable <consumer>`. Exit code 0 on success, 1 with a one-line reason on failure.

- [ ] **Step 1:** Wire the commands to `rc`, `use` and `useStable`. Add one CLI test that runs `use --stable` on a consumer with no `.rc-stack` and expects a clear message and exit 1.
- [ ] **Step 2 (acceptance 1):** Check out Solid `feat/reqnroll-adapter` and Attest `feat/reqnroll-support` (both clean). Run `node src/cli.js rc --ref Solid=feat/reqnroll-adapter --ref Attest=feat/reqnroll-support`. Expected: both repos tested, a feed containing the SpecFlow and Reqnroll packages (`Solid.IoC.Adapters.Reqnroll`, `Attest.Tests.Reqnroll` among them), and a record naming both commits.
- [ ] **Step 3:** In `~/Workspace/bdd-netcore` on `spike/reqnroll`, run `node src/cli.js use --local ~/Workspace/bdd-netcore`, then the Server fake suite without `RestoreAdditionalProjectSources` (`dotnet test specs/BDD.NetCore.Specifications.Server.Mac.sln -c ServerWithFake --filter "Category!=real-executor"`). Expected: 34 passed, 0 failed.
- [ ] **Step 4 (acceptance 2):** In a Solid branch make a deliberate one-line change (a visible behaviour change covered by a Solid test or checked in bdd-netcore), commit it, run `rc` and `use` again, confirm the change reaches bdd-netcore with no manual version edit. Then `use --stable` and confirm `git status` in bdd-netcore is clean apart from untracked files that were already there.
- [ ] **Step 5:** Write the run commands into `README.md`, commit and push. Delete the throwaway Solid change.

## Self-Review

- **Spec coverage:** manifest (T1), versions and ordering (T2, T5), packing and `NuspecFile` (T3), `rc` including worktrees, staging, records, partial runs (T6, T7), `use --local` and `--stable` with exact-id mapping (T8), acceptance 1 and 2 (T9). Milestones 2 to 4 (`drift`, `bump`, the workflow, `use --remote`, `release`) are later plans by design. The check that `use` refuses a graph needing an rc-only LogoFX package belongs to Plan 3, when LogoFX enters the manifest.
- **Deviation from the spec:** `--allow-dirty` (spec call 1) is not built. A dirty tree is always refused, because building from HEAD while ignoring the edits would mislead. Revisit if needed.
- **Open dependency:** Task 3 can end with a `blocked` package. That stops the plan and goes to the owner.
