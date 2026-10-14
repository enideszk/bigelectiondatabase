# Data sources

One row per source (= one loader / one `source.name`). Fill in as sources are added; see
[adding-a-source.md](adding-a-source.md).

| Source | URL | Coverage | Years | Level | Loader | Status | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Column guide:

- **Source**: publisher and dataset, the same text as `SOURCE.name` in the loader.
- **Coverage**: what it contains (e.g. "parliamentary results, list + single-member", "settlement boundaries").
- **Years**: elections or reference years covered.
- **Level**: the finest unit the data comes at (polling station, settlement, district, county, national).
- **Loader**: module name under `etl/src/etl/loaders/` (`.\etl load <name>`).
- **Status**: planned / downloaded / loaded / checked.
- **Notes**: known problems, gaps, licence conditions, quirks found while loading.
