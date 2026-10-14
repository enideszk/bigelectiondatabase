"""`etl tiles` writes a readable PMTiles file with every layer."""

from __future__ import annotations

import gzip

from pmtiles.reader import MmapSource, Reader
from pmtiles.tile import TileType

from etl import db
from etl.tiles import LAYERS, build_pmtiles


def test_pmtiles_has_all_layers_and_tiles(test_db_url, seeded, tmp_path):
    out = tmp_path / "units.pmtiles"
    with db.connect(test_db_url) as conn:
        stats = build_pmtiles(conn, out, max_zoom=6)
    assert stats["tiles"] > 0

    with out.open("rb") as f:
        reader = Reader(MmapSource(f))
        header = reader.header()
        assert header["tile_type"] == TileType.MVT
        assert (header["min_zoom"], header["max_zoom"]) == (0, 6)
        assert [layer["id"] for layer in reader.metadata()["vector_layers"]] == list(LAYERS)
        world = gzip.decompress(reader.get(0, 0, 0))
    for layer in LAYERS:
        assert layer.encode() in world, f"layer {layer} missing from tile 0/0/0"
