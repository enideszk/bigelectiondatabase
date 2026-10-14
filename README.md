# Hungarian election & socio-demographic data platform

Every Hungarian election from 1990 to 2026 plus socio-demographic indicators, on one map. Click a
settlement, county, region or electoral district and the sidebar shows its results and indicators
for the selected year.

**Status: Phase 1.** Architecture, database schema and a working website, running on a small
**FAKE** fixture dataset (`data/fixtures/`). No real data is loaded yet.

```
Sources (data/raw) ──► ETL loaders ──► PostgreSQL + PostGIS ──► etl export / etl tiles ──► static site (web/)
                       (etl/)          (Server-PC)              JSON + PMTiles            (Vite, MapLibre)
```

The website is fully static: nothing in the browser talks to the database. The database is only
used to build the site's data files.

## Prerequisites

| What | Version | Install |
|---|---|---|
| Git | any | already installed |
| uv (Python manager) | 0.13+ | `winget install astral-sh.uv` (then open a new terminal) |
| Node.js | 22.12+ | already installed |
| PostgreSQL + PostGIS | 18 + 3.6 | already running on Server-PC (192.168.0.253); see [docs/server-setup.md](docs/server-setup.md) |

uv downloads the right Python by itself.

## First run (fresh clone, Windows, PowerShell)

```powershell
git clone https://github.com/enideszk/bigelectiondatabase.git
cd bigelectiondatabase
copy .env.example .env        # then put the hudata password into .env (twice)

.\etl db up                   # create the schema (applies db/migrations/)
.\etl seed fixtures           # load the FAKE fixture data
.\etl build                   # write web/public/data/*.json and web/public/tiles/units.pmtiles

cd web
npm install
npm run dev                   # open http://localhost:5173
```

`.\etl` is `etl.cmd` in the repo root: it runs the Python CLI (`etl/`) through uv, with the Python
environment kept on the local disk (see [CLAUDE.md](CLAUDE.md) for why). `.\etl --help` lists
every command.

## Everyday commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `.\etl db up` | apply new migrations |
| `.\etl db status` | list applied / pending migrations |
| `.\etl db reset --yes` | **delete everything** in the database and re-create the schema (development only) |
| `.\etl seed fixtures` | (re)load the fake fixture |
| `.\etl load <name>` | run a real-data loader (raw → interim → database), see [docs/adding-a-source.md](docs/adding-a-source.md) |
| `.\etl check` | data-quality checks; run after every load |
| `.\etl export` | database → `web/public/data/` (JSON) |
| `.\etl tiles` | database → `web/public/tiles/units.pmtiles` |
| `.\etl build` | export + tiles |
| `.\etl test` | Python tests (uses the separate `hu_data_test` database, which it wipes) |
| `npm run dev` (in `web/`) | website with live reload |
| `npm test` (in `web/`) | website tests |
| `npm run build` (in `web/`) | production build into `web/dist/` (static files, host anywhere) |
| `npm run schema` (in `web/`) | regenerate `types.schema.json` after editing `web/src/lib/types.ts` |

## Repository layout

```
CLAUDE.md                conventions + how everything works (also for AI-assisted sessions)
etl.cmd                  runs the ETL CLI: .\etl <command>
.env.example             settings template (copy to .env)
data/
  raw/                   untouched downloads (gitignored, never edited)
  interim/               cleaned files written by loaders (gitignored)
  fixtures/              small FAKE dataset + its generator (committed)
  reference/             (later) small hand-curated real tables
db/
  bootstrap.sql          one-time database creation (superuser)
  migrations/            numbered SQL files: the schema
etl/                     Python package: CLI, loaders, export, tiles, tests
web/                     the website (Vite + TypeScript + MapLibre)
docs/
  architecture.md        data model and design
  adding-a-source.md     step by step: adding a real data source
  data-sources.md        inventory of sources
  server-setup.md        how PostgreSQL/PostGIS was installed on Server-PC
```

## Documentation

- [docs/architecture.md](docs/architecture.md): how the pieces fit, the data model, aggregation rules
- [docs/adding-a-source.md](docs/adding-a-source.md): adding a loader for a real source
- [docs/data-sources.md](docs/data-sources.md): which sources exist and what they cover
- [docs/server-setup.md](docs/server-setup.md): database server installation and maintenance
