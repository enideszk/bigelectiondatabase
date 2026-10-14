# Data sources

One row per source (= one loader / one `source.name`). Fill in as sources are added; see
[adding-a-source.md](adding-a-source.md).

| Source | URL | Coverage | Years | Level | Loader | Status | Notes |
|---|---|---|---|---|---|---|---|
| Curated reference: country, NUTS regions, counties | `data/reference/` | country, NUTS 1/2, 20 counties with KSH codes | 1990– | county | `reference_regions` | loaded | HU10 (Budapest + Pest) until 2018-01-01, HU11/HU12 since. Csongrád → Csongrád-Csanád 2020-06-04. |
| KSH Helységnévtár 2026 | https://www.ksh.hu/apps/hntr.main | settlements, Budapest districts, járások; population, area, dwellings | state of 2026-01-01 | settlement | `ksh_helysegnevtar` | loaded | Raw `data/raw/ksh_helysegnevtar_2026/hnt_letoltes_2026.xlsx`. 3,154 settlements + 23 districts + 174 járások. Járás assignment of 2026 used from 2013. Indicator year labelled 2026 (as the sheet's reference date) — confirm against KSH methodology. |
| OpenStreetMap boundaries 2026 | https://www.openstreetmap.org/ | settlement, Budapest district, county and country polygons | 2026 | settlement | `osm_boundaries_2026` | loaded | GeoPackage prepared by the owner (`magyarorszag_telepulesek.gpkg`, EPSG:4326). No KSH codes: matched by name, 3,177/3,177. Járás and NUTS shapes = union of settlements. ODbL, attribution required. |
| OEVK maps 1990, 2011, 2024 | provided by the owner (`oevk_maps`) | single-member district polygons for the three district sets | 1990–2010, 2014–2022, 2026– | district | `oevk_maps` | loaded | `data/raw/oevk_terkepek/`. 176 / 106 / 106 districts named "<county> NN". 2014 and 2022 files are geometrically identical (only Csongrád → Csongrád-Csanád), so the 2022 file is loaded for the 2011 set. 2024 set: Budapest 18 → 16, Pest 12 → 14. A few invalid polygons are repaired on load. Settlement membership derived spatially (same county, ≥ 10% of area), provisional. |
| NVI election results archive 1990–2026 | https://www.valasztas.hu/ | parliamentary (1990–2026), local (1990–2024), EP (2004–2024), referendums (1997–2022), nationality (2019, 2024), intraday turnout (`rszv/`) | 1990–2026 | polling station | — | downloaded | `data/raw/valasztasi_eredmenyek_1990-2024/`, 50,324 files. Formats: 1990–2010 pipe-delimited txt (cp1250) with readmes; 2014/2018 CSV; 2019+ xls/xlsx; 2003/2004/2018 also HTML mirrors (ignore). 2026 includes `oevk (1).json` (106 OEVK polygons) and the polling-district address list. |

Column guide:

- **Source**: publisher and dataset, the same text as `SOURCE.name` in the loader.
- **Coverage**: what it contains (e.g. "parliamentary results, list + single-member", "settlement boundaries").
- **Years**: elections or reference years covered.
- **Level**: the finest unit the data comes at (polling station, settlement, district, county, national).
- **Loader**: module name under `etl/src/etl/loaders/` (`.\etl load <name>`).
- **Status**: planned / downloaded / loaded / checked.
- **Notes**: known problems, gaps, licence conditions, quirks found while loading.
