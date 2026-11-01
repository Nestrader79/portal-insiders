"""Volumen de ventas en corto diario de FINRA (Reg SHO, archivo consolidado CNMS). Uso no comercial."""
from datetime import date, timedelta

from comun import Cliente, ahora_iso, guardar, log

DIAS = 10            # días hábiles guardados
VOLUMEN_MIN = 200_000  # se ignoran acciones con poco volumen reportado


def ejecutar(dias=3):
    cli = Cliente("Mozilla/5.0 (compatible; PortalInsiders/1.0)", por_segundo=2)
    archivos = []
    d = date.today()
    intentos = 0
    while len(archivos) < DIAS and intentos < DIAS * 2 + 6:
        intentos += 1
        if d.weekday() < 5:
            r = cli.get(f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d:%Y%m%d}.txt")
            if r.status_code == 200 and "|" in r.text[:200]:
                archivos.append((d.isoformat(), r.text))
        d -= timedelta(days=1)
    if not archivos:
        raise RuntimeError("No se encontró ningún archivo de FINRA")
    archivos.reverse()  # del más antiguo al más reciente
    fechas = [f for f, _ in archivos]
    datos = {}
    for i, (_, txt) in enumerate(archivos):
        for linea in txt.splitlines()[1:]:
            p = linea.split("|")
            if len(p) < 5 or not p[1]:
                continue
            try:
                corto, total = float(p[2]), float(p[4])
            except ValueError:
                continue
            serie = datos.setdefault(p[1], [None] * len(archivos))
            serie[i] = [round(corto / total, 3) if total else None, int(total)]
    # se conservan las acciones cuyo último volumen supera el mínimo
    filtrado = {}
    for tk, serie in datos.items():
        ult = serie[-1]
        if ult and ult[1] >= VOLUMEN_MIN:
            filtrado[tk] = serie
    guardar("cortos.json", {"actualizado": ahora_iso(), "fechas": fechas, "datos": filtrado})
    return {"filas": len(filtrado), "msg": f"{len(filtrado)} acciones, último día {fechas[-1]}"}
