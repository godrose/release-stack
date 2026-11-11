# Finding: can `dotnet pack` reproduce the published packages?

Spike: `spikes/pack-parity/run.js` (raw results: `docs/findings/pack-parity.json`). Run 2026-11-11 on macOS arm64, .NET SDK 10.0.403. Each package is compared with the published 2.3.6 (Solid) or 2.4.6 (Attest) nupkg using `src/parity.js`. Differences in `.pdb`, `.xml` (docs) and `.deps.json` files under `lib/` are ignored as cosmetic.

| Result | Count | Meaning |
|---|---|---|
| `dotnet` | 15 | A plain `dotnet pack <project>` gives the same `lib/` content and the same dependencies. |
| `nuspec` | 15 | Identical only when the existing nuspec is used: `dotnet pack -p:NuspecFile=... -p:NuspecBasePath=...` with `lib/` staged by the same copy rules as `pack.bat`. |
| new | 2 | `Solid.IoC.Adapters.Reqnroll` and `Attest.Tests.Reqnroll`: nothing published to compare with. They use the nuspec path. |
| windows only | 1 | `Solid.Common` (project `Solid.Common.Platform`) targets `net461`, `net6.0` and `netcoreapp3.1`. Its `net461` target needs Windows reference assemblies, so it cannot be built on macOS. |

## Why some packages need the nuspec

- The package id differs from the assembly or project name (for example `Attest.Tests.SpecFlow` packs `Attest.Testing.SpecFlow`). `dotnet pack` then writes dependency ids from project names, for example `Attest.Testing.Core 2.4.6` where the published package says `Attest.Tests.Core 2.4.6`.
- One package bundles several assemblies (`Solid.Practices.Composition.Core` packs three, `Attest.Fake.LightMock` packs two).
- Hand-written nuspec dependencies that differ from the generated ones.

## Method facts that change the plan

- `dotnet pack -p:NuspecFile=...` works on macOS for the nuspec packages.
- Pack must not set global properties such as `-p:Version` or `-p:PackageId`: they flow into referenced projects and break restore. The `.csproj` files already carry the version, so the tool edits the `<Version>` element instead.
- Building each package project separately in one worktree failed unpredictably (stale build state). Building the solution once and then `dotnet pack --no-build` per package works. `Solid.sln` fails on macOS only because of `Solid.Common.Platform`, and the other projects still build. The tool therefore builds a generated solution filter (`.slnf`) that lists only the projects it needs.

## Verdict

No package is `blocked` for the Mac stack. The manifest gets: a `solution` per repo, per-package `platform`, and `lib` copy rules for nuspec packages. The version tooling needs nuspec edits (`<version>` and dependency versions), so Task 4 includes them.
