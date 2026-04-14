"""
SEC EDGAR data ingestion.

Rate limits:
  - SEC allows max 10 requests/second
  - We use 7 req/sec (DELAY = 0.143s) to stay safely under the limit
  - Companies are processed one at a time in a simple loop (no gather)
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
DELAY        = 0.143   # seconds between requests (~7 req/s, well under SEC's 10 req/s limit)
MAX_RETRIES  = 3
BACKOFF_BASE = 2.0     # seconds; doubles on each retry
BATCH_SIZE   = 25      # write to DB every N companies

# ── headers required by SEC ───────────────────────────────────────────────────
HEADERS = {
    "User-Agent":      "SEC Explorer contact@secexplorer.local",
    "Accept-Encoding": "gzip, deflate",
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
async def _fetch(client: httpx.AsyncClient, url: str) -> dict | None:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=30)
            await asyncio.sleep(DELAY)   # pace every request regardless of outcome

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
    addresses = data.get("addresses", {})
    biz = addresses.get("business", {})

    filing_dates: list[str] = (
        data.get("filings", {}).get("recent", {}).get("filingDate", [])
    )
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
    Full ingest pipeline. Processes companies one at a time in a simple loop
    so memory stays flat and progress tracking is accurate.
    """
    if _progress["status"] == "running":
        logger.info("Ingest already running – ignoring duplicate request")
        return

    _update(status="running", processed=0, failed=0, total=0,
            started_at=datetime.now(timezone.utc).isoformat(), completed_at=None)

    job_id = await database.create_ingest_job()
    _progress["job_id"] = job_id

    async with httpx.AsyncClient(follow_redirects=True) as client:

        # ── Step 1: fetch company list ─────────────────────────────────────────
        logger.info("Fetching company tickers list …")
        ticker_data = await _fetch(
            client, "https://www.sec.gov/files/company_tickers_exchange.json"
        )
        if not ticker_data:
            logger.error("Failed to fetch company tickers list")
            _update(status="failed", completed_at=datetime.now(timezone.utc).isoformat())
            await database.update_ingest_job(job_id, 0, 0, 0, "failed")
            return

        # De-duplicate by CIK
        seen: dict[str, dict] = {}
        for e in ticker_data.values():
            cik = str(e.get("cik_str", "")).strip()
            if cik and cik not in seen:
                seen[cik] = e
        unique = list(seen.values())

        if not force:
            existing = await database.get_existing_ciks()
            unique = [e for e in unique if str(e.get("cik_str", "")) not in existing]
            logger.info("%d new companies to fetch (%d already in DB)",
                        len(unique), len(existing))

        total = len(unique)
        _update(total=total)
        await database.update_ingest_job(job_id, 0, 0, total, "running")

        if total == 0:
            logger.info("Nothing new to ingest")
            _update(status="completed", completed_at=datetime.now(timezone.utc).isoformat())
            await database.update_ingest_job(job_id, 0, 0, 0, "completed")
            return

        # ── Step 2: fetch each company one at a time ───────────────────────────
        processed = 0
        failed    = 0
        batch: list[dict] = []

        for i, entry in enumerate(unique):
            cik_str    = str(entry.get("cik_str", ""))
            cik_padded = cik_str.zfill(10)
            ticker     = entry.get("ticker", "") or ""
            exchange   = entry.get("exchange", "") or ""

            url  = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
            data = await _fetch(client, url)

            if data:
                batch.append(_parse_submission(cik_str, data, ticker, exchange))
                processed += 1
            else:
                failed += 1

            # Flush batch to DB
            if len(batch) >= BATCH_SIZE:
                await database.bulk_upsert_companies(batch)
                batch.clear()

            # Update progress every company
            _update(processed=processed, failed=failed)

            # Persist to DB every 100 companies
            if (i + 1) % 100 == 0:
                await database.update_ingest_job(job_id, processed, failed, total, "running")
                logger.info("Progress: %d / %d (%.0f%%)", i + 1, total,
                            (i + 1) / total * 100)

        # Flush any remaining rows
        if batch:
            await database.bulk_upsert_companies(batch)

    _update(status="completed", completed_at=datetime.now(timezone.utc).isoformat())
    await database.update_ingest_job(job_id, processed, failed, total, "completed")
    logger.info("Ingest complete – %d processed, %d failed", processed, failed)
