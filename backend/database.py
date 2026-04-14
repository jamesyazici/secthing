import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "sec_data.db")

CREATE_COMPANIES = """
CREATE TABLE IF NOT EXISTS companies (
    cik         TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    ticker      TEXT,
    exchange    TEXT,
    sic         TEXT,
    sic_description TEXT,
    state_of_incorporation TEXT,
    business_state TEXT,
    business_city  TEXT,
    category    TEXT,
    fiscal_year_end TEXT,
    phone       TEXT,
    website     TEXT,
    first_filing_year INTEGER,
    last_updated TEXT
);
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_sic   ON companies(sic);",
    "CREATE INDEX IF NOT EXISTS idx_bstate ON companies(business_state);",
    "CREATE INDEX IF NOT EXISTS idx_cat   ON companies(category);",
    "CREATE INDEX IF NOT EXISTS idx_year  ON companies(first_filing_year);",
    "CREATE INDEX IF NOT EXISTS idx_name  ON companies(name COLLATE NOCASE);",
]

CREATE_INGEST_JOBS = """
CREATE TABLE IF NOT EXISTS ingest_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT,
    completed_at TEXT,
    total        INTEGER DEFAULT 0,
    processed    INTEGER DEFAULT 0,
    failed       INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'pending'
);
"""


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(CREATE_COMPANIES)
        await db.execute(CREATE_INGEST_JOBS)
        for idx in CREATE_INDEXES:
            await db.execute(idx)
        await db.commit()


async def upsert_company(row: dict):
    sql = """
    INSERT INTO companies
        (cik, name, ticker, exchange, sic, sic_description,
         state_of_incorporation, business_state, business_city,
         category, fiscal_year_end, phone, website, first_filing_year, last_updated)
    VALUES
        (:cik, :name, :ticker, :exchange, :sic, :sic_description,
         :state_of_incorporation, :business_state, :business_city,
         :category, :fiscal_year_end, :phone, :website, :first_filing_year, :last_updated)
    ON CONFLICT(cik) DO UPDATE SET
        name=excluded.name, ticker=excluded.ticker, exchange=excluded.exchange,
        sic=excluded.sic, sic_description=excluded.sic_description,
        state_of_incorporation=excluded.state_of_incorporation,
        business_state=excluded.business_state, business_city=excluded.business_city,
        category=excluded.category, fiscal_year_end=excluded.fiscal_year_end,
        phone=excluded.phone, website=excluded.website,
        first_filing_year=excluded.first_filing_year, last_updated=excluded.last_updated;
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(sql, row)
        await db.commit()


async def bulk_upsert_companies(rows: list[dict]):
    sql = """
    INSERT INTO companies
        (cik, name, ticker, exchange, sic, sic_description,
         state_of_incorporation, business_state, business_city,
         category, fiscal_year_end, phone, website, first_filing_year, last_updated)
    VALUES
        (:cik, :name, :ticker, :exchange, :sic, :sic_description,
         :state_of_incorporation, :business_state, :business_city,
         :category, :fiscal_year_end, :phone, :website, :first_filing_year, :last_updated)
    ON CONFLICT(cik) DO UPDATE SET
        name=excluded.name, ticker=excluded.ticker, exchange=excluded.exchange,
        sic=excluded.sic, sic_description=excluded.sic_description,
        state_of_incorporation=excluded.state_of_incorporation,
        business_state=excluded.business_state, business_city=excluded.business_city,
        category=excluded.category, fiscal_year_end=excluded.fiscal_year_end,
        phone=excluded.phone, website=excluded.website,
        first_filing_year=excluded.first_filing_year, last_updated=excluded.last_updated;
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executemany(sql, rows)
        await db.commit()


async def get_existing_ciks() -> set[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT cik FROM companies") as cursor:
            rows = await cursor.fetchall()
    return {r[0] for r in rows}


async def query_companies(
    sic: str | None,
    state: str | None,
    category: str | None,
    year_from: int | None,
    year_to: int | None,
    search: str | None,
    sort_by: str,
    sort_dir: str,
    page: int,
    page_size: int,
) -> dict:
    allowed_sorts = {"name", "sic", "business_state", "business_city",
                     "category", "first_filing_year", "ticker"}
    sort_by = sort_by if sort_by in allowed_sorts else "name"
    sort_dir = "ASC" if sort_dir.lower() != "desc" else "DESC"

    conditions = []
    params: list = []

    if sic:
        conditions.append("sic = ?")
        params.append(sic)
    if state:
        conditions.append("business_state = ?")
        params.append(state)
    if category:
        conditions.append("category = ?")
        params.append(category)
    if year_from is not None:
        conditions.append("first_filing_year >= ?")
        params.append(year_from)
    if year_to is not None:
        conditions.append("first_filing_year <= ?")
        params.append(year_to)
    if search:
        conditions.append("name LIKE ?")
        params.append(f"%{search}%")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    count_sql = f"SELECT COUNT(*) FROM companies {where}"
    data_sql = f"""
        SELECT cik, name, ticker, exchange, sic, sic_description,
               business_state, business_city, category, first_filing_year
        FROM companies {where}
        ORDER BY {sort_by} {sort_dir}
        LIMIT ? OFFSET ?
    """

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(count_sql, params) as cur:
            total = (await cur.fetchone())[0]
        offset = (page - 1) * page_size
        async with db.execute(data_sql, params + [page_size, offset]) as cur:
            rows = [dict(r) for r in await cur.fetchall()]

    return {"total": total, "page": page, "page_size": page_size, "companies": rows}


async def get_company_by_cik(cik: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM companies WHERE cik = ?", [cik]) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_filter_options() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute(
            "SELECT DISTINCT business_state FROM companies WHERE business_state IS NOT NULL ORDER BY business_state"
        ) as cur:
            states = [r[0] for r in await cur.fetchall()]

        async with db.execute(
            "SELECT DISTINCT category FROM companies WHERE category IS NOT NULL AND category != '' ORDER BY category"
        ) as cur:
            categories = [r[0] for r in await cur.fetchall()]

        async with db.execute(
            "SELECT DISTINCT sic, sic_description FROM companies WHERE sic IS NOT NULL ORDER BY sic"
        ) as cur:
            sics = [{"code": r[0], "description": r[1]} for r in await cur.fetchall()]

        async with db.execute(
            "SELECT MIN(first_filing_year), MAX(first_filing_year) FROM companies WHERE first_filing_year IS NOT NULL"
        ) as cur:
            row = await cur.fetchone()
            year_range = {"min": row[0], "max": row[1]}

        async with db.execute("SELECT COUNT(*) FROM companies") as cur:
            total = (await cur.fetchone())[0]

    return {"states": states, "categories": categories, "sics": sics,
            "year_range": year_range, "total_companies": total}


async def create_ingest_job() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO ingest_jobs (started_at, status) VALUES (datetime('now'), 'running')"
        )
        await db.commit()
        return cur.lastrowid


async def update_ingest_job(job_id: int, processed: int, failed: int,
                             total: int, status: str):
    completed = "datetime('now')" if status in ("completed", "failed") else "NULL"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"""UPDATE ingest_jobs
                SET processed=?, failed=?, total=?, status=?,
                    completed_at=IIF(status IN ('completed','failed'), datetime('now'), NULL)
                WHERE id=?""",
            [processed, failed, total, status, job_id],
        )
        await db.commit()


async def get_latest_ingest_job() -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM ingest_jobs ORDER BY id DESC LIMIT 1"
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None
