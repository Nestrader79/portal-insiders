"""Compras (código P) y ventas (código S) de insiders desde los Form 4 de SEC EDGAR."""
import os
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

from comun import Cliente, ahora_iso, guardar, leer, log

RETENCION_COMPRAS = 180  # días que se conservan las compras
RETENCION_VENTAS = 60    # días que se conservan las ventas (son muchas más)
MAX_FILINGS = 6000       # tope por ejecución para no exceder el tiempo de GitHub


def url_indice(d):
    q = (d.month - 1) // 3 + 1
    return f"https://www.sec.gov/Archives/edgar/daily-index/{d.year}/QTR{q}/form.{d:%Y%m%d}.idx"


def listar_form4(cli, d):
    """Devuelve {accession: (ruta_txt, fecha_iso, es_enmienda)} del índice diario."""
    r = cli.get(url_indice(d))
    if r.status_code != 200:
        return None  # fin de semana, feriado o aún no publicado
    out = {}
    empezar = False
    for linea in r.text.splitlines():
        if linea.startswith("----"):
            empezar = True
            continue
        if not empezar:
            continue
        partes = linea.split()
        if len(partes) < 5 or partes[0] not in ("4", "4/A"):
            continue
        ruta, fecha = partes[-1], partes[-2]
        if len(fecha) == 8:
            fecha = f"{fecha[:4]}-{fecha[4:6]}-{fecha[6:]}"
        acc = ruta.rsplit("/", 1)[-1].replace(".txt", "")
        out[acc] = (ruta, fecha, partes[0] == "4/A")
    return out


def _t(el, ruta):
    e = el.find(ruta)
    return e.text.strip() if e is not None and e.text else ""


def _v(el, ruta):
    return _t(el, ruta + "/value") or _t(el, ruta)


def _num(s):
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return 0.0


def _si(s):
    return s.strip().lower() in ("1", "true")


def parsear_form4(texto):
    """Extrae del texto del filing las filas agregadas por código (P/S)."""
    m = re.search(r"<ownershipDocument[\s>].*?</ownershipDocument>", texto, re.S)
    if not m:
        return []
    doc = ET.fromstring(m.group(0))
    ticker = _t(doc, "issuer/issuerTradingSymbol").upper()
    empresa = _t(doc, "issuer/issuerName")
    nombres, cargos = [], []
    for ro in doc.findall("reportingOwner"):
        nombres.append(_t(ro, "reportingOwnerId/rptOwnerName"))
        rel = ro.find("reportingOwnerRelationship")
        if rel is None:
            continue
        if _si(_t(rel, "isOfficer")):
            cargos.append(_t(rel, "officerTitle") or "Officer")
        if _si(_t(rel, "isDirector")):
            cargos.append("Director")
        if _si(_t(rel, "isTenPercentOwner")):
            cargos.append("Dueño 10%")
        if _si(_t(rel, "isOther")):
            cargos.append(_t(rel, "otherText") or "Otro")
    cargo = ", ".join(dict.fromkeys(c for c in cargos if c))
    plan = _si(_t(doc, "aff10b5One"))

    agg = {}
    for tr in doc.findall("nonDerivativeTable/nonDerivativeTransaction"):
        cod = _t(tr, "transactionCoding/transactionCode")
        if cod not in ("P", "S"):
            continue
        acc = _num(_v(tr, "transactionAmounts/transactionShares"))
        pre = _num(_v(tr, "transactionAmounts/transactionPricePerShare"))
        f = _v(tr, "transactionDate")[:10]
        post = _num(_v(tr, "postTransactionAmounts/sharesOwnedFollowingTransaction"))
        a = agg.setdefault(cod, {"acc": 0.0, "val": 0.0, "ft": f, "post": 0.0})
        a["acc"] += acc
        a["val"] += acc * pre
        a["ft"] = min(a["ft"], f) if a["ft"] and f else (a["ft"] or f)
        a["post"] = post
    filas = []
    for cod, a in agg.items():
        filas.append({
            "cod": cod, "tk": ticker, "emp": empresa,
            "ins": " / ".join(n for n in nombres if n), "cargo": cargo,
            "ft": a["ft"], "acc": round(a["acc"]), "pre": round(a["val"] / a["acc"], 4) if a["acc"] else 0,
            "val": round(a["val"]), "post": round(a["post"]), "plan": plan,
        })
    return filas


def url_filing(ruta, acc):
    carpeta = ruta.rsplit("/", 1)[0]
    return f"https://www.sec.gov/Archives/{carpeta}/{acc.replace('-', '')}/{acc}-index.htm"


def ejecutar(dias=3):
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if "@" not in ua:
        raise RuntimeError("Falta el secreto SEC_USER_AGENT (ej.: 'MiPortal tu@email.com'). La SEC lo exige.")
    cli = Cliente(ua, por_segundo=8)

    compras = leer("insiders_compras.json", {}).get("filas", [])
    ventas = leer("insiders_ventas.json", {}).get("filas", [])
    vistos = leer("_insiders_vistos.json", {})
    if not isinstance(vistos, dict):
        vistos = {}

    hoy = date.today()
    pendientes = {}
    indices_ok = 0
    for i in range(dias, -1, -1):
        d = hoy - timedelta(days=i)
        if d.weekday() >= 5:
            continue
        lista = listar_form4(cli, d)
        if lista is None:
            log(f"  índice {d} no disponible (fin de semana/feriado o aún no publicado)")
            continue
        indices_ok += 1
        nuevos = {k: v for k, v in lista.items() if k not in vistos}
        log(f"  índice {d}: {len(lista)} Form 4, {len(nuevos)} nuevos")
        pendientes.update(nuevos)
    if indices_ok == 0 and dias >= 3:
        raise RuntimeError("No se pudo leer ningún índice de la SEC. Revisa SEC_USER_AGENT.")

    pend = list(pendientes.items())[:MAX_FILINGS]
    nuevos_c = nuevos_v = errores = 0
    for n, (acc, (ruta, fr, enm)) in enumerate(pend, 1):
        if n % 200 == 0:
            log(f"  procesados {n}/{len(pend)}")
        try:
            r = cli.get("https://www.sec.gov/Archives/" + ruta)
            if r.status_code != 200:
                errores += 1
                continue
            filas = parsear_form4(r.text)
        except Exception:
            errores += 1
            continue
        vistos[acc] = fr
        for f in filas:
            f.update({"id": acc, "fr": fr, "enm": enm, "url": url_filing(ruta, acc)})
            if f["cod"] == "P":
                compras.append(f); nuevos_c += 1
            else:
                ventas.append(f); nuevos_v += 1

    # solo acciones que cotizan en bolsa: se descartan fondos/REIT no listados (ticker "NONE", "N/A", vacío…)
    validos = set()
    try:
        r = cli.get("https://www.sec.gov/files/company_tickers.json")
        validos = {v["ticker"].upper().replace("-", ".") for v in r.json().values()}
        log(f"  {len(validos)} tickers listados en la SEC")
    except Exception as e:
        log(f"  (no se pudo cargar la lista de tickers: {e})")

    def cotiza(tk):
        tk = (tk or "").upper().replace("-", ".")
        if validos:
            return tk in validos
        return bool(re.fullmatch(r"[A-Z]{1,5}(\.[A-Z])?", tk)) and tk not in ("NONE", "NA", "N/A")

    def recortar(filas, dias_ret):
        lim = (hoy - timedelta(days=dias_ret)).isoformat()
        unicos = {}
        for f in filas:
            if f.get("fr", "") >= lim and cotiza(f.get("tk")):
                unicos[(f["id"], f["cod"])] = f
        return sorted(unicos.values(), key=lambda f: (f["fr"], f["val"]), reverse=True)

    compras = recortar(compras, RETENCION_COMPRAS)
    ventas = recortar(ventas, RETENCION_VENTAS)
    # recordar filings ya leídos (con fecha) para no descargarlos otra vez; se olvidan a los 30 días
    lim = (hoy - timedelta(days=30)).isoformat()
    vistos = {k: v for k, v in vistos.items() if v >= lim}

    guardar("insiders_compras.json", {"actualizado": ahora_iso(), "filas": compras})
    guardar("insiders_ventas.json", {"actualizado": ahora_iso(), "filas": ventas})
    guardar("_insiders_vistos.json", vistos)
    msg = f"{nuevos_c} compras y {nuevos_v} ventas nuevas ({len(pend)} filings leídos, {errores} errores)"
    log("  " + msg)
    return {"filas": len(compras) + len(ventas), "msg": msg}
