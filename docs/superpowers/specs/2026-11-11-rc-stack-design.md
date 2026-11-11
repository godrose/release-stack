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

The tool writes one version per run into every `.csproj` `<Version>` and into dependency pins (`PackageReference` versions, nuspec dependency versions). The rc version is `<next stable>-rc.<n>`. Both `-rc.<n>` and the existing `-rc<n>` style sort below the stable version on nuget.org. The stable version is the same base without the suffix. `n` must increase on every run and must be unique per feed.

### Packing

Prefer `dotnet pack` driven by the `.csproj`, because dependencies then come from `ProjectReference` and `PackageReference` and the nuspec duplicate disappears. This is an assumption to verify per package: before a package moves to `dotnet pack`, its output is compared with the published 2.3.6 nupkg (files under `lib/`, dependency list, ids, metadata). Where parity fails, that package keeps its nuspec and `pack.bat` logic, wrapped by the tool. LogoFX repos with non-SDK projects use the nuspec path and build on Windows only.

### Feeds

- Local: a folder, default `~/Workspace/packages/rc-feed`. It holds only rc packages. A consumer sees it through a `nuget.config` with package source mapping: `Solid.*`, `Attest.*`, `LogoFX.*` resolve only from the rc feed while `use` is active, and everything else only from nuget.org.
- Remote: GitHub Packages (`https://nuget.pkg.github.com/godrose/index.json`). Windows runners on GitHub Actions publish the LogoFX rc packages there, using the workflow `GITHUB_TOKEN`. Other machines read with a classic personal access token with `read:packages`.
- nuget.org is touched only by `release`.

### Commands

- `rc [--from <repo>]`: build, test, pack and publish to the rc feed, from the repo that changed down through everything that depends on it.
- `use [--stable]`: write or remove the consumer's `nuget.config` mapping and set the rc version for the consumer.
- `drift`: print a table of repos against the current stack.
- `bump <repo>`: retarget the repo's pins onto the current stack, run its tests, leave the changes uncommitted.
- `release`: for each repo, rebuild the exact commits that were proven as an rc with the stable version, print what would be pushed to nuget.org, and push only after a typed confirmation. Tag each repo.

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
4. `bump` on one lagging LogoFX repo changes only versions and leaves its tests passing (or reports precisely which tests failed).
5. A Windows Actions run builds LogoFX `core` and `testing` and publishes them to GitHub Packages. A Mac with a token restores them.
6. `release` in dry run lists the exact packages and versions it would push and refuses to push without the confirmation. Nothing is pushed to nuget.org during acceptance.

## Left to the builder

- The implementation language. Recommended: Node (already on the machine, runs on Windows runners). Any language that meets the constraints is fine.
- The exact rc suffix scheme and how `n` is assigned.
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
5. **Versions per repo, one run id.** Each repo keeps its own base (Solid 2.3.x, Attest 2.4.x, `core` 2.3.x). All repos in one run share the same run id: `<base>-rc.<UTC yyyymmddHHMM>`. A timestamp is numeric, increasing and unique across machines, so the Mac and the Actions runner never collide. The consumer is told one version per package family.
6. **What "affected chain" means.** Dependencies are derived from `ProjectReference` and `PackageReference` across the repos listed in the manifest, using package ids. `--from X` rebuilds X and the repos in the manifest that depend on it. Repos outside the manifest are not touched. `drift` shows them.
7. **Whole repos, Reqnroll included.** Every package of a repo goes into every rc, in one pass. The Reqnroll packages have their own `.csproj`, so they come along. Parity checks against the published nupkg apply to packages that exist on nuget.org. The new Reqnroll packages are checked against the nuspec in their PR.
8. **How `use` changes the consumer.** `use` edits the pins in the consumer's `.csproj` files and adds a marked block to its `nuget.config`. It records exactly what it changed, in `.rc-stack/use.json`. `use --stable` reverts those edits and nothing else.
9. **Windows-only repos on the Mac.** `rc` on the Mac skips repos marked `windows` and says so. `use` maps `LogoFX.*` to both feeds (local, then GitHub Packages) when the remote one is configured. The remote stack is built by the runner end to end, including Solid and Attest, at its own run id, so one version string never has two different binaries.
10. **The Actions workflow.** It lives in this repo and runs on `workflow_dispatch` with the ref per repo as input. It checks the repos out, builds the whole chain in order on a Windows runner, and pushes with the workflow token.
11. **Test failures.** Any failure aborts the run before anything is pushed. Packages are packed to a staging folder and published only when every repo is green. A repo may list known-failing tests in the manifest. The run prints them every time.
12. **Release scope.** `release` covers manifest repos only. Downstream repos outside the manifest stay on their old pins until `bump`. Tags (`vX.Y.Z`) go on the proven commits and are pushed after the nuget.org push succeeds. The git push needs Gennady's credentials, and the confirmation covers it.
