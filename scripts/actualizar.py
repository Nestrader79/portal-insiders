"""Actualiza todas las fuentes. Uso:  python scripts/actualizar.py --dias 3 [--solo insiders,congreso]"""
import argparse
import sys
import traceback

import comun
from comun import ahora_iso, guardar, leer, log

import congreso
import cortos
import insiders
import retail

FUENTES = {
    "insiders": insiders.ejecutar,
    "congreso": congreso.ejecutar,
    "retail": retail.ejecutar,
    "cortos": cortos.ejecutar,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=3, help="días hacia atrás a revisar en la SEC")
    ap.add_argument("--solo", default="", help="lista separada por comas de fuentes a actualizar")
    a = ap.parse_args()

    estado = leer("estado.json", {}) or {}
    if estado.get("demo"):
        log("Borrando datos de ejemplo…")
        for p in comun.DATOS.glob("*.json"):
            p.unlink()
        estado = {}
    estado.setdefault("fuentes", {})

    elegidas = [s.strip() for s in a.solo.split(",") if s.strip()] or list(FUENTES)
    fallos = 0
    for nombre in elegidas:
        log(f"== {nombre} ==")
        try:
            res = FUENTES[nombre](a.dias)
            estado["fuentes"][nombre] = {"ok": True, "fecha": ahora_iso(), **res}
        except Exception as e:
            fallos += 1
            traceback.print_exc()
            previo = estado["fuentes"].get(nombre, {})
            estado["fuentes"][nombre] = {**previo, "ok": False, "error": str(e)[:300], "intento": ahora_iso()}
    estado["actualizado"] = ahora_iso()
    estado["demo"] = False
    guardar("estado.json", estado)
    log(f"Listo. Fuentes con error: {fallos}")
    # no se marca como fallo total si solo falla una fuente, para que igual se publique lo demás
    sys.exit(1 if fallos == len(elegidas) else 0)


if __name__ == "__main__":
    main()
