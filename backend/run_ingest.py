"""
Run this to download company data from SEC EDGAR.
Progress is printed to the terminal.

Usage:
    python run_ingest.py
"""
import asyncio
import logging
import ingest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)

asyncio.run(ingest.run_ingest())
