# 7D2D Profile Editor integration

Mastermind runs the upstream **7 Days to Die TTP Profile Editor** as an isolated PHP service and proxies it beneath the Mastermind interface.

- Upstream: <https://github.com/RussDev7/7D2DProfileEditor>
- Author/maintainer: RussDev7 / DannyRuss
- Pinned revision: `270f998adf70f3724afd93ba0e08569e3ba78c95`
- License: GNU GPL v3 (`LICENSE` is included in the upstream source and container image)

The editor acknowledges earlier work by `kani-momonga/7DaysProfileEditorPHP` and `Karlovsky120/7DaysProfileEditor`. Mastermind does not claim authorship of the editor or its `.ttp` parsing research.

The integration retains upstream's download-only workflow. It does not overwrite live player profiles automatically. Stop the game server and make an untouched backup before manually replacing a `.ttp` file.
