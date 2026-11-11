# release-stack

Build, test and release the Solid, Attest and LogoFX package stack as rc packages, so a fix can be proven in a consumer before anything reaches nuget.org.

Design: `docs/superpowers/specs/2026-11-11-rc-stack-design.md`. Plans: `docs/superpowers/plans/`.

Usage is added as the commands land.

## Commands

```
node src/cli.js rc [--from <repo>] [--ref <repo>=<ref>]...   build, test and pack the stack into the rc feed
node src/cli.js use --local <consumer>                         point a consumer at the latest rc
node src/cli.js use --stable <consumer>                        put the consumer back
```

Environment: `DOTNET_ROOT=~/.dotnet-arm64 PATH=~/.dotnet-arm64:$PATH`. The rc feed is the `feed` in `stack.json`. `rc` builds from git worktrees and refuses repos with uncommitted changes to tracked files.
