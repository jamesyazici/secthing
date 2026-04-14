import asyncio
import logging
import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware

import database
import ingest
from sic_codes import SIC_CODES, SIC_SECTORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SEC Explorer API")

# In production set ALLOWED_ORIGINS="https://yourusername.github.io" in your Render env vars.
# Defaults to localhost for local dev.
_raw = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
_origins = [o.strip() for o in _raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

HEADERS = {
    "User-Agent": "SEC Explorer contact@secexplorer.local",
    "Accept-Encoding": "gzip, deflate",
}


@app.on_event("startup")
async def startup():
    await database.init_db()
    logger.info("Database initialised")


# ── SIC codes ──────────────────────────────────────────────────────────────────

@app.get("/api/sic-codes")
async def get_sic_codes():
    """All known SIC codes with descriptions, grouped by sector."""
    return {
        "codes": [{"code": k, "description": v} for k, v in SIC_CODES.items()],
        "sectors": {
            sector: [{"code": c, "description": SIC_CODES.get(c, "")} for c in codes]
            for sector, codes in SIC_SECTORS.items()
        },
    }


# ── Filter options (populated from DB) ────────────────────────────────────────

@app.get("/api/filter-options")
async def get_filter_options():
    """
    Returns states, categories, SIC codes actually present in the DB,
    and the year range — used to populate filter dropdowns.
    """
    return await database.get_filter_options()


# ── Company list ───────────────────────────────────────────────────────────────

@app.get("/api/companies")
async def get_companies(
    sic:       Optional[str] = Query(None, description="SIC code"),
    state:     Optional[str] = Query(None, description="Business state (2-letter code)"),
    category:  Optional[str] = Query(None, description="Filer category"),
    year_from: Optional[int] = Query(None, description="Min first-filing year"),
    year_to:   Optional[int] = Query(None, description="Max first-filing year"),
    search:    Optional[str] = Query(None, description="Name search"),
    sort_by:   str           = Query("name"),
    sort_dir:  str           = Query("asc"),
    page:      int           = Query(1, ge=1),
    page_size: int           = Query(50, ge=1, le=200),
):
    return await database.query_companies(
        sic=sic, state=state, category=category,
        year_from=year_from, year_to=year_to,
        search=search, sort_by=sort_by, sort_dir=sort_dir,
        page=page, page_size=page_size,
    )


# ── Company detail ─────────────────────────────────────────────────────────────

@app.get("/api/companies/{cik}")
async def get_company(cik: str):
    """
    Returns stored company data + live-fetched details from SEC EDGAR
    (employee count, recent filings, full address).
    """
    company = await database.get_company_by_cik(cik)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found in local database")

    cik_padded = cik.zfill(10)
    live: dict = {}

    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        # ── Submission data (address, phone, website refresh) ─────────────────
        try:
            r = await client.get(
                f"https://data.sec.gov/submissions/CIK{cik_padded}.json",
                headers=HEADERS,
            )
            if r.status_code == 200:
                sub = r.json()
                addresses = sub.get("addresses", {})
                biz = addresses.get("business", {})
                mail = addresses.get("mailing", {})
                live["business_address"] = {
                    "street1":  biz.get("street1", ""),
                    "street2":  biz.get("street2", ""),
                    "city":     biz.get("city", ""),
                    "state":    biz.get("stateOrCountry", ""),
                    "zip":      biz.get("zipCode", ""),
                }
                live["mailing_address"] = {
                    "street1": mail.get("street1", ""),
                    "city":    mail.get("city", ""),
                    "state":   mail.get("stateOrCountry", ""),
                    "zip":     mail.get("zipCode", ""),
                }
                live["tickers"] = sub.get("tickers", [])
                live["exchanges"] = sub.get("exchanges", [])
                live["description"] = sub.get("description", "")
                live["investor_website"] = sub.get("investorWebsite", "")

                # Recent filings (last 10 of any type)
                filings = sub.get("filings", {}).get("recent", {})
                acc_nos   = filings.get("accessionNumber", [])[:10]
                forms     = filings.get("form", [])[:10]
                dates     = filings.get("filingDate", [])[:10]
                live["recent_filings"] = [
                    {"accession": a, "form": f, "date": d}
                    for a, f, d in zip(acc_nos, forms, dates)
                ]
        except Exception as exc:
            logger.warning("Could not fetch submission for CIK %s: %s", cik, exc)

        # ── Employee count (from company facts) ───────────────────────────────
        try:
            r = await client.get(
                f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik_padded}.json",
                headers=HEADERS,
            )
            if r.status_code == 200:
                facts = r.json()
                emp_data = (
                    facts.get("facts", {})
                         .get("dei", {})
                         .get("EntityNumberOfEmployees", {})
                         .get("units", {})
                         .get("pure", [])
                )
                if emp_data:
                    # Get the most recent reported value
                    latest = max(emp_data, key=lambda x: x.get("end", ""))
                    live["employee_count"] = latest.get("val")
                    live["employee_count_as_of"] = latest.get("end")
        except Exception as exc:
            logger.warning("Could not fetch facts for CIK %s: %s", cik, exc)

    live["edgar_url"] = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik_padded}&type=10-K&dateb=&owner=include&count=10"

    return {**company, **live}


# ── Ingest ─────────────────────────────────────────────────────────────────────

@app.post("/api/ingest/start")
async def start_ingest(
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Re-fetch companies already in DB"),
):
    """Kick off a background ingest from SEC EDGAR. Safe to call while running (ignored)."""
    if ingest.get_progress()["status"] == "running":
        return {"message": "Ingest already running", "progress": ingest.get_progress()}

    background_tasks.add_task(ingest.run_ingest, force=force)
    return {"message": "Ingest started", "force": force}


@app.get("/api/ingest/status")
async def ingest_status():
    """Current ingest progress."""
    progress = ingest.get_progress()
    # Also pull the last persisted job in case the server was restarted
    db_job = await database.get_latest_ingest_job()
    return {"progress": progress, "last_job": db_job}
