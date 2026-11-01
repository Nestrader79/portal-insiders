"""Genera datos de EJEMPLO (inventados) para ver el portal antes de la primera actualización real."""
import random
from datetime import date, timedelta

from comun import ahora_iso, guardar

random.seed(7)
EMP = [("EJA", "Empresa Ejemplo A Inc"), ("EJB", "Ejemplo Biotech Corp"), ("EJC", "Compañía Demo C"),
       ("EJD", "Demo Energía D"), ("EJE", "Ejemplo Bancorp E"), ("EJF", "Ficticia Tech F"),
       ("EJG", "Grupo Muestra G"), ("EJH", "Holding Ejemplo H")]
PERS = ["Persona Ejemplo 1", "Persona Ejemplo 2", "Persona Ejemplo 3", "Persona Ejemplo 4", "Persona Ejemplo 5", "Persona Ejemplo 6"]
CARGOS = ["CEO", "CFO", "Director", "Dueño 10%", "COO, Director"]
hoy = date.today()


def d(n):
    return (hoy - timedelta(days=n)).isoformat()


def insider(cod, i):
    tk, emp = random.choice(EMP)
    acc = random.choice([500, 1200, 5000, 20000, 80000, 250000])
    pre = round(random.uniform(4, 180), 2)
    dia = random.randint(0, 50)
    return {"id": f"demo-{cod}-{i}", "cod": cod, "tk": tk, "emp": emp, "ins": random.choice(PERS), "cargo": random.choice(CARGOS),
            "ft": d(dia + 2), "fr": d(dia), "acc": acc, "pre": pre, "val": round(acc * pre), "post": acc * random.randint(2, 30),
            "plan": cod == "S" and random.random() < 0.5, "enm": False, "url": "https://www.sec.gov/edgar"}


compras = [insider("P", i) for i in range(40)]
ventas = [insider("S", i) for i in range(90)]
congreso = []
for i in range(35):
    tk, emp = random.choice(EMP)
    dia = random.randint(0, 80)
    lag = random.randint(5, 44)
    mmin, mmax = random.choice([(1001, 15000), (15001, 50000), (50001, 100000), (250001, 500000)])
    congreso.append({"id": f"demo-c{i}", "cam": random.choice(["Cámara", "Senado"]), "mem": f"Congresista Ejemplo {i % 9 + 1}",
                     "est": random.choice(["CA", "TX", "NY", "FL"]), "par": random.choice(["D", "R"]), "tk": tk, "act": emp,
                     "clase": "ST", "tipo": random.choice(["Compra", "Compra", "Venta", "Venta parcial"]), "ft": d(dia + lag), "fr": d(dia),
                     "monto": f"${mmin:,} - ${mmax:,}", "mmin": mmin, "mmax": mmax, "dias": lag, "url": "", "fuente": "demo"})
retail, hist = [], {}
for i, (tk, emp) in enumerate(EMP * 3):
    tk = tk if i < len(EMP) else f"{tk}{i // len(EMP)}"
    men = random.randint(20, 900)
    men24 = random.randint(10, 900)
    retail.append({"tk": tk, "nom": emp, "rank": i + 1, "rank24": random.randint(1, 30), "men": men, "men24": men24,
                   "up": men * random.randint(3, 20), "cambio": round((men - men24) / men24 * 100, 1)})
    hist[tk] = [[d(10 - k), max(1, men + random.randint(-200, 200))] for k in range(10)]
retail.sort(key=lambda r: -r["men"])
for i, r in enumerate(retail):
    r["rank"] = i + 1
fechas = [d(13 - k) for k in range(10)]
cortos = {tk: [[round(random.uniform(.25, .7), 3), random.randint(300_000, 30_000_000)] for _ in fechas] for tk, _ in EMP}

guardar("insiders_compras.json", {"actualizado": ahora_iso(), "filas": compras})
guardar("insiders_ventas.json", {"actualizado": ahora_iso(), "filas": ventas})
guardar("congreso.json", {"actualizado": ahora_iso(), "filas": congreso})
guardar("retail.json", {"actualizado": ahora_iso(), "fecha": hoy.isoformat(), "filas": retail})
guardar("retail_hist.json", hist)
guardar("cortos.json", {"actualizado": ahora_iso(), "fechas": fechas, "datos": cortos})
f = {"ok": True, "fecha": ahora_iso(), "msg": "datos de ejemplo"}
guardar("estado.json", {"actualizado": ahora_iso(), "demo": True, "fuentes": {k: f for k in ("insiders", "congreso", "retail", "cortos")}})
