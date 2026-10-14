# Adding a data source

Every source goes the same way: **raw file → interim (clean CSV) → database**, with a `source`
row that makes every loaded row traceable and lets you reload the source at any time.

## 0. Before you start

- Real and fake data must not share a database. If the database still holds the fixture, run
  `.\etl db reset --yes` first (this deletes everything).
- Load in dependency order. Results need their units, elections, parties and lists to exist
  first. A typical order:
  1. units (settlements, járások, counties, regions; then their boundaries)
  2. elections, rounds, district sets, electoral districts, district membership
  3. parties (curated: `data/reference/`), then per election: lists, candidates
  4. results (turnout, list results, candidate results), polling stations if the source has them
  5. indicators

## 1. Put the raw file in place

Create `data/raw/<source_dir>/` and save the download there **unchanged** (no edits, no
renames inside the file). Write down the URL and the download date; you will need them in step 3.
`data/raw/` is gitignored. To keep raw files on the NAS instead, set `RAW_DATA_DIR` in `.env`.

## 2. Add a row to docs/data-sources.md

Source name, URL, coverage, years, level, loader name, status "downloaded".

## 3. Create the loader

```powershell
copy etl\src\etl\loaders\_template.py etl\src\etl\loaders\nvi_parliament_2022.py
```

Fill in:

- `SOURCE`: `name` must be unique and stable (it is how the loader finds and replaces its own
  rows), plus publisher, URL, original file name, download date, licence, notes.
- `SOURCE_DIR`: the folder name under `data/raw/` and `data/interim/`.
- `clean(raw_dir, interim_dir)`: read the raw file (pandas: `read_csv`, `read_excel`), rename
  columns to the database's column names, build `unit_id`s (`"settlement-" + ksh_code`), reshape
  wide tables to long (`melt`), fix known errors (comment each fix), and write CSVs to
  `data/interim/<source_dir>/`. No database access here, so you can inspect the interim files in
  Excel, R or Stata before loading.
- `load(conn, interim_dir)`: inside **one** `with conn.transaction():` block, call
  `replace_source(conn, SOURCE)` first, then insert with `copy_rows()` / `copy_csv()`. Look up
  generated ids (lists, candidates) by natural keys, as the template shows. Return row counts.

Register it in `etl/src/etl/loaders/__init__.py`:

```python
from . import nvi_parliament_2022

LOADERS = {
    "nvi_parliament_2022": nvi_parliament_2022,
}
```

## 4. Run it

```powershell
.\etl load nvi_parliament_2022 --step clean    # raw -> interim; inspect the CSVs
.\etl load nvi_parliament_2022 --step load     # interim -> database (also refreshes aggregates)
.\etl check                                    # data-quality checks
```

Running `load` again replaces everything the source loaded before. If Postgres refuses with a
foreign-key error, another source still references this source's rows (e.g. results pointing at
units): reload or delete that source first.

## 5. Check and publish

- `.\etl check` must report no ERROR. Typical ones: results at two levels for the same
  settlement (double counting), results for a unit that did not exist on election day, a
  settlement without a parent on election day.
- Spot-check totals against the official national figures (psql, R or Stata can read the
  `mv_*` views directly).
- `.\etl build`, then `npm run dev` in `web/` and look at the map.
- Update `docs/data-sources.md` (status "loaded"/"checked", notes on quirks).
- Commit the loader and the docs (never the raw or interim files).

## Tips

- Need a column or table that does not exist yet? Add a migration
  (`db/migrations/0006_<what>.sql`), never edit an applied one. New foreign keys:
  `REFERENCES x DEFERRABLE INITIALLY DEFERRED`; `source_id` columns:
  `integer NOT NULL REFERENCES source ON DELETE CASCADE`. Then `.\etl db up`.
- New field in the website's JSON? Edit `web/src/lib/types.ts`, run `npm run schema`, update the
  exporter, run `.\etl test`.
- Geometries in EOV (EPSG:23700): transform in SQL with
  `ST_Transform(ST_SetSRID(geom, 23700), 4326)` (PROJ data is installed with PostGIS), or in
  `clean()` with geopandas (`uv add geopandas` in `etl/`).
