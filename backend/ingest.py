"""
SEC EDGAR data ingestion.

Rate limits:
  - SEC allows max 10 requests/second
  - We use 7 req/sec (DELAY = 0.143s) to stay safely under the limit
  - A semaphore caps concurrent requests at 5
  - On 429 responses we back off and retry

Data source:
  1. https://www.sec.gov/files/company_tickers_exchange.json  (~10k public companies)
  2. https://data.sec.gov/submissions/CIK{padded}.json        (per-company details)
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx

import database

logger = logging.getLogger(__name__)

# ── rate-limit settings ────────────────────────────────────────────────────────
DELAY       = 0.143          # seconds between requests  (~7 req/s)
MAX_CONCURRENT = 5           # concurrent in-flight requests
MAX_RETRIES = 3
BACKOFF_BASE = 2.0           # seconds; doubles on each retry

# ── headers required by SEC ───────────────────────────────────────────────────
HEADERS = {
    "User-Agent":       "SEC Explorer contact@secexplorer.local",
    "Accept-Encoding":  "gzip, deflate",
}

# ── shared progress state (in-memory, single process) ────────────────────────
_progress: dict = {
    "status":       "idle",   # idle | running | completed | failed
    "total":        0,
    "processed":    0,
    "failed":       0,
    "started_at":   None,
    "completed_at": None,
    "job_id":       None,
}


def get_progress() -> dict:
    return dict(_progress)


def _update(status=None, **kwargs):
    if status:
        _progress["status"] = status
    _progress.update(kwargs)


# ── HTTP helpers ───────────────────────────────────────────────────────────────
async def _fetch(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> dict | None:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with sem:
                resp = await client.get(url, headers=HEADERS, timeout=20)
                await asyncio.sleep(DELAY)          # pace after every request

            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                wait = BACKOFF_BASE ** attempt
                logger.warning("429 rate-limited – sleeping %.1fs (attempt %d)", wait, attempt)
                await asyncio.sleep(wait)
                continue
            logger.debug("HTTP %d for %s", resp.status_code, url)
            return None
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            wait = BACKOFF_BASE ** attempt
            logger.warning("Request error %s – retrying in %.1fs", exc, wait)
            await asyncio.sleep(wait)
    return None


# ── parsing ────────────────────────────────────────────────────────────────────
def _parse_submission(cik_str: str, data: dict, ticker: str, exchange: str) -> dict:
    """Extract the fields we care about from a submissions JSON blob."""
    addresses = data.get("addresses", {})
    biz = addresses.get("business", {})

    # Earliest filing year from the 'recent' filings list
    filing_dates: list[str] = data.get("filings", {}).get("recent", {}).get("filingDate", [])
    first_year = None
    if filing_dates:
        try:
            first_year = min(int(d[:4]) for d in filing_dates if d)
        except ValueError:
            pass

    return {
        "cik":                    cik_str,
        "name":                   data.get("name", ""),
        "ticker":                 ticker,
        "exchange":               exchange,
        "sic":                    data.get("sic", ""),
        "sic_description":        data.get("sicDescription", ""),
        "state_of_incorporation": data.get("stateOfIncorporation", ""),
        "business_state":         biz.get("stateOrCountry", ""),
        "business_city":          biz.get("city", ""),
        "category":               data.get("category", ""),
        "fiscal_year_end":        data.get("fiscalYearEnd", ""),
        "phone":                  data.get("phone", ""),
        "website":                data.get("website", "") or data.get("investorWebsite", ""),
        "first_filing_year":      first_year,
        "last_updated":           datetime.now(timezone.utc).isoformat(),
    }


# ── main ingest ────────────────────────────────────────────────────────────────
async def run_ingest(force: bool = False):
    """
    Full ingest pipeline.  Runs as a background asyncio task.
    Set force=True to re-fetch companies already in the DB.
    """
    if _progress["status"] == "running":
        logger.info("Ingest already running – ignoring duplicate request")
        return

    _update(status="running", processed=0, failed=0, total=0,
            started_at=datetime.now(timezone.utc).isoformat(), completed_at=None)

    job_id = await database.create_ingest_job()
    _progress["job_id"] = job_id

    sem = asyncio.Semaphore(MAX_CONCURRENT)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # ── Step 1: download company ticker list ──────────────────────────────
        logger.info("Fetching company tickers list …")
        ticker_data = await _fetch(
            client,
            "https://www.sec.gov/files/company_tickers_exchange.json",
            sem,
        )
        if not ticker_data:
            logger.error("Failed to fetch company tickers list")
            _update(status="failed", completed_at=datetime.now(timezone.utc).isoformat())
            await database.update_ingest_job(job_id, 0, 0, 0, "failed")
            return

        # ticker_data is a dict {"0": {cik_str, ticker, title, exchange}, ...}
        entries = list(ticker_data.values())

        # De-duplicate by CIK (same company may have multiple share-class tickers)
        seen: dict[str, dict] = {}
        for e in entries:
            cik = str(e.get("cik_str", "")).strip()
            if cik and cik not in seen:
                seen[cik] = e
        unique = list(seen.values())

        # Optionally skip CIKs already in DB
        if not force:
            existing = await database.get_existing_ciks()
            unique = [e for e in unique if str(e.get("cik_str", "")) not in existing]
            logger.info("%d new companies to fetch (skipping %d already in DB)",
                        len(unique), len(existing))

        total = len(unique)
        _update(total=total)
        await database.update_ingest_job(job_id, 0, 0, total, "running")

        if total == 0:
            _update(status="completed", completed_at=datetime.now(timezone.utc).isoformat())
            await database.update_ingest_job(job_id, 0, 0, 0, "completed")
            return

        # ── Step 2: fetch submission data for each company ────────────────────
        processed = 0
        failed = 0
        batch: list[dict] = []
        BATCH_SIZE = 50       # write to DB every N companies

        async def fetch_one(entry: dict):
            nonlocal processed, failed
            cik_int = entry.get("cik_str", 0)
            cik_str = str(cik_int)
            cik_padded = cik_str.zfill(10)
            ticker = entry.get("ticker", "") or ""
            exchange = entry.get("exchange", "") or ""

            url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
            data = await _fetch(client, url, sem)
            if data:
                row = _parse_submission(cik_str, data, ticker, exchange)
                batch.append(row)
                processed += 1
            else:
                failed += 1
                logger.debug("Failed to fetch CIK %s", cik_str)

            # Flush batch to DB
            if len(batch) >= BATCH_SIZE:
                await database.bulk_upsert_companies(batch)
                batch.clear()

            _update(processed=processed, failed=failed)
            if (processed + failed) % 100 == 0:
                await database.update_ingest_job(job_id, processed, failed, total, "running")

        # Run fetches with bounded concurrency
        tasks = [fetch_one(e) for e in unique]
        await asyncio.gather(*tasks)

        # Flush remaining rows
        if batch:
            await database.bulk_upsert_companies(batch)

    _update(status="completed", completed_at=datetime.now(timezone.utc).isoformat())
    await database.update_ingest_job(job_id, processed, failed, total, "completed")
    logger.info("Ingest complete – %d processed, %d failed", processed, failed)
