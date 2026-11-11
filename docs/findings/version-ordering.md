# Finding: version ordering of `-rc.<yyyymmddHHMM>`

Spike: `spikes/ordering/run.sh`. Run 2026-11-11 with .NET SDK 10.0.403 and a folder feed. Packages `Probe.Pkg` at `2.3.7-rc.202611111530`, `2.3.7-rc.202611121000`, `2.3.7-rc1` and `2.3.7`.

| Case | Result |
|---|---|
| Exact pin on each version | Restores exactly that version. |
| Dependency needs `>= rc.202611111530`, consumer pins `rc.202611121000` | Restores `rc.202611121000`, no warning. |
| Dependency needs `>= rc.202611121000`, consumer pins `rc.202611111530` | NU1605 downgrade, as it must be. |
| Dependency needs `>= 2.3.7-rc1`, consumer pins `rc.202611121000` | NU1605 downgrade: the old `-rc1` style sorts above `-rc.<n>`. |
| Floating `2.3.7-rc.*`, feed holds the stable `2.3.7` too | Picks the stable `2.3.7`. |
| Floating `2.3.7-rc.*`, feed holds only prereleases | Picks `rc.202611121000`, the newest timestamp. |

## Verdict

- The 12-digit timestamp identifier orders correctly. No change to the version format.
- Never mix `-rc1` and `-rc.<n>` for one base version.
- Never use a floating range in a consumer: if the stable version exists anywhere in the mapped feeds, it wins. `use` writes exact pins.
