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
- 2026: the per-county result xls files do not name candidates' nominating organisations; they
  come from the NVI candidate register `2026_parlamenti/jeloltek_YYYYMMDD.csv` (newest file),
  matched by county, district number and name. Every candidate on the ballot must match, or the
  clean step fails. Only files in the project folder may be used (owner's rule).
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
cd web; npm run dev | npm test | npm run build | npm run typecheck | npm run schema | npm run serve
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
- **Hosting**: https://hungary.enideszk.duckdns.org = Caddy on Server-PC -> `web/scripts/serve.mjs`
  on 127.0.0.1:1235 (scheduled task `HungaryElectionsSite`, supervisor `tools/run-server.ps1`,
  logs in `logs/`). `/data/` is served from `web/public/data`, so an export is live at once; code
  changes need `npm run build` on Server-PC. Details: docs/server-setup.md.

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
- State lives in the URL (`state.ts`): `?unit=&year=&type=&view=L|E&round=&level=&map=&nav=&focus=&postal=&list=`.
- **Page layout** (as the Israel dashboard): a thin election bar across the top; above the map a
  toolbar with the level / election type / year table (`map/controls.ts`) on the left and search,
  the Party lists / Single-member switch and the party picker on the right; the side panel (30%) on the right.
- **The map is Leaflet 1.9 on canvas** (owner's choice, as in the Israel dashboard; MapLibre +
  PMTiles was dropped in Phase 2) over a darkened, half-transparent OpenStreetMap
  (tile.openstreetmap.org; `.osm-base` filter, `OSM_OPACITY`). Boundaries: GeoJSON files
  `data/geo/{level}.json` and `geo/smd-{set}.json` from `etl/src/etl/export/geo.py`; every geometry
  *version* is a feature with `valid_from`/`valid_to`, and `meta.geo` says which period each file
  covers.
- **One set of borders for all levels**: the exporter cleans the settlement coverage and rebuilds
  the electoral districts from it (the hand-drawn OEVK maps only cut split settlements), so
  district, county and settlement borders coincide. Borders are drawn once from each file's mesh
  (`{name}.lines.json`), never by stroking polygons, and paths are not simplified
  (`smoothFactor: 0`): Leaflet simplifies each path separately, which opened gaps between
  neighbors. County borders (black, thicker) go over the finer levels.
- `ElectionMap` (`map/map.ts`) builds one Leaflet layer per level and set of geometry versions and
  keeps it: a recoloring only repaints fills (`setStyle`), a level switch adds the prebuilt layer
  and removes the old one in the same canvas frame. Other levels are built while the browser is
  idle. `setView(date, colorsPromise)` changes nothing on screen until both the boundaries and the
  colors are in, so the old view stays up instead of flashing. Hover and selection outlines are
  separate polygons on their own panes/canvases (never restyle the fill for them).
- **What the map shows** (`map/coloring.ts`, `?map=`, picked in the toolbar's Map select): the
  shown result view's winners (default; L lists, E single-member candidates by nominating
  parties; the toolbar's Party lists / Single-member switch sets the view for the map and the side
  panel), or a step map: `party:<option>` vote share, `turnout`, or `indicator:<id>` (the year
  closest to the election). Step maps: steps holding equal numbers of areas (sixths + top 5%, cut
  per level), colors mixed in Lab from near-white (lowest) to the color darkened and saturated a
  little (highest). All fills are opaque (`FILL_OPACITY` 1); OSM shows around the units.
  Shares come from `data/shares/{election}/{view}/{option}.json`, indicators from
  `data/indicators/{id}.json`, fetched when picked. Option ids are the parties' ids joined by "-"
  in both views, so a party stays selected across years and views; clicking a result row in the
  side panel picks it.
- **Hierarchical map navigation** (toolbar switch, `?nav=1&focus=<unit>`, off by default; off =
  the old behavior): `map/hierarchy.ts` walks large region -> region -> county -> electoral
  district (OEVK) -> settlement (owner's choice: not the járások, which stay reachable with the
  level buttons) by the units' parents on the shown date (`UnitIndexEntry.earlier_parents` holds
  the pre-2018 Central Hungary chains; districts hang under their county by code; a settlement's
  districts are `UnitIndexEntry.districts`, the set in force on the date). A map click selects the unit and opens it
  (shows its units one level down, `ElectionMap.setScope`, flies to it); search / panel links
  open the unit's parent; level buttons move the focus up when needed; "Go one up" (map, top
  left) returns to the parent. A scoped layer strokes its polygons (the border mesh covers the
  whole level). The legend counts winners among the shown units.
- **Side panel**: with nothing selected it shows the national results (no close button); Escape
  clears the selection (or closes the dialog). National party-list results include the votes cast
  by mail, as the official totals do; "Include postal votes" (`?postal=0` = off) subtracts them
  (`UnitElection.mail` on the country, `lib/results.ts` `withoutMail`; mail votes belong to no
  station or settlement, so nothing else changes).
- **Polling station dialog** (`stations/dialog.ts`, `?list=`, from the panel's "Go to polling
  station list"): **one** sortable table, which shows any level of
  Hungary -> region -> county -> electoral district -> settlement -> polling station. "Go up"
  aggregates the same table one level up (and widens the area when the level reaches it), a click
  on an area row opens it one level down, the breadcrumb climbs back; every aggregate is summed
  from the stations themselves (so no mail votes, and no per-unit fetches). Columns: the row's name
  and the areas above it (electoral districts uppercase), registered, turnout, the six leading
  parties + Other (all on request) as shares (centered, two decimals, equal widths, the largest of
  a row in bold) or votes, and the winner as text; rows tinted with the winner, a two-row header
  (geographical data | electoral register data | party votes | result, the categories divided by a
  brighter rule, the second row's sticky `top` measured in JS so no gap shows while scrolling), a
  grey "-T" after the ID of a transfer station, multi-word search over the row's names (not the
  járás: "Székesfeh" then matched Polgárdi), an electoral district filter and the Party lists /
  Single-member switch. Clicking a station (the leaf) opens its results and participation under the
  row, the side panel's blocks side by side. Data: `data/stations/{election}.json`
  (`export/stations.py`), station ID "MAZ-OEVK-TAZ-SZK" from NVI's own codes
  (`polling_station.nvi_code`, migration 0008). Station votes + mail = national, tested.
- **Hover never uses Leaflet's canvas events** (they check the pointer at most every 32 ms and
  drop the moves in between, so the highlight trailed the cursor). Fill polygons are
  `interactive: false`, panes take no pointer events; the map reads the raw mouse position once
  per animation frame and hit-tests the shown layer itself (`hitTest`, Leaflet's `_containsPoint`
  on the drawn, simplified rings; Leaflet is pinned at 1.9.4 for that). Click uses the same test.
  The hover card (`map/card.ts`, data from the view's `summaries`) is one element moved by a
  transform; its content is rebuilt and measured only when the unit changes. Measured: a sweep
  over 166 settlements ran at the display rate with no long frames.
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
