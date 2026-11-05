"""Fichas de empresa: estados financieros (SEC XBRL), precio y capitalización (Nasdaq), bono a 10 años (FRED).

Genera:
- docs/data/emp/<TICKER>.json  ficha completa por empresa (se carga al abrirla)
- docs/data/empresas.json      índice con nombre, sector y métricas clave de todas las empresas
"""
import csv
import io
import json
import math
import os
from datetime import date, datetime, timedelta

from comun import DATOS, Cliente, ahora_iso, guardar, leer, log

CARPETA = DATOS / "emp"
REFRESCO_DIAS = 7        # cada cuántos días se vuelven a bajar los estados financieros
MAX_SEC_POR_CORRIDA = 900
SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
NASDAQ_SCREENER = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true"
FRED_10Y = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"

FLUJOS = {  # conceptos de periodo (se suman en el año)
    "rev": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
            "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet",
            "RevenuesNetOfInterestExpense"],
    "gp": ["GrossProfit"],
    "cogs": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
    "oi": ["OperatingIncomeLoss"],
    "ni": ["NetIncomeLoss", "ProfitLoss"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities",
            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "sbc": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    "div": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "rec": ["PaymentsForRepurchaseOfCommonStock"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "shw": ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"],
}
SALDOS = {  # conceptos de saldo (a una fecha)
    "cash": ["CashAndCashEquivalentsAtCarryingValue",
             "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
    "sti": ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
    "ltd": ["LongTermDebt"],
    "ltdn": ["LongTermDebtNoncurrent"],
    "ltdc": ["LongTermDebtCurrent"],
    "std": ["ShortTermBorrowings", "CommercialPaper"],
    "eq": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "assets": ["Assets"],
}
ANUAL = ("10-K", "10-K/A", "10-KT", "10-KT/A")


def norm(tk):
    return (tk or "").strip().upper().replace("/", ".").replace("-", ".")


def _d(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def _unidades(hecho):
    u = hecho.get("units", {})
    return u.get("USD") or u.get("USD/shares") or u.get("shares") or []


def serie_anual(gaap, nombres):
    """{fecha_fin_año: valor} combinando varios conceptos (las empresas cambian de etiqueta con los años)."""
    out = {}
    for nombre in nombres:
        h = gaap.get(nombre)
        if not h:
            continue
        mejor = {}
        for it in _unidades(h):
            if it.get("form") not in ANUAL or not it.get("start"):
                continue
            dur = (_d(it["end"]) - _d(it["start"])).days
            if not 340 <= dur <= 390:
                continue
            prev = mejor.get(it["end"])
            if prev is None or it.get("filed", "") > prev.get("filed", ""):
                mejor[it["end"]] = it
        for fin, it in mejor.items():
            out.setdefault(fin, it["val"])
    return out


def ttm(gaap, nombres, anual):
    """Últimos 12 meses = último año fiscal + acumulado del año en curso - mismo acumulado del año anterior."""
    if not anual:
        return None, None
    fin_fy = max(anual)
    base = anual[fin_fy]
    e = _d(fin_fy)
    for nombre in nombres:
        h = gaap.get(nombre)
        if not h:
            continue
        items = [it for it in _unidades(h) if it.get("start") and it.get("form", "").startswith("10-Q")]
        ytd = [it for it in items if it["end"] > fin_fy and abs((_d(it["start"]) - e).days - 1) <= 10]
        if not ytd:
            continue
        actual = max(ytd, key=lambda it: (it["end"], it.get("filed", "")))
        q_fin = _d(actual["end"])
        inicio_prev = e - timedelta(days=365)
        previo = [it for it in items
                  if abs((_d(it["start"]) - inicio_prev).days - 1) <= 12
                  and abs((_d(it["end"]) - (q_fin - timedelta(days=365))).days) <= 12]
        if not previo:
            continue
        p = max(previo, key=lambda it: it.get("filed", ""))
        return base + actual["val"] - p["val"], actual["end"]
    return base, fin_fy


def saldo(gaap, nombres):
    for nombre in nombres:
        h = gaap.get(nombre)
        if not h:
            continue
        items = [it for it in _unidades(h) if it.get("form", "")[:4] in ("10-K", "10-Q")]
        if items:
            it = max(items, key=lambda it: (it["end"], it.get("filed", "")))
            return it["val"], it["end"]
    return None, None


def acciones_en_circulacion(facts):
    dei = facts.get("facts", {}).get("dei", {}).get("EntityCommonStockSharesOutstanding")
    if not dei:
        return None
    items = dei.get("units", {}).get("shares", [])
    if not items:
        return None
    ult = max(it.get("filed", "") for it in items)
    del_ultimo = [it for it in items if it.get("filed", "") == ult]
    fin = max(it["end"] for it in del_ultimo)
    return sum(it["val"] for it in del_ultimo if it["end"] == fin)  # suma clases (ej. GOOGL + GOOG)


def extraer(facts):
    gaap = facts.get("facts", {}).get("us-gaap", {})
    if not gaap:
        return None  # empresas extranjeras (IFRS / 20-F) no tienen us-gaap
    anual = {k: serie_anual(gaap, v) for k, v in FLUJOS.items()}
    if not anual["gp"] and anual["rev"] and anual["cogs"]:
        anual["gp"] = {f: anual["rev"][f] - anual["cogs"][f] for f in anual["rev"] if f in anual["cogs"]}
    fines = sorted(set(anual["rev"]) | set(anual["ni"]) | set(anual["ocf"]))[-11:]
    a = {k: [anual[k].get(f) for f in fines] for k in FLUJOS if k != "cogs"}
    t, t_fin = {}, None
    for k in ("rev", "gp", "oi", "ni", "ocf", "capex", "sbc", "div", "rec", "eps"):
        v, fin = ttm(gaap, FLUJOS[k], anual[k])
        t[k] = v
        if k == "rev" and fin:
            t_fin = fin
    if t.get("gp") is None and t.get("rev") is not None:
        cogs, _ = ttm(gaap, FLUJOS["cogs"], anual["cogs"])
        if cogs is not None:
            t["gp"] = t["rev"] - cogs
    s = {k: saldo(gaap, v)[0] for k, v in SALDOS.items()}
    deuda = max(s["ltd"] or 0, (s["ltdn"] or 0) + (s["ltdc"] or 0)) + (s["std"] or 0)
    acc = acciones_en_circulacion(facts) or (a["shw"][-1] if a["shw"] and a["shw"][-1] else None)
    return {
        "fy": fines, "a": a, "ttm": t, "ttm_fin": t_fin,
        "bal": {"cash": (s["cash"] or 0) + (s["sti"] or 0), "deuda": deuda, "eq": s["eq"], "assets": s["assets"],
                "fecha": saldo(gaap, SALDOS["assets"])[1]},
        "acc": acc,
    }


# ---------- métricas ----------
def cagr(serie, años):
    v = [x for x in serie if x is not None]
    if len(v) <= años or v[-1 - años] is None or v[-1 - años] <= 0 or v[-1] <= 0:
        return None
    return (v[-1] / v[-1 - años]) ** (1 / años) - 1


def vp_dcf(fcf0, g, r, n=10, gt=0.025):
    vp, f = 0.0, fcf0
    for t in range(1, n + 1):
        f *= 1 + g
        vp += f / (1 + r) ** t
    return vp + f * (1 + gt) / (r - gt) / (1 + r) ** n


def crecimiento_implicito(ev, fcf0, r, n=10, gt=0.025):
    """Crecimiento anual de FCF que justifica el valor empresa actual (DCF inverso)."""
    if not ev or not fcf0 or fcf0 <= 0 or ev <= 0 or r <= gt:
        return None
    lo, hi = -0.5, 1.0
    if vp_dcf(fcf0, hi, r, n, gt) < ev:
        return hi
    if vp_dcf(fcf0, lo, r, n, gt) > ev:
        return lo
    for _ in range(80):
        m = (lo + hi) / 2
        if vp_dcf(fcf0, m, r, n, gt) < ev:
            lo = m
        else:
            hi = m
    return round((lo + hi) / 2, 4)


BASE = ("mb", "mo", "mn", "mfcf", "roe", "roic", "c_rev5", "c_rev10", "c_fcf5", "c_eps5", "dil", "dn_fcf", "fcf")
VAL = ("pe", "pfcf", "fcfy", "ev_ebit", "ev", "g_impl")


def metricas(f, r):
    t, b = f.get("ttm", {}), f.get("bal", {})
    rev, ni, oi, gp = t.get("rev"), t.get("ni"), t.get("oi"), t.get("gp")
    fcf = (t.get("ocf") or 0) - (t.get("capex") or 0) if t.get("ocf") is not None else None
    mcap = f.get("mcap")
    ev = mcap + (b.get("deuda") or 0) - (b.get("cash") or 0) if mcap else None
    cap_inv = (b.get("eq") or 0) + (b.get("deuda") or 0) - (b.get("cash") or 0)
    div = lambda x, y: round(x / y, 4) if x is not None and y not in (None, 0) else None
    acc_serie = f.get("a", {}).get("shw", [])
    fcf_a = [(o - (c or 0)) if o is not None else None for o, c in zip(f["a"].get("ocf", []), f["a"].get("capex", []))]
    return {
        "mb": div(gp, rev), "mo": div(oi, rev), "mn": div(ni, rev), "mfcf": div(fcf, rev),
        "roe": div(ni, b.get("eq")) if (b.get("eq") or 0) > 0 else None,
        "roic": div(oi * 0.79, cap_inv) if oi is not None and cap_inv > 0 else None,
        "c_rev5": cagr(f["a"].get("rev", []), 5), "c_rev10": cagr(f["a"].get("rev", []), 10),
        "c_fcf5": cagr(fcf_a, 5), "c_eps5": cagr(f["a"].get("eps", []), 5),
        "dil": cagr(acc_serie, 3) if acc_serie else None,
        "pe": div(mcap, ni) if ni and ni > 0 else None,
        "pfcf": div(mcap, fcf) if fcf and fcf > 0 else None,
        "fcfy": div(fcf, mcap) if mcap else None,
        "ev_ebit": div(ev, oi) if oi and oi > 0 else None,
        "dn_fcf": div((b.get("deuda") or 0) - (b.get("cash") or 0), fcf) if fcf and fcf > 0 else None,
        "fcf": fcf, "ev": ev,
        "g_impl": crecimiento_implicito(ev, fcf, r),
    }


# ---------- fuentes ----------
def universo(cli_web, extra):
    tks = set()
    try:
        r = cli_web.get(SP500_CSV)
        r.raise_for_status()
        for fila in csv.DictReader(io.StringIO(r.text)):
            tks.add(norm(fila.get("Symbol")))
        log(f"  S&P 500: {len(tks)} empresas")
    except Exception as e:
        log(f"  (no se pudo leer la lista del S&P 500: {e})")
    return {t for t in tks | {norm(x) for x in extra} if t}


def tickers_radar():
    out = set()
    lim = (date.today() - timedelta(days=60)).isoformat()
    for f in leer("insiders_compras.json", {}).get("filas", []):
        if f.get("fr", "") >= lim and not f.get("dudoso"):
            out.add(f["tk"])
    for f in leer("congreso.json", {}).get("filas", []):
        if f.get("tk"):
            out.add(f["tk"])
    for f in leer("rtat.json", {}).get("filas", []):
        out.add(f["tk"])
    for f in leer("retail.json", {}).get("filas", [])[:100]:
        out.add(f["tk"])
    return out


def precios_nasdaq(cli_web):
    r = cli_web.get(NASDAQ_SCREENER, headers={"Accept": "application/json, text/plain, */*",
                                              "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"},
                    timeout=90)
    r.raise_for_status()
    filas = (r.json().get("data") or {}).get("rows") or []
    out = {}
    num = lambda s: float(str(s).replace("$", "").replace(",", "")) if s not in (None, "", "NA") else None
    for x in filas:
        try:
            out[norm(x["symbol"])] = {"p": num(x.get("lastsale")), "mcap": num(x.get("marketCap")),
                                      "sector": x.get("sector") or "", "ind": x.get("industry") or "",
                                      "n": x.get("name") or ""}
        except (ValueError, KeyError):
            continue
    log(f"  Nasdaq: precios de {len(out)} acciones")
    return out


def bono_10y(cli_web):
    """Rendimiento del bono del Tesoro a 10 años: Tesoro de EE. UU. y, si falla, FRED."""
    año = date.today().year
    for y in (año, año - 1):
        try:
            url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
                   f"{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv")
            r = cli_web.get(url, reintentos=1, timeout=30)
            filas = list(csv.DictReader(io.StringIO(r.text)))
            if filas and filas[0].get("10 Yr"):
                f = filas[0]  # la primera fila es la más reciente
                m, d, yy = f["Date"].split("/")
                return float(f["10 Yr"]) / 100, f"{yy}-{m}-{d}"
        except Exception as e:
            log(f"  (Tesoro no disponible: {e})")
    try:
        r = cli_web.get(FRED_10Y, reintentos=1, timeout=20)
        filas = [l.split(",") for l in r.text.strip().splitlines()[1:]]
        filas = [f for f in filas if len(f) == 2 and f[1] not in (".", "")]
        return float(filas[-1][1]) / 100, filas[-1][0]
    except Exception as e:
        log(f"  (FRED no disponible: {e})")
    previo = leer("empresas.json", {}) or {}
    return previo.get("bono10"), previo.get("bono10_fecha")  # se conserva el último valor conocido


def ejecutar(dias=3):
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if "@" not in ua:
        raise RuntimeError("Falta el secreto SEC_USER_AGENT")
    sec = Cliente(ua, por_segundo=8)
    web = Cliente("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/130.0 Safari/537.36", por_segundo=2)
    CARPETA.mkdir(parents=True, exist_ok=True)

    r = sec.get("https://www.sec.gov/files/company_tickers.json")
    r.raise_for_status()
    ciks = {norm(v["ticker"]): (int(v["cik_str"]), v["title"]) for v in r.json().values()}
    try:
        precios = precios_nasdaq(web)
    except Exception as e:
        log(f"  (precios de Nasdaq no disponibles: {e})")
        precios = {}
    t10, t10_fecha = bono_10y(web)
    tasa = max(0.08, (t10 or 0.042) + 0.045)  # tasa de descuento por defecto: bono + 4.5% de prima

    tks = sorted(t for t in universo(web, tickers_radar()) if t in ciks)
    hoy = date.today()
    fichas = {}
    vencidas = []
    for tk in tks:
        f = leer(f"emp/{tk}.json")
        fichas[tk] = f
        if not f or f.get("act", "") < (hoy - timedelta(days=REFRESCO_DIAS)).isoformat():
            vencidas.append(tk)
    vencidas.sort(key=lambda t: (fichas[t] is not None, (fichas[t] or {}).get("act", "")))
    log(f"  universo {len(tks)} empresas; {len(vencidas)} con estados financieros por actualizar")

    bajadas = errores = 0
    for n, tk in enumerate(vencidas[:MAX_SEC_POR_CORRIDA], 1):
        cik, titulo = ciks[tk]
        try:
            rr = sec.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", timeout=60)
            if rr.status_code != 200:
                errores += 1
                continue
            datos = extraer(rr.json())
        except Exception as e:
            errores += 1
            log(f"  {tk}: {e}")
            continue
        bajadas += 1
        base = {"tk": tk, "n": titulo, "cik": cik, "act": hoy.isoformat()}
        fichas[tk] = {**base, **datos} if datos else {**base, "sin_datos": True}
        if n % 100 == 0:
            log(f"  estados financieros {n}/{min(len(vencidas), MAX_SEC_POR_CORRIDA)}")

    indice = {}
    actualizadas = set(t for t in vencidas[:MAX_SEC_POR_CORRIDA])
    for tk in tks:
        f = fichas.get(tk)
        if not f:
            continue
        p = precios.get(tk, {})
        sector_nuevo = p.get("sector") and (f.get("sector"), f.get("ind")) != (p["sector"], p["ind"])
        if sector_nuevo:
            f["sector"], f["ind"] = p["sector"], p["ind"]
        if not f.get("sin_datos"):
            m = metricas(f, tasa)  # métricas del negocio (no dependen del precio)
            f["m"] = {k: m.get(k) for k in BASE}
        # la ficha solo se reescribe cuando cambian sus datos (así el repositorio no crece cada día)
        if tk in actualizadas or sector_nuevo:
            for k in ("precio", "precio_fecha", "mcap"):
                f.pop(k, None)
            (CARPETA / f"{tk}.json").write_text(json.dumps(f, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        precio = p.get("p")
        mcap = precio * f["acc"] if precio and f.get("acc") else p.get("mcap")
        val = {}
        if not f.get("sin_datos") and mcap:
            mm = metricas({**f, "mcap": mcap}, tasa)
            val = {k: mm.get(k) for k in VAL}
        indice[tk] = {"n": f.get("n"), "s": f.get("sector", ""), "p": precio, "mcap": mcap,
                      **{k: (f.get("m") or {}).get(k) for k in ("mo", "mfcf", "roic", "c_rev5")}, **val,
                      "sd": bool(f.get("sin_datos"))}
    guardar("empresas.json", {"actualizado": ahora_iso(), "precio_fecha": hoy.isoformat(), "bono10": t10, "bono10_fecha": t10_fecha,
                              "tasa": tasa, "empresas": indice})
    msg = f"{len(indice)} empresas; {bajadas} estados financieros actualizados ({errores} errores); bono 10 años {t10}"
    log("  " + msg)
    return {"filas": len(indice), "msg": msg}
