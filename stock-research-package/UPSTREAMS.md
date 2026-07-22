# Vendored stock-analysis upstreams

The following projects are stored as source snapshots and are managed by the
root repository at `E:\AI\gp\.git`. Their nested Git metadata was removed on
2026-07-22 after recording the source revision.

| Directory | Upstream | Snapshot commit | License status |
|---|---|---|---|
| `upstreams/a-share-us-catalyst` | `https://github.com/yespsam/a-share-us-catalyst.git` | `09bb1cac35bbcd81e69bea2d0c04300e658cd470` | No LICENSE file in the snapshot; deployment permission must be confirmed or the required capability rewritten. |
| `upstreams/mom-index` | `https://github.com/mihang123/mom-index.git` | `0c68a455b60a973c6e31ea7c8c335c868ba346f2` | README states MIT, but the snapshot contains no LICENSE file; confirm before public deployment. |
| `upstreams/daily_stock_analysis` | `https://github.com/ZhuLinsen/daily_stock_analysis.git` | `2933cdf8c58c6740d172ddb202ac9303b3c5798f` | MIT; retain the upstream copyright and license notice. |

Do not update these directories by running `git pull` inside them. Import a new
snapshot deliberately, record its commit here, review its license and diff, and
then commit it through the root repository.
