# CLAUDE.md

Guide for working on this repository (for the owner and for AI-assisted sessions). Read
`docs/architecture.md` for the full data model.

## What this is

A static website showing every Hungarian election (1990–2026) and socio-demographic indicators
per settlement / county / region / electoral district. Pipeline:

    data/raw → etl loaders → PostgreSQL+PostGIS (Server-PC) → etl export (JSON + GeoJSON) → web/ (static)

Phase 1 (done): schema, ETL skeleton, exporter, website, all running on a FAKE fixture.
Phase 2 (in progress): real data, one source at a time (docs/adding-a-source.md). The main
database `hu_data` now holds real data only; the fixture lives on in the test database.

Loaded so far, in this order (`.\etl load <name>`, order = `LOADERS` in `loaders/__init__.py`):
`reference_regions` → `ksh_helysegnevtar` → `osm_boundaries_2026` → `oevk_maps` →
`reference_elections` → `reference_parties` → `nvi_parliament_2014` / `_2018` / `_2022` / `_2026` →
`district_membership`. Elections loaded: parliamentary 2014–2026 (polling-station level).
Raw inputs (gitignored) are in `data/raw/`: `valasztasi_eredmenyek_1990-2024/` (all NVI results
1990–2026, 1.9 GB, each election nested one folder deeper, e.g. `1990_parlamenti/1990_parlamenti/`),
`ksh_helysegnevtar_2026/`, `magyarorszag_telepulesek_2026/`, `oevk_terkepek/` (district maps).
`district_membership` derives settlement ↔ district from the polling stations; only district sets
without station data (1990 so far) fall back to polygon overlap.

Parliamentary results (`loaders/_nvi_parliament.py`, shared by the four year modules):
- Party names in the files are matched through `data/reference/party_aliases.csv` (alias →
  `party_ids` joined by `|`, display name, short name, color); parties are in `parties.csv`.
  An unknown list/organisation name is reported and stored with a generated name/acronym: add
  an alias row instead of special-casing a loader. Joint lists: EM 2022 = DK|Jobbik|Momentum|
  MSZP|LMP|Párbeszéd, Összefogás 2014 = MSZP|Együtt|DK|Párbeszéd|MLP.
- Mail votes (levélszavazás) go to unit `special-mail` (child of the country).
- Nationality lists are stored (`list_kind = 'nationality'`) but hidden in the UI and the winner
  view; list shares use all valid list ballots as the denominator, as the official results do.
- Namesake candidates exist (2014, 2018 decoys): candidates are keyed by ballot position.
- 2026: the per-county xls files do not name candidates' nominating organisations, so they are
  stored with party `unknown` ("?") until a source for them is added to `data/raw`. Only files in
  the project folder may be used (owner's rule).
- Balatonakarattya split from Balatonkenese in 2014 after the election: its 2014 votes are inside
  Balatonkenese (no lineage modelled yet).

## Commands

From the repo root (PowerShell):

```
.\etl db up | db status | db reset --yes | db refresh
.\etl seed fixtures            # FAKE data; refuses if real sources are present
.\etl load <name> [--step clean|load|all]
.\etl check                    # data-quality checks, exit 1 on errors
.\etl export | build          # build = export (JSON + GeoJSON into web/public/data)
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
- **Never let Vite watch `public/data/`** (`server.watch.ignored`). Polling the thousands of
  generated files starved the dev server: 3–22 s per request instead of ~15 ms. Vite only serves
  public files it knows from startup or the watcher, so `serveGenerated()` in vite.config.ts serves
  this folder from disk itself. After `.\etl export`, refresh the page.
- **Small files on the share cost ~11 ms each** (create) and ~4 ms (delete) vs < 1 ms locally.
  The exporter therefore builds everything in memory and writes with 32 threads, overwriting in
  place and deleting only stale files (export: 62 s -> 7 s). Keep this when changing the exporter.
- In PowerShell, `npm run dev -- --port N` loses the flags; use `npx vite --port N` instead.
- **Database**: PostgreSQL 18.6 + PostGIS 3.6.2 on Server-PC, Windows service `postgresql-x64-18`,
  data in `L:\PostgreSQL\18\data`, port 5432, reachable from 192.168.0.0/24 only. Databases
  `hu_data` (main) and `hu_data_test` (tests), owner role `hudata`; credentials in `.env`
  (gitignored). Superuser `postgres` password: Server-PC `%APPDATA%\postgresql\pgpass.conf`.
  Install details and re-install steps: docs/server-setup.md.
- **Server-PC SSH**: `ssh -p 2222 oliver@192.168.0.253`; the login shell is Windows PowerShell 5.1,
  send scripts with `powershell -EncodedCommand`. psql there: `C:\Program Files\PostgreSQL\18\bin`.
- No Docker anywhere (owner's decision).

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
- State lives in the URL (`state.ts`): `?unit=&year=&type=&view=L|E&round=&level=`.
- **The map is Leaflet 1.9 on canvas** (owner's choice, as in the Israel dashboard; MapLibre +
  PMTiles was dropped in Phase 2). Boundaries: GeoJSON files `data/geo/{level}.json` and
  `geo/smd-{set}.json` from `etl/src/etl/export/geo.py`; every geometry *version* is a feature with
  `valid_from`/`valid_to`, and `meta.geo` says which period each file covers.
- `ElectionMap` (`map/map.ts`) builds one Leaflet layer per level and set of geometry versions and
  keeps it: a year switch only repaints colors (`setStyle`), a level switch adds the prebuilt layer
  and removes the old one in the same canvas frame. Other levels are built while the browser is
  idle. `setView(date, electionFilePromise)` changes nothing on screen until both the boundaries
  and the colors are in, so the old view stays up instead of flashing. Hover and selection
  outlines are separate polygons on their own panes/canvases (never restyle the fill for them).
- Leaflet's CSS loads after ours: map overrides in `styles.css` are prefixed with `#map`.
- **Selection swaps atomically** (`main.ts`): a newly selected unit replaces the old outline and
  sidebar only once its file has loaded; a loading bar appears after 150 ms; resting the pointer
  on a unit for 120 ms prefetches its file. Dev builds expose the map as `window.__electionMap`.
- `npm run build` copies `public/data` (thousands of files) into `dist/`: ~60 s over the share,
  fast when run on Server-PC itself.

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
