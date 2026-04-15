// SEC EDGAR is publicly accessible from the browser with CORS enabled.
const SEC_HEADERS = { "User-Agent": "SEC Explorer contact@secexplorer.local" }

export async function fetchCompanyDetail(cik) {
  const padded = String(cik).padStart(10, "0")

  const [subRes, factsRes] = await Promise.allSettled([
    fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: SEC_HEADERS }),
    fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, { headers: SEC_HEADERS }),
  ])

  const detail = {}

  if (subRes.status === "fulfilled" && subRes.value.ok) {
    const sub = await subRes.value.json()
    const biz  = sub.addresses?.business  ?? {}
    const mail = sub.addresses?.mailing   ?? {}

    detail.business_address = {
      street1: biz.street1  ?? "",
      street2: biz.street2  ?? "",
      city:    biz.city     ?? "",
      state:   biz.stateOrCountry ?? "",
      zip:     biz.zipCode  ?? "",
    }
    detail.mailing_address = {
      street1: mail.street1 ?? "",
      city:    mail.city    ?? "",
      state:   mail.stateOrCountry ?? "",
      zip:     mail.zipCode ?? "",
    }
    detail.tickers          = sub.tickers          ?? []
    detail.exchanges        = sub.exchanges         ?? []
    detail.description      = sub.description       ?? ""
    detail.investor_website = sub.investorWebsite   ?? ""

    const recent  = sub.filings?.recent ?? {}
    const accNos  = recent.accessionNumber ?? []
    const forms   = recent.form           ?? []
    const dates   = recent.filingDate     ?? []
    detail.recent_filings = accNos.slice(0, 10).map((a, i) => ({
      accession: a, form: forms[i], date: dates[i],
    }))
  }

  if (factsRes.status === "fulfilled" && factsRes.value.ok) {
    const facts = await factsRes.value.json()
    const empData = facts.facts?.dei?.EntityNumberOfEmployees?.units?.pure ?? []
    if (empData.length > 0) {
      const latest = empData.reduce((a, b) => (a.end ?? "") > (b.end ?? "") ? a : b)
      detail.employee_count       = latest.val
      detail.employee_count_as_of = latest.end
    }
  }

  detail.edgar_url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padded}&type=10-K&dateb=&owner=include&count=10`
  return detail
}
