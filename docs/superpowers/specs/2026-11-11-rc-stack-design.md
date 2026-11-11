# rc-stack: release the Solid, Attest and LogoFX stack fast

Status: draft for approval. Date: 2026-11-11. Owner: Gennady Verdel.

## Intent and why

Gennady maintains three families of NuGet packages that sit under his test projects:

- Solid (`godrose/Solid`): 19 packages, `netstandard2.0`.
- Attest (`godrose/Attest`): 14 packages, depends on Solid.
- LogoFX: about 41 separate repos under `~/Workspace/logofx-project`, depends on Solid and Attest, and parts of it are Windows-only (WPF).

bdd-netcore (and other projects) consume them. Working on bdd-netcore keeps turning up bugs whose fix belongs in one of these packages. Today a fix means hand-editing about 46 version strings per repo, hand-written nuspecs, a manual `nuget push` of an `-rc` package, and a manual republish of every repo further down the chain. It is slow, so fixes wait.

The goal is one short loop. A fix is made in a package repo. A complete, tested rc stack is built from it. bdd-netcore (or any project) runs on that stack and shows the fix works. Nothing reaches nuget.org until the fix is proven.

## Goals

1. `rc`: build the whole affected chain at one prerelease version, in dependency order, running each repo's tests, and put the packages in a feed that only the rc stack lives in.
2. `use`: point a consumer project at that feed with one command, and point it back.
3. `drift`: show, for every repo, which Solid, Attest and LogoFX versions it pins against the current stack.
4. `bump`: retarget a lagging repo onto the current stack and run its tests, on request.
5. `release`: turn a proven rc into the stable packages on nuget.org without hand-editing nuspecs, after an explicit confirmation.
6. Versions live in one place. Nobody edits version strings or dependency pins by hand.

## Non-goals

- Migrating all 41 LogoFX repos on day one. The first scope is the chain bdd-netcore needs: Solid, Attest, LogoFX `core` and `testing`. The manifest lets any repo be added with one entry.
- Removing AppVeyor. Its files stay untouched until the new flow is proven. AppVeyor builds have been failing since at least 2026-11-04 (cause unknown, logs need authentication). That is a separate investigation.
- Changing bdd-netcore, Solid, Attest or LogoFX source, apart from what the flow needs (see Constraints).
- Replacing the Windows-only parts of LogoFX with something buildable on macOS.

## Anti-goals (a failure even if it technically works)

- An rc package, or a half-built stack, lands on nuget.org.
- A stable release is pushed without an explicit confirmation step.
- Drift stays invisible. A lagging repo must show up in `drift`.
- The SpecFlow packages stop working. Both the SpecFlow and the Reqnroll flavours of Solid and Attest must be in the stack.
- Building Solid or Attest needs a Windows machine.

## Current state (verified 2026-11-10)

- Solid and Attest: every project is SDK-style `netstandard2.0`. The `.csproj` files already carry `<Version>`. Projects reference each other with `ProjectReference`, and the nuspec files repeat the same dependencies by hand. Packing is `devops/pack/<id>/pack.bat`: copy DLLs into `contents/lib`, then `nuget pack` on a nuspec. The scripts are Windows batch files.
- Versions: the version string `2.3.6` (Solid) or `2.4.6` (Attest) appears in about 46 files per repo: `.csproj`, nuspec versions and dependency pins, `appveyor.yml`, `publish-all.bat`, `publish-single.bat`. `devops/update/UpdateUtil` (a Windows .NET tool) bumps most of them.
- Attest pins `Solid.*` at `2.3.6` in both the `.csproj` files and the nuspecs.
- Publishing: AppVeyor builds, tests and packs, then attaches nupkgs as artifacts. Nothing pushes. Gennady pushes by hand with `devops/deploy/deploy-single.bat` (`nuget push`). `copy-*.bat` already copies packages to a local folder feed, `~/Workspace/packages/Tests-All`. `-rc1` versions on nuget.org (for example `Solid.Core 2.3.6-rc1`) are hand-edited nuspecs. There are `vX.Y.Z` git tags and no GitHub releases.
- nuget.org: Solid.Core 2.3.6, Attest.Tests.Core 2.4.6, both with an `-rc1` before.
- Pending: Solid PR 104 and Attest PR 119 add `Solid.IoC.Adapters.Reqnroll` and `Attest.Tests.Reqnroll`. They are the Reqnroll flavours, built from shared source with a `REQNROLL` define, each with its own nuspec. They are the first real payload for this flow.
- LogoFX: each repo has its own `appveyor.yml`, version and nuspecs. Versions today: `core` 2.3.7-rc1, `testing` 2.2.8-rc1, `mvvm` and `bootstrapping` 2.2.7, `ioc` 2.2.2. Repos pin Solid at 2.3.2, 2.3.5, 2.3.6 and 2.3.7-rc1. The dependency order observed: Solid, Attest, `core`, `testing`, `ioc`, `mvvm`, `bootstrapping`. Many projects are Windows-only (`net6.0-windows`, old-style non-SDK `.csproj`).
- Platform: the development machine is a Mac (arm64, .NET 10 SDK installed at `~/.dotnet-arm64`). Solid and Attest build and test there. `python3` is broken there, `node` works.

## Decisions made by Gennady

- A new small repo holds the tool and this document.
- Scope starts with the chain bdd-netcore needs, but is manifest-driven so it can grow. Reporting drift is required, and bumping lagging repos on request is wanted if it does not grow the scope much.
- Remote half: GitHub Actions (Windows runners) builds the LogoFX parts and pushes to GitHub Packages. A one-time personal access token on each machine that restores from it is acceptable.
- The local half: a folder feed on the Mac.
- Facts checked on 2026-11-11: standard GitHub-hosted runners are free for public repos, public packages are free to store and download. GitHub Packages NuGet needs a token to install, even for public packages (docs not fully confirmed for github.com, so verify with a tiny test package first).

## The design

### Manifest

One file, `stack.json`, lists repos in build order. Per repo: path, git URL, packages produced (id, project), how to pack (`dotnet` or `nuspec`), where it can build (`any` or `windows`), and its test command. Dependencies between repos are derived, not typed. The manifest is the only input a new repo needs.

### Versions

The tool writes one version per run into every `.csproj` `<Version>` and into dependency pins (`PackageReference` versions, nuspec dependency versions). It uses structured XML edits, never a text replace of a version string. The rc version is `<next stable>-rc.<n>`. Both `-rc.<n>` and the existing `-rc<n>` style sort below the stable version on nuget.org. The stable version is the same base without the suffix. `n` must increase on every run and must be unique per feed.

Two ordering facts to test before relying on them (first task of the plan):
- `n` as `yyyymmddHHMM` is a 12-digit number, above int32. NuGet is believed to fall back to a string compare for such identifiers. A string compare of equal-length digit strings still orders correctly, but this must be proven with a real restore.
- An old `2.3.7-rc1` sorts above any `2.3.7-rc.<n>` (`rc` is less than `rc1`). The two styles must not be mixed for one base version.

### Packing

Prefer `dotnet pack` driven by the `.csproj`, because dependencies then come from `ProjectReference` and `PackageReference` and the nuspec duplicate disappears. This is an assumption to verify per package: before a package moves to `dotnet pack`, its output is compared with the published 2.3.6 nupkg (files under `lib/`, dependency list, ids, metadata). Where parity fails, that package keeps its nuspec, but the tool packs it with `dotnet pack -p:NuspecFile=<nuspec>` and not with the Windows-only `pack.bat`, so Solid and Attest never need Windows (anti-goal). Whether `NuspecFile` works for these packages is tested early. LogoFX repos with non-SDK projects use the nuspec path and build on Windows only.

### Feeds

- Local: a folder, default `~/Workspace/packages/rc-feed`. It holds only rc packages. A consumer sees it through a `nuget.config` with package source mapping by exact package id: only ids that exist in the stack's rc build map to the rc feed, and everything else, including LogoFX packages outside the stack (`ioc`, `mvvm`, `bootstrapping` while they are out of scope), resolves from nuget.org. A family wildcard such as `LogoFX.*` is not used, because it would break restore for repos that have only stable versions.
- Remote: GitHub Packages (`https://nuget.pkg.github.com/godrose/index.json`). Windows runners on GitHub Actions publish the full stack there (Solid, Attest and LogoFX), using the workflow `GITHUB_TOKEN`. Other machines read with a classic personal access token with `read:packages`. Old rc packages are cleaned up by a retention policy (to be defined in the plan).
- nuget.org is touched only by `release`.
- **One stack, one origin.** A consumer uses exactly one stack from exactly one origin. The Mac builds Solid at run A and the runner builds Solid, Attest and LogoFX at run B. A consumer pinned to Solid `rc.A` cannot restore LogoFX built against Solid `rc.B`: NuGet would raise NU1605 or run LogoFX against an untested Solid. So `use` never maps one family locally and another remotely.

### Commands

- `rc [--from <repo>]`: build, test, pack and publish to the rc feed, from the repo that changed down through everything that depends on it. In a partial run, the rebuilt repos share the new run id. Upstream repos that are not rebuilt resolve to the latest successful rc record, and to the stable version when no rc record exists. The run record states which pins came from an older record.
- `use --local` (default): Solid and Attest from the local rc feed, LogoFX stays stable from nuget.org. `use` checks the consumer's resolved dependency graph and refuses if it needs a LogoFX package that exists only as an rc.
- `use --remote <run-id>`: Solid, Attest and LogoFX all from GitHub Packages at that one run id. The local feed is not mapped.
- `use --stable`: revert everything `use` changed.
- `drift`: print a table of repos against the current stack.
- `bump <repo>`: retarget the repo's pins onto the current stack, run its tests, leave the changes uncommitted.
- `release`: for each repo, in order (Solid, Attest, then LogoFX), rebuild the proven source with the stable version and print what would be pushed to nuget.org. After a typed confirmation it commits the version bump to the repo, tags that commit `vX.Y.Z`, pushes the packages, and waits until each pushed package is restorable before it builds the next repo. It can resume: a rerun skips versions already on nuget.org.

Consequence of the one-origin rule: a Solid fix that has to be tested together with rc LogoFX needs a runner build and `use --remote`.

### Order of the first deliverable

1. Solid and Attest on the Mac, local feed, `use` for bdd-netcore. This ships first.
2. `drift` and `bump`.
3. The LogoFX Windows workflow and the remote feed.
4. `release`.

## Constraints

- The tool must run on macOS (arm64) and on a Windows GitHub Actions runner. It must not depend on a global Python.
- Solid and Attest must keep their current `devops` scripts working until the new flow has produced a green stack twice. The new flow adds, it does not remove.
- Existing published versions are immutable. The flow never re-pushes an existing version.
- Secrets (nuget.org API key, GitHub token) come from environment variables. Never from files in a repo.
- No em-dashes anywhere (house style). Commits and PR bodies omit session URLs.

## Acceptance

1. Take the open Reqnroll work (Solid PR 104, Attest PR 119). `rc` builds Solid then Attest, runs their tests, and produces an rc feed containing the SpecFlow and Reqnroll packages. `use` points bdd-netcore's `spike/reqnroll` branch at it, and its Server fake suite runs to 34 of 34 without `RestoreAdditionalProjectSources`.
2. A deliberate one-line fix in Solid, made on a branch, shows up in bdd-netcore after `rc` plus `use` with no manual version edits, and disappears after `use --stable`.
3. `drift` lists every repo in `logofx-project`, Solid and Attest, with the Solid, Attest and LogoFX versions it pins.
4. `bump` on one lagging LogoFX repo changes only versions. Its tests pass, or they fail exactly as they did before the bump (author's call: failures identical to the baseline count as a pass, any new failure does not). The run reports both.
5. A Windows Actions run builds Solid, Attest, LogoFX `core` and `testing` at one run id and publishes them to GitHub Packages. A Mac with a token runs `use --remote <run-id>` on a consumer and restores the whole stack from there, with the local feed unmapped.
6. `release` in dry run lists the exact packages and versions it would push and refuses to push without the confirmation. Nothing is pushed to nuget.org during acceptance.

## Left to the builder

- The implementation language. Recommended: Node (already on the machine, runs on Windows runners). Any language that meets the constraints is fine.
- How the consumer is told which rc version to use (a property file, a `Directory.Packages.props`, or floating `2.3.7-rc.*`).
- Whether to build the Reqnroll flavours through the same `.csproj` as the SpecFlow ones. The `REQNROLL` define pattern stays as is.
- Parity checking details between `dotnet pack` output and the published nupkgs.

## Open items needing no decision yet

- Why the AppVeyor builds fail.
- Repo name and visibility on GitHub (proposed: `godrose/release-stack`, public, so the Actions minutes stay free).

## Calls made while writing this (builder-check answers)

These are the document author's calls, not Gennady's. Gennady checks them while reading.

1. **Which commits an rc is built from.** The tool builds each repo from a git worktree of a ref given per repo (default: the current branch of the local checkout). It refuses a dirty working tree unless `--allow-dirty` is passed. Open PR branches are valid refs (acceptance 1 needs that). Every run writes a record (repo, ref, commit SHA, tree hash, versions) next to the feed.
2. **`release` after a merge.** `release` builds from the merged ref (usually `master`). It compares that tree hash with the proven rc record. Equal means proven, even when a squash merge changed the commit SHA. Different means it refuses and asks for a new `rc` run.
3. **Where the next stable version comes from.** It is an explicit input per repo. The default proposal is the patch bump of the higher of the `.csproj` version and the latest stable on nuget.org. Gennady approves the stable version at `release`. The tool never decides it silently.
4. **No edits to your working tree during `rc`.** Builds happen in worktrees, so rewritten versions and pins never dirty your checkouts. The exception is `bump`, which edits in place and leaves the changes uncommitted.
5. **Versions per repo, one run id.** Each repo keeps its own base (Solid 2.3.x, Attest 2.4.x, `core` 2.3.x). All repos rebuilt in one run share the same run id: `<base>-rc.<UTC yyyymmddHHMM>`. A timestamp is numeric, increasing and unique across machines, so the Mac and the Actions runner never collide. Pins to upstream repos that were not rebuilt use the version from the latest rc record (see `rc --from`). The consumer is told one version per package family.
6. **What "affected chain" means.** Dependencies are derived from `ProjectReference` and `PackageReference` across the repos listed in the manifest, using package ids. `--from X` rebuilds X and the repos in the manifest that depend on it. Repos outside the manifest are not touched. `drift` shows them. Upstream repos that are not rebuilt resolve as described under `rc`.
7. **Whole repos, Reqnroll included.** Every package of a repo goes into every rc, in one pass. The Reqnroll packages have their own `.csproj`, so they come along. Parity checks against the published nupkg apply to packages that exist on nuget.org. The new Reqnroll packages are checked against the nuspec in their PR.
8. **How `use` changes the consumer.** `use` edits the pins in the consumer's `.csproj` files and adds a marked block to its `nuget.config`. It records exactly what it changed, in `.rc-stack/use.json`. `use --stable` reverts those edits and nothing else.
9. **Windows-only repos on the Mac.** `rc` on the Mac skips repos marked `windows` and says so, so a Mac stack is Solid and Attest only. The runner builds the whole stack end to end, including Solid and Attest, at its own run id, so one version string never has two different binaries. A consumer takes one of the two stacks (`use --local` or `use --remote <run-id>`) and never a mix. See Feeds.
10. **The Actions workflow.** It lives in this repo and runs on `workflow_dispatch` with the ref per repo as input. It checks the repos out, builds the whole chain in order on a Windows runner, and pushes with the workflow token.
11. **Test failures.** Any failure aborts the run before anything is pushed. Packages are packed to a staging folder and published only when every repo is green. A repo may list known-failing tests in the manifest. Each entry names an owner and an expiry date, so an allowlist cannot hide a regression for long. The run prints every entry every time, and an expired entry fails the run.
12. **Release scope.** `release` covers manifest repos only. Downstream repos outside the manifest stay on their old pins until `bump`.
13. **The release commit.** `release` commits the version bump to each repo on a short-lived `release/<version>` branch, opens a pull request, and tags the merge commit after the merge. The tag therefore marks a commit whose files say the right version. This keeps goal 6 true for committed files. The push to origin is covered by the typed confirmation. (Author's call: a direct push to `master` is the alternative and is faster, but it skips review.)
14. **Tree-hash equality.** The check in call 2 fails whenever `master` moved after the PR branched, so expect a fresh `rc` before many releases. This is the safe direction.

## Decisions from the design review (2026-11-11)

Approved by Gennady, as recorded in the review handoff:

- **D1. Partial runs.** `rc --from X` is accepted. Upstream repos that are not rebuilt resolve to the latest successful rc record, falling back to stable. The run record notes which pins came from an older record.
- **D2. Mac and runner stacks must not mix.** A consumer uses one stack from one origin. `use --local` (default) and `use --remote <run-id>` are the two modes. `use` never maps one family locally and another remotely. A Solid fix that needs rc LogoFX needs a runner build.
- **D3. Version bump at release.** `release` commits the bump and the tag goes on that commit. The commit is made on a branch and the push is covered by the typed confirmation (call 13).
- **D4. Release scope.** `release` pushes in order (Solid, Attest, then LogoFX), waits until each pushed package is restorable before it builds the next repo, and can resume by skipping versions already pushed.

## First tasks in the plan (checks that can change the design)

1. Prove the ordering facts under Versions with a real restore from a folder feed.
2. Check `dotnet pack -p:NuspecFile=...` for one Solid package on the Mac.
3. Push a tiny test package to GitHub Packages from a workflow, using `GITHUB_TOKEN`. Confirm cross-repo publish, package-to-repo linking and the token behaviour on restore.
4. Decide the retention policy for old rc packages on GitHub Packages.
