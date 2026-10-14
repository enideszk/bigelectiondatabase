"""Allows `python -m etl ...` (what the repo's etl.cmd wrapper runs)."""

from etl.cli import app

app(prog_name="etl")
