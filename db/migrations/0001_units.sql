-- 0001: provenance, territorial units, their names, hierarchy, lineage and geometries.
--
-- Conventions (see docs/architecture.md):
--   * Validity periods are half-open [valid_from, valid_to). NULL valid_from = "since before
--     our coverage", NULL valid_to = "still valid".
--   * Every loaded row carries source_id. Only source_id foreign keys cascade, so reloading a
--     source = delete its source row + insert again. Postgres refuses the delete if rows from
--     other sources still point at the deleted rows (which is what we want).
--   * All other foreign keys are DEFERRABLE INITIALLY DEFERRED: they are checked at COMMIT, after
--     the cascades of a source delete have finished. Write new foreign keys the same way.
--   * unit_id = unit_type || '-' || code, e.g. settlement-33525, county-07, smd-2011-07-01.

CREATE TABLE source (
    source_id      serial PRIMARY KEY,
    name           text NOT NULL UNIQUE,          -- stable name the loader looks itself up by
    publisher      text,
    url            text,
    file_name      text,
    downloaded_on  date,
    license        text,
    notes          text,
    loaded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit_type (
    unit_type     text PRIMARY KEY,
    name_en       text NOT NULL,
    name_hu       text NOT NULL,
    rank          smallint NOT NULL,              -- 0 = country; larger = finer
    is_clickable  boolean NOT NULL                -- exported to the website
);

INSERT INTO unit_type (unit_type, name_en, name_hu, rank, is_clickable) VALUES
    ('country',         'Country',             'Ország',                 0, true),
    ('nuts1',           'Large region',        'Nagyrégió',              1, true),
    ('nuts2',           'Region',              'Régió',                  2, true),
    ('county',          'County',              'Vármegye',               3, true),
    ('smd',             'Electoral district',  'Egyéni választókerület', 4, true),
    ('jaras',           'District (járás)',    'Járás',                  4, true),
    ('settlement',      'Settlement',          'Település',              5, true),
    ('bp_district',     'Budapest district',   'Budapesti kerület',      5, true),
    ('polling_station', 'Polling station',     'Szavazókör',             6, false),
    ('special',         'Special voting unit', 'Különleges szavazóegység', 6, false);  -- mail votes, abroad

CREATE TABLE unit (
    unit_id     text PRIMARY KEY,
    unit_type   text NOT NULL REFERENCES unit_type DEFERRABLE INITIALLY DEFERRED,
    code        text NOT NULL,                    -- natural code: KSH code, NUTS code, ...
    name        text NOT NULL,                    -- official (Hungarian) name, latest
    name_en     text,                             -- English name where one exists (regions, country)
    valid_from  date,
    valid_to    date,
    source_id   integer NOT NULL REFERENCES source ON DELETE CASCADE,
    UNIQUE (unit_type, code),
    CHECK (unit_id = unit_type || '-' || code),
    CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to)
);

-- Earlier names of a unit that kept its code. (A new code = a new unit + a lineage row.)
CREATE TABLE unit_name (
    unit_id     text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    name        text NOT NULL,
    valid_from  date,
    valid_to    date,
    source_id   integer NOT NULL REFERENCES source ON DELETE CASCADE,
    EXCLUDE USING gist (unit_id WITH =, daterange(valid_from, valid_to) WITH &&)
);

-- Administrative hierarchy: one direct parent per unit at any time.
-- settlement -> jaras (from 2013) or -> county (before); bp_district -> county-01 (Budapest);
-- jaras -> county -> nuts2 -> nuts1 -> country. Electoral districts are NOT in this tree.
CREATE TABLE unit_parent (
    child_unit_id   text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    parent_unit_id  text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    valid_from      date,
    valid_to        date,
    source_id       integer NOT NULL REFERENCES source ON DELETE CASCADE,
    CHECK (child_unit_id <> parent_unit_id),
    EXCLUDE USING gist (child_unit_id WITH =, daterange(valid_from, valid_to) WITH &&)
);
CREATE INDEX unit_parent_parent_idx ON unit_parent (parent_unit_id);

-- Crosswalk: which unit became which.
--   merge:    from_unit ceased, its territory went into to_unit (weight 1 or NULL)
--   split:    part of from_unit became to_unit; weight = share (e.g. of voters) that moved
--   rename:   new code for the same place (same-code renames go into unit_name instead)
--   recode:   new code, nothing else changed
--   transfer: a piece of territory moved between two existing units; weight = share moved
CREATE TABLE unit_lineage (
    from_unit_id  text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    to_unit_id    text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    change_date   date NOT NULL,
    change_type   text NOT NULL CHECK (change_type IN ('merge', 'split', 'rename', 'recode', 'transfer')),
    weight        double precision CHECK (weight > 0 AND weight <= 1),
    notes         text,
    source_id     integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (from_unit_id, to_unit_id, change_date),
    CHECK (from_unit_id <> to_unit_id)
);
CREATE INDEX unit_lineage_to_idx ON unit_lineage (to_unit_id);

-- Boundaries, versioned: one unit can have different shapes in different periods.
CREATE TABLE unit_geometry (
    unit_id     text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    valid_from  date,
    valid_to    date,
    geom        geometry(MultiPolygon, 4326) NOT NULL,
    source_id   integer NOT NULL REFERENCES source ON DELETE CASCADE,
    EXCLUDE USING gist (unit_id WITH =, daterange(valid_from, valid_to) WITH &&)
);
CREATE INDEX unit_geometry_geom_idx ON unit_geometry USING gist (geom);
