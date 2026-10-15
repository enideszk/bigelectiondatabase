# Reference data (hand-curated, real)

Small tables that no single source provides and that are maintained by hand, for example:

- `parties.csv`: stable party ids, official names over time, colors
- `party_aliases.csv`: list names and nominating organisations as the NVI files write them →
  party ids, display name, short name, color; `years` limits a row to some elections
- `elections.csv`, `election_rounds.csv`: every election with its type, rounds and district set
- `settlement_names.csv`: settlement names in the 1990–2010 files that are not today's (old
  spellings, renames, joint villages split since) → today's settlement
- `settlement_counties.csv`: settlements that belonged to another county before a date
- `counties.csv`, `regions.csv`: KSH county codes, NUTS regions

They are committed (unlike `data/raw/`) and loaded by their own loader like any other source.
