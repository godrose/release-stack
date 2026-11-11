# rc stack: Windows runner, GitHub Packages and `use --remote` (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, one branch and one PR per task, TDD). Steps use checkbox syntax.

**Goal:** A Windows GitHub Actions run builds Solid, Attest, LogoFX `core` and LogoFX `testing` at one run id and publishes them to GitHub Packages. A Mac with a token runs `use --remote <run-id>` and restores the whole stack from there.

**Architecture:** `rc` gets a remote origin: the same orchestration, but repos are checked out by the workflow, Windows-only repos are built because the platform matches, and staging is pushed with `dotnet nuget push` instead of copied into a folder. There is no remote record: `use --remote` finds the versions by listing each manifest package id on the feed and taking the one ending in `-rc.<run-id>`. `use --remote` maps every family id to the one remote source and never maps a family locally.

**Tech Stack:** Node 24 ESM, zero dependencies, `node:test`, GitHub Actions `windows-latest`, GitHub Packages NuGet (`https://nuget.pkg.github.com/godrose/index.json`).

**Spec:** docs/superpowers/specs/2026-11-11-rc-stack-design.md (author calls 5, 9, 10, D2; Acceptance 5).

## Rulings made in this plan (override if wrong)
- The runner builds everything, Solid and Attest included, at its own run id. A Mac run and a runner run never mix (D2).
- GitHub Packages is the shared feed. A token is needed to restore, even for public packages. Secrets come from environment variables only.
- Only LogoFX `core` and `testing` join the manifest now (Acceptance 5). The other 39 LogoFX repos stay `bump`-only until a later plan.
- Retention is decided in Task 1 from what GitHub offers; until then nothing deletes packages.

## Global Constraints
- No secret in any file, nuget.config or log. `nuget.config` may reference `%GITHUB_TOKEN%`-style environment variables only.
- The tool runs on macOS arm64 and on a Windows runner. No Python.
- One origin per consumer: `use --local` and `use --remote` are exclusive, `use` never maps one family locally and another remotely.
- bdd-netcore is private: never copy its content into this public repo.
- Never change an expected value to make a test pass; each fix test fails first.

## Review Focus
1. A `use --remote` run id with a package missing on the feed must refuse and change nothing, not map a partial stack.
2. A consumer already in local mode must be refused by `use --remote` (and the reverse) with the reason, nothing changed.
3. A token missing from the environment must give a one-line error naming the variable, not a restore failure later.
4. Re-running the workflow for the same run id (re-run of a failed job) must not fail on packages already pushed (`--skip-duplicate`) and must not publish a half stack as complete.
5. The runner must refuse to push if any test failed unexpectedly, same as the local `rc`.

## File Structure
```
.github/workflows/rc.yml     workflow_dispatch with a ref per repo
.github/workflows/spike-packages.yml   Task 1 only, removed at the end of Task 1
src/remote.js                push to a source, list versions of an id on a source
src/rc.js                    origin option (local | remote), runner platform
src/use.js                   use --remote
src/cli.js                   rc --remote, use --remote <run-id>
src/manifest.js              optional repos[].git, remote.source
stack.json                   LogoFX core and testing, remote source
docs/findings/github-packages.md   Task 1 result
```

### Task 1: Spike - GitHub Packages from a workflow

**Files:** Create `.github/workflows/spike-packages.yml`, `docs/findings/github-packages.md`.

- [ ] **Step 1:** Workflow (`workflow_dispatch`, `windows-latest`, `permissions: packages: write`) packs a tiny `Spike.Pack` 0.0.<run-number> and pushes it with `dotnet nuget push -s https://nuget.pkg.github.com/godrose/index.json -k ${{ secrets.GITHUB_TOKEN }} --skip-duplicate`. Branch `plan3/spike`, PR, merge (owner), then owner dispatches it (`gh workflow run spike-packages.yml`).
- [ ] **Step 2:** Verify and record in the findings file: (a) the push succeeds and the package shows under the account; (b) restore from the Mac with a classic PAT (`read:packages`) via a throwaway nuget.config using `%GH_TOKEN%`; (c) restore with no token fails and how; (d) the flat-container version listing works with the token (`https://nuget.pkg.github.com/godrose/download/spike.pack/index.json`) - this is what `use --remote` needs; (e) whether a package version can be deleted by API (`gh api -X DELETE`), and a retention proposal.
- [ ] **Step 3:** Stop and report if (d) does not work: `use --remote` then needs another way to find versions (a record uploaded as a release asset).
- Expected: findings file lists the exact commands and results. Delete the spike workflow and the spike package in the same PR.

### Task 2: Manifest - LogoFX `core` and `testing`, `git` and `remote`

**Files:** Modify `src/manifest.js`, `test/manifest.test.js`, `stack.json`, `spikes/pack-parity/gen-manifest.js`.

**Interfaces:**
- Produces: `Repo.git?: string` (clone URL, used by the workflow only), `Manifest.remote?: { source: string }` (a `https://` URL or an absolute folder path), both validated.

- [ ] **Step 1:** Tests: `git` not a string, or `remote.source` empty, throws `ManifestError` naming `repos[0].git` or `remote.source`; both absent loads as today.
- [ ] **Step 2:** Run `node --test test/manifest.test.js`, expect FAIL. Implement. Expect PASS.
- [ ] **Step 3:** Run pack parity for LogoFX `core` (`https://github.com/LogoFX/core.git`, `net6.0` and `net6.0-windows` projects, platform `windows`) and `testing` (`https://github.com/LogoFX/logofx-client-testing.git`, `netstandard2.0`, platform `any`, so it also builds on the Mac) with `src/parity.js`; extend `gen-manifest.js` so `stack.json` has both repos with `packages`, `tests`, `git`, and `remote.source` `https://nuget.pkg.github.com/godrose/index.json`. Real check: `node src/cli.js drift` still lists the 43 repos and `rc` on the Mac builds `testing` against the Solid rc (dry check: `rc --from Solid` then confirm the record). Branch `plan3/manifest`, PR.

### Task 3: `rc --remote` (runner origin)

**Files:** Create `src/remote.js`, `test/remote.test.js`. Modify `src/rc.js`, `src/cli.js`, `test/rc.test.js`.

**Interfaces:**
- Produces: `pushPackages(staging: string, source: string, apiKey: string): Promise<string[]>` running `dotnet nuget push <each .nupkg> -s <source> -k <apiKey> --skip-duplicate`; `listVersions(source: string, id: string, token?: string): Promise<string[]>` reading `<base>/<lowercase id>/index.json` (local folder sources: read the `.nupkg` names).
- `rc({ ..., origin: 'remote', root })`: repo path is `<root>/<name>`; platform `windows` repos are built when `process.platform === 'win32'`; staging is pushed to `manifest.remote.source` with `process.env.GITHUB_TOKEN` and the record is written to `<root>/records` (workflow artifact), never to the feed.

- [ ] **Step 1:** Tests with a local folder as the remote source: remote run pushes the nupkgs and no local feed is touched; a second push of the same run is a no-op (Review Focus 4); a missing `GITHUB_TOKEN` fails with one line naming it before anything builds (Review Focus 3); an unexpected failing test pushes nothing (Review Focus 5); on a non-Windows platform `windows` repos are still skipped.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement. Step 4: run all tests, expect PASS. Step 5: branch `plan3/remote-rc`, PR.

### Task 4: `use --remote <run-id>`

**Files:** Modify `src/use.js`, `src/cli.js`, `test/use.test.js`.

**Interfaces:**
- Consumes: `listVersions` from Task 3, `Manifest.remote`.
- Produces: `useRemote({ consumer, runId, manifest, listVersions? })`: for every manifest package id the version ending `-rc.<runId>` is found on the remote source; retargets the same pins `use --local` does; writes `nuget.config` mapping all manifest ids exactly to the remote source (credentials as `%GITHUB_TOKEN%` references) and nothing to the local feed; state records `origin: 'remote'`.

- [ ] **Step 1:** Tests (injected `listVersions`): a consumer pinned to Solid and Attest is retargeted to the run id versions and its nuget.config maps every id to the remote source and contains no secret and no local feed (Review Focus 3); a package without a version for that run id refuses and changes nothing (Review Focus 1); a consumer already in local mode is refused with the reason, and a remote consumer is refused by `use --local` (Review Focus 2); `use --stable` reverts a remote use exactly.
- [ ] **Step 2:** Run, expect FAIL. Step 3: implement reusing the revert and state code from `use --local`. Step 4: run all tests, expect PASS. Step 5: branch `plan3/use-remote`, PR.

### Task 5: The workflow and the acceptance run

**Files:** Create `.github/workflows/rc.yml`. Modify `README.md`.

- [ ] **Step 1:** `workflow_dispatch` with one input per repo (`solid_ref`, `attest_ref`, `core_ref`, `testing_ref`, default the repo default branch). On `windows-latest` with `permissions: packages: write`: checkout this repo, `actions/setup-node` 24, clone each manifest repo from its `git` URL at its ref into `${{ runner.temp }}/stack/<name>`, run `node src/cli.js rc --remote --root <that folder>` with `GITHUB_TOKEN`, upload `records/*.json` as an artifact. Third-party actions pinned to a version.
- [ ] **Step 2:** Acceptance 5 (owner dispatches): run it with `solid_ref=feat/reqnroll-adapter`, `attest_ref=feat/reqnroll-support`; confirm the packages of one run id appear, run `node src/cli.js use --remote <run-id>` on a copy of bdd-netcore (token in `GITHUB_TOKEN`), confirm the restore uses only the remote source and the Server fake suite passes (34 of 34 on the Mac).
- [ ] **Step 3:** README section for the runner and `use --remote`, retention note from Task 1. Branch `plan3/workflow`, PR. Put the run URL and the restore output in the PR.

## Self-Review
- Spec coverage: author calls 5, 9, 10 and D2 (Tasks 2 to 5), Acceptance 5 (Task 5), spike items 3 and 4 (Task 1).
- Known risk: the Windows build cannot be run locally. The first real signal is Task 5 and fixes may need a follow-up PR.
- Owner actions needed: merge PRs, dispatch the spike and the rc workflow, create a classic PAT with `read:packages` for the Mac.
- Left for later: `release` (Plan 4), the other LogoFX repos as build targets, deferred minors M1 to M9 and F8 to F11.
