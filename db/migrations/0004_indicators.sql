-- 0004: socio-demographic indicators (long format).

CREATE TABLE indicator (
    indicator_id     text PRIMARY KEY CHECK (indicator_id ~ '^[a-z0-9_]+$'),
    name_en          text NOT NULL,
    name_hu          text NOT NULL,
    unit_of_measure  text NOT NULL,              -- shown after the value: '%', 'HUF', 'persons'
    decimals         smallint NOT NULL DEFAULT 0,
    description      text,                       -- definition, as the source states it
    source_id        integer NOT NULL REFERENCES source ON DELETE CASCADE
);

-- Values are stored for whatever units the source covers; nothing is aggregated automatically
-- (rates cannot simply be summed). Load county/national values explicitly if the source has them.
CREATE TABLE indicator_value (
    unit_id       text NOT NULL REFERENCES unit DEFERRABLE INITIALLY DEFERRED,
    indicator_id  text NOT NULL REFERENCES indicator DEFERRABLE INITIALLY DEFERRED,
    year          smallint NOT NULL CHECK (year BETWEEN 1900 AND 2100),
    value         double precision NOT NULL,
    source_id     integer NOT NULL REFERENCES source ON DELETE CASCADE,
    PRIMARY KEY (unit_id, indicator_id, year)
);
CREATE INDEX indicator_value_indicator_idx ON indicator_value (indicator_id, year);
