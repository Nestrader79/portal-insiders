"""Interés retail: menciones de acciones en Reddit (r/wallstreetbets, r/stocks, etc.) vía ApeWisdom (gratis)."""
from datetime import date

from comun import Cliente, ahora_iso, guardar, leer, log

PAGINAS = 3          # 100 acciones por página
HISTORIAL = 60       # snapshots guardados por acción


def ejecutar(dias=3):
    cli = Cliente("Mozilla/5.0 (compatible; PortalInsiders/1.0)", por_segundo=1)
    filas = []
    for p in range(1, PAGINAS + 1):
        r = cli.get(f"https://apewisdom.io/api/v1.0/filter/all-stocks/page/{p}")
        r.raise_for_status()
        for x in r.json().get("results", []):
            men = int(x.get("mentions") or 0)
            men24 = int(x.get("mentions_24h_ago") or 0)
            filas.append({
                "tk": (x.get("ticker") or "").upper(), "nom": x.get("name") or "",
                "rank": int(x.get("rank") or 0), "rank24": int(x.get("rank_24h_ago") or 0) or None,
                "men": men, "men24": men24, "up": int(x.get("upvotes") or 0),
                "cambio": round((men - men24) / men24 * 100, 1) if men24 else None,
            })
    hoy = date.today().isoformat()
    hist = leer("retail_hist.json", {})
    for f in filas:
        serie = [s for s in hist.get(f["tk"], []) if s[0] != hoy]
        serie.append([hoy, f["men"]])
        hist[f["tk"]] = serie[-HISTORIAL:]
    guardar("retail.json", {"actualizado": ahora_iso(), "fecha": hoy, "filas": filas})
    guardar("retail_hist.json", hist)
    return {"filas": len(filas), "msg": f"{len(filas)} acciones con menciones en Reddit"}
