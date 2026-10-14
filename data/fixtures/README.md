# FAKE fixture data

**Everything in this folder is invented.** Places, codes, boundaries, parties, candidates, votes
and indicator values are made up for development. They are not real Hungarian data.

- Codes never collide with real ones: settlements `99xxx`, counties `91` and `92`, country `XX`.
- The website shows a "fake development data" banner while this data is loaded.
- `.\etl seed fixtures` loads it (and refuses if the database holds real sources).

What it exercises: a split city in two electoral districts with polling-station results, a
settlement merge with versioned boundaries, a same-code rename, a party rename, joint lists and
candidates, an independent candidate, a 2010 election with a second round, two district sets,
járások that only exist from 2013, mail votes, and 3 indicators for 2011 and 2022.

## Files

The CSV headers match the database column names; `etl/src/etl/loaders/fixtures.py` loads them in
dependency order. `geometries.geojson` holds the boundaries (EPSG:4326) with `unit_id`,
`valid_from`, `valid_to` properties.

## Changing it

Edit `make_fixtures.py` and regenerate rather than editing the CSVs by hand:

```powershell
& "$env:LOCALAPPDATA\hu-data-platform\etl-venv\Scripts\python.exe" data\fixtures\make_fixtures.py
.\etl seed fixtures
.\etl build
```

(Any Python 3.12+ works; the script uses only the standard library.)
