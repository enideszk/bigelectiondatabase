# Architecture

## Overview

```
data/raw/<source>/          untouched downloads
      │  loader.clean()     pandas: rename, recode, reshape to long format
      ▼
data/interim/<source>/      tidy CSVs whose columns match database tables
      │  loader.load()      one transaction, every row tagged with source_id
      ▼
PostgreSQL 18 + PostGIS     on Server-PC; schema = db/migrations/*.sql
      │  mv_* views         aggregate any reporting level up to every clickable unit
      │
      ├── etl export ──►    web/public/data/*.json      (shapes = web/src/lib/types.ts)
      └── etl tiles  ──►    web/public/tiles/units.pmtiles  (PostGIS ST_AsMVT, packed with pmtiles)
                              │
                              ▼
                     web/ (Vite + TypeScript + MapLibre GL 6) → static files, host anywhere
```

The browser never talks to the database. Every change to the data is published by re-running
`.\etl build` (and `npm run build` for a deployable copy).

## Data model

All table and column names are English. Names shown to users are data (Hungarian official
names, plus `name_en` where an English name exists).

### Conventions that apply everywhere

| Convention | Rule |
|---|---|
| Provenance | Every loaded row has `source_id` → `source`. Deleting a source row cascades to everything it loaded. |
| Foreign keys | Only `source_id` cascades. All other FKs are `DEFERRABLE INITIALLY DEFERRED` (checked at commit), so a source can be deleted and reloaded inside one transaction; Postgres still refuses to delete rows that *other* sources reference. |
| Validity | `valid_from` / `valid_to`, half-open `[from, to)`, NULL = open-ended. `EXCLUDE USING gist` prevents overlapping periods for the same unit / party. |
| Unit ids | `unit_id = unit_type || '-' || code`, enforced by a CHECK. Human-readable, safe as file names and URL parameters. |
| Long format | Results and indicators are one row per unit × thing × value; no wide tables. |

### Territorial units

| Table | Purpose |
|---|---|
| `unit_type` | country, nuts1, nuts2, county, jaras, settlement, bp_district, smd, polling_station, special — with English/Hungarian labels, rank, and whether the website shows it |
| `unit` | every geographic unit, with its own validity period |
| `unit_name` | earlier names of a unit that kept its code |
| `unit_parent` | the administrative hierarchy over time; one direct parent at a time (settlement → county before 2013, → járás from 2013) |
| `unit_lineage` | crosswalk: merge, split (with weight), rename / recode (new code), transfer of territory |
| `unit_geometry` | boundaries, versioned by validity period (EPSG:4326 MultiPolygons) |

Codes: settlements and Budapest districts use 5-digit KSH codes; counties the KSH county code
(01 = Budapest … 13 = Pest … 20 = Zala, `data/reference/counties.csv`); regions NUTS codes;
electoral districts `<set>-<county>-<nn>` (e.g. `smd-2011-07-01` = Fejér 01 under the 2011 law).
NVI election files number counties differently in different years, so loaders map them by name.

Budapest: the city as a whole is `county-01`; its districts are `bp_district-<KSH code>`
(e.g. `bp_district-09566` = Budapest I. kerület), clickable units of their own (district XXIII
appears in 1994 via a `split` lineage row from XX).

### Elections

| Table | Purpose |
|---|---|
| `election_type` | parliament, ep, local, referendum |
| `election` | one row per election (`parliament-2022`), date of round 1, district set used |
| `election_round` | round 1 always; round 2 for 1990–2010 parliamentary elections |
| `district_set` | the single-member district geography of one law: `1990` (176), `2011` (106), `2024` (106, redrawn) |
| `electoral_district` | extra attributes of `smd` units: set, county, number, seat |
| `district_membership` | settlement ↔ district, many-to-many (a city split between districts has several rows) |
| `polling_station` | extra attributes of `polling_station` units: election, settlement, district, number, transfer flag |

### Parties, lists, candidates, results

| Table | Purpose |
|---|---|
| `party` | stable id (`fidesz`, `mszp`, …) that survives renames; color |
| `party_name` | name history |
| `party_list` | what voters chose on the list ballot; `scope_unit_id` for lists that exist only in one area |
| `party_list_member` | the parties behind a list (joint lists have several) |
| `candidate` | a candidate in one race (`race_type` smd / mayor / …; `district_unit_id` = the race's unit) |
| `candidate_party` | nominating parties (none = independent; joint candidates have several) |
| `turnout` | registered, voted, valid, invalid per election × round × unit × ballot (`list` / `candidate`) |
| `list_result` | votes per election × round × unit × list |
| `candidate_result` | votes per election × round × unit × candidate |

**Results are stored at whatever level the source provides** (polling station, settlement,
district, special unit such as mail votes) — but **one level per election**, and never totals that
can be derived. `etl check` reports violations.

1990–2010 territorial (county) lists of the same party or coalition are stored as one
`party_list` per election; the county is implied by where the votes were cast.

### Indicators

`indicator` (id, English/Hungarian name, unit of measure, decimals, definition) and
`indicator_value` (unit × indicator × year → value). Values are stored for the units the source
covers; nothing is aggregated automatically, because rates cannot be summed.

### Aggregation (db/migrations/0005_views.sql)

- `v_unit_ancestor`: every unit with every ancestor and the period that chain of parents holds.
- `mv_rollup`: for each election, which reporting unit counts toward which clickable unit:
  1. a clickable reporting unit counts toward itself;
  2. a polling station counts toward its settlement and its electoral district;
  3. settlements (and special units) count toward their administrative ancestors on election day;
  4. settlement-level rows count toward an electoral district only if the settlement lies in one
     district of that election's set (split cities need polling-station data for district totals);
  5. district-level rows count toward their county and its ancestors.
- `mv_turnout_agg`, `mv_list_result_agg`: sums over the rollup.
- `mv_candidate_result_agg`: rollup for administrative units; district totals come straight from
  each candidate's own district (exact at any reporting level).
- `mv_list_winner`: winning list per unit (round 1); colors the map.

Refresh with `CALL refresh_aggregates();` or `.\etl db refresh` (`etl export` does it first).

## Static files (the website's API)

Defined in `web/src/lib/types.ts`; the exporter must produce exactly these shapes (the Python
tests validate every file against the generated `types.schema.json`).

| File | Content |
|---|---|
| `data/meta.json` | elections (with rounds and district set), indicators, unit type names, `is_fixture` |
| `data/units/index.json` | every clickable unit: id, type, name, current ancestors (search, breadcrumbs) |
| `data/units/{unit_id}.json` | one unit: parents with validity, former names, lineage, and per election: districts, turnout, list results, races per district and round (or districts won per party above county level), indicators |
| `data/elections/{election_id}.json` | lists with colors and the winning list per unit (map colors) |
| `tiles/units.pmtiles` | one vector layer per map level; every geometry version is a feature with `vf`/`vt` dates |

## Website

- `src/state.ts`: state ⇄ URL (`?unit=&year=&type=&view=L|E&round=&level=`).
- `src/map/`: MapLibre map, PMTiles protocol, one fill/line/outline layer per level, filtered to
  the geometry versions valid on the selected election date; hover/selection via feature-state.
- `src/sidebar/`: the side panel (header, participation, results with L/E toggle, ballots,
  indicators). Its look follows the Israel 2026 dashboard (`ilelection/dashboard`): dark theme,
  the same color tokens, rows with party-colored bars behind them.
- `src/components/`: donut, result rows, indicator table, segmented toggle — plain SVG/DOM.
- `src/lib/`: types (the contract), fetching, formatting (en-US), UI text (`i18n.ts`).

## Decisions and their reasons

| Decision | Why |
|---|---|
| No Docker; PostgreSQL as a Windows service on Server-PC | owner's choice; the site will be served from Server-PC anyway |
| Tiles cut by PostGIS (`ST_AsMVT`) and packed with the `pmtiles` Python package | tippecanoe has no Windows build; this needs no external program |
| Polling stations are units | every result table references `unit_id` whatever the reporting level |
| Deferred foreign keys | delete-and-reload of a source cascades through several tables; immediate checks fired before the cascades finished |
| Extensions in their own schema | `etl db reset` can drop `public` without touching PostGIS |
| JSON Schema generated from `types.ts` | one source of truth for the file shapes, checked from both Python and TypeScript |
| `etl.cmd` wrapper, venv in `%LOCALAPPDATA%` | the repo is on a network share; see CLAUDE.md |
