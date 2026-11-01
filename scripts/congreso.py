"""Operaciones de congresistas de EE. UU. (STOCK Act).

- Cámara de Representantes: fuente oficial (House Clerk). Se descarga el índice anual y se leen los PDF de los PTR.
- Senado: API gratuita de Bargo (https://www.bargo.ai/free-apis/congress), basada en el eFD oficial.
"""
import hashlib
import io
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

from comun import Cliente, ahora_iso, guardar, leer, log

RETENCION = 120          # días de historial (por fecha de reporte)
DIAS_NUEVOS_CAMARA = 60  # solo se leen PTR presentados en los últimos N días
MAX_PDFS = 300           # tope de PDFs por ejecución
UA_WEB = "Mozilla/5.0 (compatible; PortalInsiders/1.0; uso personal)"
BARGO = "https://www.bargo.ai/free-apis/congress/v1/trades"

TIPOS = {"P": "Compra", "S": "Venta", "S (partial)": "Venta parcial", "E": "Canje"}

PATRON = re.compile(
    r"\(([A-Z][A-Z0-9.\-/]{0,9})\)\s*\[([A-Z]{2})\]\s*"
    r"(P|S\s*\(partial\)|S|E)\s+"
    r"(\d{2}/\d{2}/\d{4})\s*(\d{2}/\d{2}/\d{4})\s*"
    r"(Over\s+\$[\d,]+|\$[\d,]+\s*-\s*\$[\d,]+|\$[\d,]+)"
)
# marcas que separan una operación de la siguiente en el texto del PDF
CORTE = re.compile(r"(?:\$200\?|F\s?S\s?:\s?(?:New|Partial|Amendment)?|S\s?O\s?:|D\s?:|C\s?:|L\s?:)")


def _fecha(s):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip()[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def _montos(txt):
    nums = [int(n.replace(",", "")) for n in re.findall(r"\$([\d,]+)", txt or "")]
    if not nums:
        return None, None
    if "over" in (txt or "").lower() or len(nums) == 1:
        return nums[0], None
    return nums[0], nums[-1]


def _id(*partes):
    return hashlib.md5("|".join(str(p) for p in partes).encode()).hexdigest()[:12]


def _dias(ft, fr):
    try:
        return (date.fromisoformat(fr) - date.fromisoformat(ft)).days
    except ValueError:
        return None


def cargar_partidos(cli):
    """{(estado, apellido_minúsculas, 'rep'|'sen'): 'D'|'R'|'I'} desde unitedstates/congress-legislators."""
    try:
        r = cli.get("https://unitedstates.github.io/congress-legislators/legislators-current.json")
        out = {}
        for p in r.json():
            t = p["terms"][-1]
            par = {"Democrat": "D", "Republican": "R"}.get(t.get("party"), "I")
            out[(t["state"], p["name"]["last"].lower(), t["type"])] = par
        return out
    except Exception as e:
        log(f"  (no se pudo cargar partidos: {e})")
        return {}


def parsear_ptr(texto):
    """Extrae operaciones del texto de un PTR electrónico de la Cámara."""
    plano = " ".join(texto.replace("\x00", "").split())
    filas, ultimo = [], 0
    for m in PATRON.finditer(plano):
        previo = plano[ultimo:m.start()]
        previo = CORTE.split(previo)[-1]
        previo = re.sub(r"^\s*(SP|JT|DC)\s+", "", previo).strip(" :-")
        tk, clase, tipo, ft, fn, monto = m.groups()
        tipo = re.sub(r"\s+", " ", tipo)
        filas.append({
            "tk": tk.replace("/", "."), "clase": clase, "act": previo[-70:].strip(),
            "tipo": TIPOS.get(tipo, tipo), "ft": _fecha(ft), "monto": re.sub(r"\s+", " ", monto),
        })
        ultimo = m.end()
    return filas


def camara(cli, partidos, existentes, vistos):
    import pdfplumber

    hoy = date.today()
    lim = hoy - timedelta(days=DIAS_NUEVOS_CAMARA)
    años = sorted({hoy.year, lim.year})
    nuevas, leidos = [], 0
    for y in años:
        r = cli.get(f"https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{y}FD.zip", timeout=120)
        r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        nombre_xml = next(n for n in z.namelist() if n.lower().endswith(".xml"))
        raiz = ET.fromstring(z.read(nombre_xml))
        for mem in raiz.findall("Member"):
            g = lambda k: (mem.findtext(k) or "").strip()
            if g("FilingType") != "P":
                continue
            fr = _fecha(g("FilingDate"))
            doc = g("DocID")
            if not fr or fr < lim.isoformat() or doc in vistos:
                continue
            if leidos >= MAX_PDFS:
                break
            nombre = " ".join(x for x in (g("First"), g("Last"), g("Suffix")) if x)
            est = g("StateDst")[:2]
            par = partidos.get((est, g("Last").lower(), "rep"), "")
            url = f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{y}/{doc}.pdf"
            base = {"cam": "Cámara", "mem": nombre, "est": g("StateDst"), "par": par,
                    "fr": fr, "url": url, "fuente": "House Clerk"}
            try:
                pr = cli.get(url, timeout=60)
                leidos += 1
                if pr.status_code != 200:
                    continue
                with pdfplumber.open(io.BytesIO(pr.content)) as pdf:
                    texto = "\n".join((p.extract_text() or "") for p in pdf.pages)
            except Exception as e:
                log(f"  PDF {doc}: {e}")
                continue
            vistos[doc] = fr
            ops = parsear_ptr(texto) if texto.strip() else []
            if not ops:
                # PDF escaneado o sin acciones con ticker: se deja el enlace para revisarlo a mano
                nuevas.append({**base, "id": _id(doc), "tk": "", "act": "Ver PDF (escaneado o sin ticker)",
                               "tipo": "", "ft": "", "monto": "", "mmin": None, "mmax": None, "dias": None})
                continue
            for i, op in enumerate(ops):
                mmin, mmax = _montos(op["monto"])
                nuevas.append({**base, **op, "id": _id(doc, i), "mmin": mmin, "mmax": mmax,
                               "dias": _dias(op["ft"], fr)})
    log(f"  Cámara: {leidos} PDF leídos, {len(nuevas)} operaciones nuevas")
    return nuevas


def _tipo_bargo(t):
    t = (t or "").lower()
    if "partial" in t:
        return "Venta parcial"
    if t.startswith(("buy", "purchase", "p")):
        return "Compra"
    if t.startswith(("sell", "sale", "s")):
        return "Venta"
    if "exchange" in t:
        return "Canje"
    return t.capitalize()


def bargo(cli, camara_api, partidos):
    key = os.environ.get("BARGO_API_KEY", "").strip()
    headers = {"X-Api-Key": key} if key else {}
    r = cli.get(BARGO, params={"chamber": camara_api, "limit": 250 if key else 100}, headers=headers)
    r.raise_for_status()
    datos = r.json()
    trades = datos.get("trades") or datos.get("data") or datos.get("results") or []
    filas = []
    for t in trades:
        def g(*ks):
            for k in ks:
                v = t.get(k)
                if isinstance(v, dict):
                    v = v.get("name") or v.get("full_name")
                if v not in (None, ""):
                    return v
            return ""
        mem = g("member", "member_name", "name", "politician")
        tk = str(g("ticker", "symbol")).upper()
        ft = _fecha(str(g("transaction_date", "traded_at", "trade_date")))
        fr = _fecha(str(g("disclosure_date", "disclosed_date", "filed_date", "disclosed_at", "filing_date")))
        monto = str(g("amount_range", "amount", "value_range", "range"))
        tipo = _tipo_bargo(str(g("type", "transaction_type")))
        est = str(g("state", "state_district", "district"))
        par = str(g("party"))[:1].upper()
        if not par and est:
            apellido = mem.split(",")[0].split()[-1].lower() if mem else ""
            par = partidos.get((est[:2], apellido, "sen"), "")
        mmin, mmax = _montos(monto)
        filas.append({
            "id": _id("bargo", mem, tk, ft, tipo, monto), "cam": "Senado" if camara_api == "senate" else "Cámara",
            "mem": mem, "est": est, "par": par, "tk": tk, "act": str(g("asset_description", "asset", "description", "company"))[:70],
            "clase": "", "tipo": tipo, "ft": ft, "fr": fr or ft, "monto": monto, "mmin": mmin, "mmax": mmax,
            "dias": _dias(ft, fr) if ft and fr else None,
            "url": str(g("source_url", "filing_url", "url", "portal_url", "official_url")) or "https://efdsearch.senate.gov/",
            "fuente": "Bargo",
        })
    log(f"  Bargo ({camara_api}): {len(filas)} operaciones recibidas")
    return filas


def ejecutar(dias=3):
    cli = Cliente(UA_WEB, por_segundo=2)
    partidos = cargar_partidos(cli)
    filas = leer("congreso.json", {}).get("filas", [])
    vistos = leer("_congreso_vistos.json", {})
    msgs, errores = [], []

    try:
        nuevas = camara(cli, partidos, filas, vistos)
        filas += nuevas
        msgs.append(f"Cámara: {len(nuevas)} nuevas")
    except Exception as e:
        errores.append(f"Cámara (oficial) falló: {e}")
        try:
            nuevas = bargo(cli, "house", partidos)
            filas += nuevas
            msgs.append(f"Cámara vía Bargo: {len(nuevas)}")
        except Exception as e2:
            errores.append(f"Cámara vía Bargo falló: {e2}")

    try:
        nuevas = bargo(cli, "senate", partidos)
        filas += nuevas
        msgs.append(f"Senado: {len(nuevas)} recibidas")
    except Exception as e:
        errores.append(f"Senado (Bargo) falló: {e}")

    lim = (date.today() - timedelta(days=RETENCION)).isoformat()
    unicos = {f["id"]: f for f in filas if (f.get("fr") or "") >= lim}
    filas = sorted(unicos.values(), key=lambda f: (f.get("fr") or "", f.get("mmax") or f.get("mmin") or 0), reverse=True)
    vistos = {k: v for k, v in vistos.items() if v >= lim}

    guardar("congreso.json", {"actualizado": ahora_iso(), "filas": filas})
    guardar("_congreso_vistos.json", vistos)
    msg = "; ".join(msgs + errores)
    log("  " + msg)
    if not msgs:
        raise RuntimeError(msg)
    return {"filas": len(filas), "msg": msg, "aviso": "; ".join(errores)}
