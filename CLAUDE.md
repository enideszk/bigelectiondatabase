# CLAUDE.md

Guide for working on this repository (for the owner and for AI-assisted sessions). Read
`docs/architecture.md` for the full data model.

## What this is

A static website showing every Hungarian election (1990–2026) and socio-demographic indicators
per settlement / county / region / electoral district. Pipeline:

    data/raw → etl loaders → PostgreSQL+PostGIS (Server-PC) → etl export + etl tiles → web/ (static)

Phase 1 (done): schema, ETL skeleton, exporter, tiles, website, all running on a FAKE fixture.
Phase 2 (in progress): real data, one source at a time (docs/adding-a-source.md). The main
database `hu_data` now holds real data only; the fixture lives on in the test database.

Loaded so far, in this order (`.\etl load <name>`, order = `LOADERS` in `loaders/__init__.py`):
`reference_regions` → `ksh_helysegnevtar` → `osm_boundaries_2026` → `oevk_maps`. No elections yet.
Raw inputs (gitignored) are in `data/raw/`: `valasztasi_eredmenyek_1990-2024/` (all NVI results
1990–2026, 1.9 GB, each election nested one folder deeper, e.g. `1990_parlamenti/1990_parlamenti/`),
`ksh_helysegnevtar_2026/`, `magyarorszag_telepulesek_2026/`, `oevk_terkepek/` (district maps).
District membership is currently derived spatially by `oevk_maps` (provisional); polling-station
data should replace it once elections are loaded.

## Commands

From the repo root (PowerShell):

```
.\etl db up | db status | db reset --yes | db refresh
.\etl seed fixtures            # FAKE data; refuses if real sources are present
.\etl load <name> [--step clean|load|all]
.\etl check                    # data-quality checks, exit 1 on errors
.\etl export | tiles | build   # build = export + tiles
.\etl test [pytest args]       # Python tests against TEST_DATABASE_URL (wiped!)
cd web; npm run dev | npm test | npm run build | npm run typecheck | npm run schema
```

Definition of done for any change: `.\etl test` and `npm test` pass, `npm run typecheck` is clean.

## Environment facts (important)

- **The repo lives on a network share**: `Z:\OEVK MODELL ÉS SOMETHING\bigelectiondatabase` on the
  owner's PC = `L:\OEVK MODELL ÉS SOMETHING\bigelectiondatabase` on Server-PC (192.168.0.253).
- **Always run the CLI via `etl.cmd`**, never plain `uv run etl`. It sets `UV_PROJECT_ENVIRONMENT`
  to `%LOCALAPPDATA%\hu-data-platform\etl-venv` (venv on local disk, one per machine) and runs
  `python -m etl`: uv's generated `etl.exe` launcher resolves paths to `\\?\UNC\...`, and Windows
  then refuses to load psycopg's libpq DLL ("The parameter is incorrect").
- **Vite watches by polling** (web/vite.config.ts). Native file watching over the share exhausts
  Server-PC's SMB resources: every other program's fsync then fails with "Insufficient system
  resources" (file saves break). Don't turn polling off when working via Z:.
- In PowerShell, `npm run dev -- --port N` loses the flags; use `npx vite --port N` instead.
- **Database**: PostgreSQL 18.6 + PostGIS 3.6.2 on Server-PC, Windows service `postgresql-x64-18`,
  data in `L:\PostgreSQL\18\data`, port 5432, reachable from 192.168.0.0/24 only. Databases
  `hu_data` (main) and `hu_data_test` (tests), owner role `hudata`; credentials in `.env`
  (gitignored). Superuser `postgres` password: Server-PC `%APPDATA%\postgresql\pgpass.conf`.
  Install details and re-install steps: docs/server-setup.md.
- **Server-PC SSH**: `ssh -p 2222 oliver@192.168.0.253`; the login shell is Windows PowerShell 5.1,
  send scripts with `powershell -EncodedCommand`. psql there: `C:\Program Files\PostgreSQL\18\bin`.
- No Docker anywhere (owner's decision). Tiles are cut by PostGIS (`ST_AsMVT`), not tippecanoe.

## Conventions

**Language**: English for code, identifiers, table/column names, docs and the UI. All UI strings
live in `web/src/lib/i18n.ts`. Official place, party and candidate names are data and stay
Hungarian (tables have `name` = official Hungarian name, `name_en` where an English name exists).
Number/date formatting is US (`1,234.5`, `April 8, 2018`), only via `web/src/lib/format.ts`.

**Database**
- Migrations: `db/migrations/NNNN_description.sql`, applied in order, recorded with checksums in
  `schema_migration`. Never edit an applied migration; add a new one. (The Phase 1 migrations were
  only ever applied to fake-data databases.)
- `unit_id = unit_type || '-' || code` (CHECK-enforced): `settlement-14827` (KSH code),
  `bp_district-09566` (KSH code of Budapest I.), `county-07`, `jaras-085`, `smd-2011-07-01`,
  `polling_station-parliament-2022-14827-001`, `special-mail`. Budapest as a whole = `county-01`.
- County codes are the **KSH** county codes 01–20 (01 Budapest … 13 Pest … 16 Jász-Nagykun-Szolnok
  … 20 Zala), see `data/reference/counties.csv`. NVI election files call it MAZ/MEGYEKÓD but changed
  the numbering over time (1990: KSH order; 2018: alphabetical, 11 = Jász-Nagykun-Szolnok), so
  loaders must map counties **by name** (`etl.hu_names.county_key`), never by the file's code.
- Settlements are matched across sources by name (`etl.hu_names.name_key`; names are unique
  nationally) and Budapest districts by number (`bp_district_number`, handles "BUDAPEST I.ker",
  "Budapest 01. ker.", "XXI. kerület"). NVI's own settlement code (TAZ) is not a KSH code.
- Validity: half-open `[valid_from, valid_to)`, NULL = open-ended. Overlaps prevented by
  `EXCLUDE USING gist` (needs btree_gist).
- Every loaded row has `source_id`; only `source_id` FKs cascade. All other FKs are
  `DEFERRABLE INITIALLY DEFERRED` (checked at commit, so delete-and-reload of a source works).
  New FKs must follow this.
- Results are stored at the level the source provides, **one level per election** (never load
  derivable totals). Aggregates are materialized views (`mv_*`), refreshed by
  `CALL refresh_aggregates()` / `.\etl db refresh`; `etl export` refreshes first.
- Extensions live in schema `extensions` (search_path `public, extensions`); `etl db reset` drops
  and recreates only `public`.
- election_id: `<type>-<year>` (`parliament-2022`). District sets: '1990', '2011', '2024'.

**ETL (Python, etl/)**
- psycopg 3 + plain SQL, no ORM. pandas only inside loaders' `clean()` step.
- Loader = module in `etl/src/etl/loaders/` with `SOURCE`, `clean(raw_dir, interim_dir)`,
  `load(conn, interim_dir)`; registered in `loaders/__init__.py`. Template: `_template.py`.
  `load()` runs in one transaction and starts with `replace_source()`.
- Exporter reads in bulk (`export/context.py`) and assembles in Python.

**Website (web/)**
- `web/src/lib/types.ts` is the contract for every exported JSON file. After editing it run
  `npm run schema` (regenerates `types.schema.json`), then make the exporter match: the Python
  tests validate exported files against that schema; a web test fails if the schema is stale.
- No framework: small modules, DOM built with `h()` from `components/dom.ts`, charts are plain SVG.
- Dark theme only. Color tokens (`:root` in `src/styles.css`) and the side-panel pattern (`d-*`
  classes: kind + status pill, "in …" links, participation ring, rows with a party-colored bar
  behind them, `seg` toggles) follow the owner's Israel 2026 dashboard
  (`..\ilelection\dashboard\styles.css`, `il.css`, `renderDetail()` in `app.js`). Keep new UI
  consistent with it.
- MapLibre GL 6 is ESM-only and needs `setWorkerUrl(... ?worker&url)` (done in `map/map.ts`).
- State lives in the URL (`state.ts`): `?unit=&year=&type=&view=L|E&round=&level=`.
- Map tiles: one PMTiles file, one layer per level, every geometry *version* is a feature with
  `vf`/`vt` (YYYYMMDD ints); the map filters by the selected election date.

**Fixtures**: everything in `data/fixtures/` is FAKE (codes 99xxx, county 91/92, country XX). Edit
`make_fixtures.py` and re-run it rather than editing the CSVs by hand. Fake and real data must
never share a database (`etl seed fixtures` refuses; `etl check` flags it).

## Data model in one screen

- `source` – provenance of every row
- `unit_type`, `unit` (+ `unit_name` renames, `unit_parent` time-varying hierarchy,
  `unit_lineage` merge/split crosswalk, `unit_geometry` versioned boundaries)
- `election_type`, `election`, `election_round`, `district_set`, `electoral_district` (smd units),
  `district_membership` (settlement ↔ district, many-to-many), `polling_station`
- `party` (stable id) + `party_name` (renames), `party_list` + `party_list_member` (joint lists),
  `candidate` + `candidate_party`
- `turnout` (per round and ballot), `list_result`, `candidate_result` – long format, any level
- `indicator`, `indicator_value`
- views: `v_unit_ancestor`, `mv_rollup`, `mv_turnout_agg`, `mv_list_result_agg`,
  `mv_candidate_result_agg`, `mv_list_winner`
