"""Utilidades compartidas: cliente HTTP con límite de velocidad y lectura/escritura de datos."""
import json
import os
import pathlib
import time
from datetime import datetime, timezone

import requests

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DATOS = RAIZ / "docs" / "data"
DATOS.mkdir(parents=True, exist_ok=True)


def log(msg):
    print(msg, flush=True)


def ahora_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Cliente:
    """requests.Session con pausa entre solicitudes y reintentos."""

    def __init__(self, user_agent, por_segundo=5.0):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"})
        self.pausa = 1.0 / por_segundo
        self._ultimo = 0.0

    def get(self, url, reintentos=3, **kw):
        kw.setdefault("timeout", 30)
        for intento in range(reintentos + 1):
            espera = self.pausa - (time.time() - self._ultimo)
            if espera > 0:
                time.sleep(espera)
            self._ultimo = time.time()
            try:
                r = self.s.get(url, **kw)
            except requests.RequestException as e:
                if intento == reintentos:
                    raise
                log(f"  reintento ({e.__class__.__name__}) {url}")
                time.sleep(2 * (intento + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504) and intento < reintentos:
                time.sleep(5 * (intento + 1))
                continue
            return r
        return r


def leer(nombre, defecto=None):
    p = DATOS / nombre
    if not p.exists():
        return defecto
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return defecto


def guardar(nombre, obj):
    p = DATOS / nombre
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"  guardado {nombre} ({p.stat().st_size/1024:.0f} KB)")
