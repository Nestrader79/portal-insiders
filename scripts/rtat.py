"""Compras/ventas reales de minoristas: Nasdaq Retail Trading Activity Tracker, versión gratuita Top 10 (NDAQ/RTAT10).

Requiere una clave gratuita de https://data.nasdaq.com guardada en el secreto NASDAQ_API_KEY.
- activity: fracción del dinero operado por minoristas ese día que fue a esa acción.
- sentiment: puntaje según el flujo neto (compras - ventas) de los últimos 10 días de mercado.
"""
import os
from datetime import date, timedelta

from comun import Cliente, ahora_iso, guardar, leer, log

URL = "https://data.nasdaq.com/api/v3/datatables/NDAQ/RTAT10"
DIAS_DESCARGA = 30
RETENCION = 180


def ejecutar(dias=3):
    key = os.environ.get("NASDAQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Falta el secreto NASDAQ_API_KEY (clave gratuita de data.nasdaq.com)")
    cli = Cliente("Mozilla/5.0 (compatible; PortalInsiders/1.0)", por_segundo=1)
    desde = (date.today() - timedelta(days=DIAS_DESCARGA)).isoformat()
    params = {"date.gte": desde, "api_key": key}
    filas_nuevas = []
    for _ in range(20):  # paginación por cursor
        r = cli.get(URL, params=params)
        if r.status_code in (401, 403):
            raise RuntimeError("Nasdaq rechazó la clave NASDAQ_API_KEY; revísala")
        r.raise_for_status()
        j = r.json()
        dt = j.get("datatable", {})
        cols = [c["name"] for c in dt.get("columns", [])]
        for fila in dt.get("data", []):
            x = dict(zip(cols, fila))
            if not x.get("ticker"):
                continue
            filas_nuevas.append({
                "f": str(x.get("date", ""))[:10],
                "tk": str(x["ticker"]).upper(),
                "act": round(float(x.get("activity") or 0), 5),
                "sen": float(x["sentiment"]) if x.get("sentiment") is not None else None,
            })
        cursor = (j.get("meta") or {}).get("next_cursor_id")
        if not cursor:
            break
        params["qopts.cursor_id"] = cursor

    previas = leer("rtat.json", {}).get("filas", [])
    lim = (date.today() - timedelta(days=RETENCION)).isoformat()
    unicas = {(f["f"], f["tk"]): f for f in previas + filas_nuevas if f["f"] >= lim}
    filas = sorted(unicas.values(), key=lambda f: (f["f"], f["act"]), reverse=True)
    if not filas:
        raise RuntimeError("Nasdaq no devolvió datos")
    ultimo = filas[0]["f"]
    guardar("rtat.json", {"actualizado": ahora_iso(), "ultimo": ultimo, "filas": filas})
    return {"filas": len(filas), "msg": f"Top 10 retail de Nasdaq, último día {ultimo}"}
