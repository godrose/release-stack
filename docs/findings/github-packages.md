# GitHub Packages spike (2026-11-12)

Workflow run 43188801568 on `windows-latest` packed `Spike.Pack` 0.0.1 and pushed it to `https://nuget.pkg.github.com/godrose/index.json` with the workflow `GITHUB_TOKEN` (`packages: write`). The push succeeded.

| Check | Result |
|---|---|
| Push from a workflow with `GITHUB_TOKEN` | works |
| Anonymous service index and version listing | 401 |
| Service index and version listing with a classic PAT (`read:packages`) | 200, `{"versions":["0.0.1"]}` from `https://nuget.pkg.github.com/godrose/download/spike.pack/index.json` |
| `dotnet restore` with a nuget.config using `%GH_TOKEN%` (Username `godrose`, `ClearTextPassword`) | works, the package is restored |
| Same config with `GH_TOKEN` empty | fails before any request: `Value cannot be null or empty string. (Parameter 'password')` |
| Secret in the nuget.config | none, only the `%GH_TOKEN%` reference |
| GitHub REST listing of packages (`gh api /users/godrose/packages`) | needs `read:packages` on the gh token |
| Delete a package by API (`DELETE /user/packages/nuget/<id>`) | needs `delete:packages` and `read:packages` |

## Consequences for the plan
- Version listing works with a token, so `use --remote` finds `-rc.<run-id>` versions from the flat container. No remote record is needed (Task 3 and 4 stand as written).
- A missing token gives a nuget error about an empty password. `use --remote` must check the variable first and say its name (Review Focus 3).
- Not verified: restore with a wrong, non-empty token (the package was already in the local cache).

## Retention proposal
Keep rc packages until a clean-up is wanted. Clean-up is a manual `gh api -X DELETE` per package after `gh auth refresh -h github.com -s delete:packages,read:packages`. A scheduled clean-up is out of scope for now.

## Left over
`Spike.Pack` 0.0.1 is still on the account. Delete it with the command above or in the GitHub UI (Packages, Spike.Pack, Package settings).
