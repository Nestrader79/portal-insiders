"use strict";
// Analizar empresa (Escáner + Expectativas) y Comparador. Usa utilidades de app.js ($, esc, dinero, pct, num, tabla, D).
const E = { indice: {}, tasa: 0.09, bono: null, bonoFecha: "", precioFecha: "", cache: {} };

// ---------- matemática del DCF ----------
function vpDcf(fcf0, g, r, n = 10, gt = 0.025) {
  let vp = 0, f = fcf0;
  for (let t = 1; t <= n; t++) { f *= 1 + g; vp += f / Math.pow(1 + r, t); }
  return vp + (f * (1 + gt)) / (r - gt) / Math.pow(1 + r, n);
}
function biseccion(fn, lo, hi) { // fn creciente; busca fn(x)=0
  if (fn(lo) > 0 || fn(hi) < 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (fn(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const gImplicito = (ev, fcf0, r, n, gt) => (fcf0 > 0 && ev > 0 && r > gt ? biseccion((g) => vpDcf(fcf0, g, r, n, gt) - ev, -0.5, 1) : null);
const retornoEsperado = (ev, fcf0, g, n, gt) => (fcf0 > 0 && ev > 0 ? biseccion((r) => ev - vpDcf(fcf0, g, r, n, gt), gt + 0.002, 1) : null);
function cagr(s, n) { const v = s.filter((x) => x != null); if (v.length <= n) return null; const a = v[v.length - 1 - n], b = v[v.length - 1]; return a > 0 && b > 0 ? Math.pow(b / a, 1 / n) - 1 : null; }

// ---------- gráficos simples ----------
function barras(valores, etiquetas, { alto = 120, color = "var(--azul)" } = {}) {
  const v = valores.map((x) => (x == null ? 0 : x)), w = 34 * v.length + 10, max = Math.max(...v, 0), min = Math.min(...v, 0), rango = max - min || 1;
  const y0 = 8 + ((max) / rango) * (alto - 26);
  const bs = v.map((x, i) => {
    const h = (Math.abs(x) / rango) * (alto - 26), y = x >= 0 ? y0 - h : y0;
    return `<rect x="${8 + i * 34}" y="${y}" width="24" height="${Math.max(h, 1)}" rx="3" fill="${x < 0 ? "var(--rojo)" : color}"><title>${etiquetas[i]}: ${dinero(valores[i])}</title></rect>
      <text x="${20 + i * 34}" y="${alto - 2}" font-size="10" text-anchor="middle" fill="var(--suave)">${etiquetas[i]}</text>`;
  }).join("");
  return `<svg width="${w}" height="${alto}" class="graf"><line x1="4" x2="${w}" y1="${y0}" y2="${y0}" stroke="var(--linea)"/>${bs}</svg>`;
}
function lineas(series, etiquetas, alto = 120) {
  const todos = series.flatMap((s) => s.v.filter((x) => x != null));
  if (!todos.length) return "";
  const w = 34 * etiquetas.length + 10, max = Math.max(...todos, 0), min = Math.min(...todos, 0), rango = max - min || 1;
  const Y = (x) => 8 + ((max - x) / rango) * (alto - 26);
  const ls = series.map((s) => {
    const pts = s.v.map((x, i) => (x == null ? null : `${20 + i * 34},${Y(x)}`)).filter(Boolean).join(" ");
    return `<polyline fill="none" stroke="${s.c}" stroke-width="2" points="${pts}"/>` +
      s.v.map((x, i) => (x == null ? "" : `<circle cx="${20 + i * 34}" cy="${Y(x)}" r="2.5" fill="${s.c}"><title>${s.n} ${etiquetas[i]}: ${pct(x)}</title></circle>`)).join("");
  }).join("");
  const ej = etiquetas.map((e, i) => `<text x="${20 + i * 34}" y="${alto - 2}" font-size="10" text-anchor="middle" fill="var(--suave)">${e}</text>`).join("");
  const cero = min < 0 ? `<line x1="4" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--linea)"/>` : "";
  const ley = series.map((s) => `<span style="color:${s.c}">● ${s.n}</span>`).join(" &nbsp; ");
  return `<svg width="${w}" height="${alto}" class="graf">${cero}${ls}${ej}</svg><div class="cuenta">${ley}</div>`;
}

// ---------- carga ----------
async function cargarIndice() {
  const j = await cargar("empresas.json", {});
  E.indice = j.empresas || {}; E.tasa = j.tasa || 0.09; E.precioFecha = j.precio_fecha || ""; E.bono = j.bono10; E.bonoFecha = j.bono10_fecha || "";
  const dl = document.getElementById("lista-empresas");
  dl.innerHTML = Object.entries(E.indice).sort().map(([t, x]) => `<option value="${esc(t)}">${esc(x.n || "")}</option>`).join("");
}
async function ficha(tk) {
  tk = tk.toUpperCase();
  if (!E.cache[tk]) {
    const f = await cargar(`emp/${tk}.json`, null), x = E.indice[tk] || {};
    // la ficha trae el negocio; el precio y la valoración vienen del índice diario
    E.cache[tk] = f && { ...f, precio: x.p ?? null, mcap: x.mcap ?? null, precio_fecha: E.precioFecha,
      m: { ...(f.m || {}), pe: x.pe, pfcf: x.pfcf, fcfy: x.fcfy, ev_ebit: x.ev_ebit, ev: x.ev, g_impl: x.g_impl } };
  }
  return E.cache[tk];
}
function fcfSerie(f) { return (f.a.ocf || []).map((o, i) => (o == null ? null : o - ((f.a.capex || [])[i] || 0))); }
function fcfBase(f, modo) {
  const t = f.ttm || {}, fcf = t.ocf != null ? t.ocf - (t.capex || 0) : null;
  if (modo === "sbc") return fcf != null ? fcf - (t.sbc || 0) : null;
  if (modo === "prom3") { const s = fcfSerie(f).filter((x) => x != null).slice(-3); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; }
  return fcf;
}

// ---------- notas de analistas (MarketScreener u otra fuente) guardadas en el navegador ----------
function leerNotas(tk) { try { return JSON.parse(localStorage.getItem("analistas:" + tk) || "{}"); } catch { return {}; } }
function guardarNotas(tk, o) { try { localStorage.setItem("analistas:" + tk, JSON.stringify(o)); } catch {} }

// ---------- pestaña Analizar ----------
async function analizar(tk) {
  tk = (tk || "").trim().toUpperCase();
  const res = $("#ana-res");
  if (!tk) { res.innerHTML = ""; return; }
  activar("analizar"); $("#ana-tk").value = tk;
  res.innerHTML = `<div class="vacio">Cargando ${esc(tk)}…</div>`;
  const f = await ficha(tk);
  if (!f) { res.innerHTML = `<div class="vacio">No hay ficha para <b>${esc(tk)}</b>. El análisis cubre el S&P 500 y las acciones que aparecen en el radar; se agregan solas en la siguiente actualización si entran al radar.</div>`; return; }
  const m = f.m || {}, t = f.ttm || {}, b = f.bal || {};
  const años = (f.fy || []).map((x) => "’" + x.slice(2, 4));
  const finanzas = /financ|bank|insur|real estate/i.test((f.sector || "") + " " + (f.ind || ""));
  const avisos = [];
  if (f.sin_datos) avisos.push("Esta empresa no reporta en formato US-GAAP a la SEC (suele ser una empresa extranjera que reporta con IFRS). No hay estados financieros detallados.");
  if (finanzas) avisos.push("Empresa financiera (banco, aseguradora o inmobiliaria): el flujo de caja libre y los márgenes no se interpretan igual que en otras empresas. Usa el DCF con mucha cautela; para bancos se usan más el P/E y el precio sobre valor en libros.");
  const notaFecha = `Datos financieros hasta ${esc(f.ttm_fin || "—")} (últimos 12 meses) · precio del ${esc(f.precio_fecha || "—")}`;
  const ir = `https://www.google.com/search?q=${encodeURIComponent("marketscreener " + tk + " consenso analistas")}`;
  res.innerHTML = `
  <div class="panel cab">
    <div><div class="ana-nombre">${esc(f.n || tk)} <span class="tk-grande">${esc(tk)}</span></div>
      <div class="ayuda">${esc(f.sector || "")}${f.ind ? " · " + esc(f.ind) : ""} · ${notaFecha}</div></div>
    <div class="cab-d"><div class="precio">${f.precio ? "$" + f.precio.toFixed(2) : "—"}</div><div class="ayuda">Capitalización ${dinero(f.mcap)}</div>
      <div class="enlaces"><a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}" target="_blank" rel="noopener">SEC ↗</a>
      <a href="${ir}" target="_blank" rel="noopener">MarketScreener ↗</a>
      <a href="https://www.tradingview.com/symbols/${esc(tk.replace(".", "-"))}/" target="_blank" rel="noopener">TradingView ↗</a>
      <a href="#" data-buscar="${esc(tk)}">Radar ↗</a></div></div>
  </div>
  ${avisos.map((a) => `<div class="demo">${a}</div>`).join("")}
  ${f.sin_datos ? "" : `
  <div class="panel"><h2>1 · ¿Qué negocio estoy mirando?</h2>
    <p class="ayuda">De dónde sale el valor: cuánto vende, cuánto le queda, cuánto rinde el capital y cómo trata al accionista.</p>
    <div class="kpis">${[
      ["Ventas (12 meses)", dinero(t.rev), `crec. 5 años ${pct(m.c_rev5)} anual`],
      ["Margen bruto", pct(m.mb), "lo que queda tras el costo directo"],
      ["Margen operativo", pct(m.mo), "rentabilidad del negocio principal"],
      ["Margen neto", pct(m.mn), `utilidad ${dinero(t.ni)}`],
      ["Margen de flujo libre", pct(m.mfcf), `flujo libre ${dinero(m.fcf)}`],
      ["ROIC", pct(m.roic), "retorno sobre el capital invertido"],
      ["ROE", pct(m.roe), "retorno sobre el patrimonio"],
      ["Deuda neta / flujo libre", m.dn_fcf == null ? "—" : m.dn_fcf.toFixed(1) + " años", `deuda ${dinero(b.deuda)} · caja ${dinero(b.cash)}`],
      ["Acciones en circulación", m.dil == null ? "—" : (m.dil > 0 ? "+" : "") + pct(m.dil) + " /año", m.dil == null ? "" : m.dil > 0.01 ? "diluye al accionista" : m.dil < -0.005 ? "recompra acciones" : "estable"],
      ["Retorno al accionista", pct(f.mcap ? ((t.div || 0) + (t.rec || 0)) / f.mcap : null), `dividendos ${dinero(t.div)} · recompras ${dinero(t.rec)}`],
    ].map(([a, v, d]) => `<div class="kpi"><div class="t">${a}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("")}</div>
    <div class="graficos">
      <div><h3>Ventas</h3>${barras(f.a.rev || [], años)}</div>
      <div><h3>Utilidad neta</h3>${barras(f.a.ni || [], años, { color: "var(--verde)" })}</div>
      <div><h3>Flujo de caja libre</h3>${barras(fcfSerie(f), años, { color: "var(--ambar)" })}</div>
      <div><h3>Márgenes</h3>${lineas([
        { n: "Bruto", c: "var(--azul)", v: (f.a.rev || []).map((r, i) => (r && f.a.gp?.[i] != null ? f.a.gp[i] / r : null)) },
        { n: "Operativo", c: "var(--verde)", v: (f.a.rev || []).map((r, i) => (r && f.a.oi?.[i] != null ? f.a.oi[i] / r : null)) },
        { n: "Flujo libre", c: "var(--ambar)", v: (f.a.rev || []).map((r, i) => { const x = fcfSerie(f)[i]; return r && x != null ? x / r : null; }) },
      ], años)}</div>
    </div>
  </div>
  <div class="panel" id="ana-exp"></div>`}
  <div class="panel"><h2>Actividad en el radar</h2><div id="ana-radar"></div></div>`;
  res.querySelectorAll("[data-buscar]").forEach((a) => a.onclick = (e) => { e.preventDefault(); irTicker(a.dataset.buscar); });
  radarResumen(tk);
  if (!f.sin_datos) expectativas(f);
}

function expectativas(f) {
  const tk = f.tk, cont = $("#ana-exp"), b = f.bal || {}, m = f.m || {};
  const notas = leerNotas(tk);
  const hist = [
    ["Flujo libre, últimos 5 años", m.c_fcf5], ["Ventas, últimos 5 años", m.c_rev5],
    ["Ventas, últimos 10 años", m.c_rev10], ["Utilidad por acción, 5 años", m.c_eps5],
  ].filter(([, v]) => v != null);
  const gHistDef = m.c_fcf5 ?? m.c_rev5 ?? 0.05;
  cont.innerHTML = `<h2>2 · ¿Qué futuro exige este precio?</h2>
    <p class="ayuda">DCF inverso: buscamos el crecimiento anual del flujo de caja libre que hace que el precio actual sea "justo". Luego lo comparas con lo que la empresa ha logrado y con lo que esperan los analistas.</p>
    <div class="filtros controles">
      <label>Flujo base <select id="x-base"><option value="ttm">Flujo libre 12 meses</option><option value="sbc">Flujo libre − pagos en acciones</option><option value="prom3">Promedio 3 años</option></select></label>
      <label>Tasa de descuento <input id="x-r" type="number" step="0.5" value="${(E.tasa * 100).toFixed(1)}">%</label>
      <label>Años <input id="x-n" type="number" step="1" value="10" min="3" max="20"></label>
      <label>Crec. perpetuo <input id="x-gt" type="number" step="0.5" value="2.5">%</label>
    </div>
    <div id="x-res"></div>
    <div class="dos" style="margin-top:14px">
      <div class="sub-panel"><h3>Tu escenario</h3>
        <p class="ayuda">Si crees que el flujo libre crecerá <b id="x-gv"></b> al año durante los próximos años:</p>
        <input id="x-g" type="range" min="-10" max="40" step="0.5" value="${(gHistDef * 100).toFixed(1)}" style="width:100%">
        <div id="x-esc" class="kpis kpis3"></div>
      </div>
      <div class="sub-panel"><h3>Lo que esperan los analistas</h3>
        <p class="ayuda">Anótalo desde MarketScreener u otra fuente. Se guarda en este navegador.</p>
        <div class="form-an">
          <label>Precio objetivo promedio <input id="n-obj" type="number" step="0.01" value="${notas.obj ?? ""}"></label>
          <label>Recomendación <input id="n-rec" type="text" placeholder="ej. COMPRAR (50 analistas)" value="${esc(notas.rec ?? "")}"></label>
          <label>BPA estimado próximo año <input id="n-e1" type="number" step="0.01" value="${notas.e1 ?? ""}"></label>
          <label>BPA estimado en 2 años <input id="n-e2" type="number" step="0.01" value="${notas.e2 ?? ""}"></label>
          <label>Crecimiento esperado (si lo publican) <input id="n-g" type="number" step="0.5" value="${notas.g ?? ""}">%</label>
        </div>
        <div id="n-res" class="cuenta"></div>
      </div>
    </div>`;
  const calc = () => {
    const r = +$("#x-r").value / 100, n = +$("#x-n").value, gt = +$("#x-gt").value / 100;
    const fcf0 = fcfBase(f, $("#x-base").value), ev = f.mcap ? f.mcap + (b.deuda || 0) - (b.cash || 0) : null;
    const gi = gImplicito(ev, fcf0, r, n, gt);
    const nt = leerNotas(tk);
    const epsTtm = f.ttm?.eps;
    let gAn = nt.g !== undefined && nt.g !== "" ? +nt.g / 100 : null;
    if (gAn == null && nt.e2 && epsTtm > 0) gAn = Math.pow(+nt.e2 / epsTtm, 1 / 2) - 1;
    else if (gAn == null && nt.e1 && epsTtm > 0) gAn = +nt.e1 / epsTtm - 1;
    const filas = [["El precio exige", gi, "exige"], ...hist.map(([a, v]) => [a, v, "hist"]), ...(gAn != null ? [["Analistas (utilidad por acción)", gAn, "an"]] : [])];
    const maxv = Math.min(0.6, Math.max(0.05, ...filas.map(([, v]) => Math.abs(v ?? 0))));
    let veredicto = "";
    if (gi == null) veredicto = fcf0 == null || fcf0 <= 0 ? "El flujo de caja libre base es negativo o no está disponible, así que el DCF inverso no aplica. Prueba con el promedio de 3 años o analiza la empresa por múltiplos (P/E, EV/EBIT) en el Comparador." : "";
    else {
      const ref = m.c_fcf5 ?? m.c_rev5;
      if (ref != null) veredicto = gi > ref + 0.03 ? `El precio pide <b>más</b> crecimiento del que la empresa ha logrado (${pct(gi)} frente a ${pct(ref)}). El mercado ya descuenta un futuro mejor que el pasado.`
        : gi < ref - 0.03 ? `El precio pide <b>menos</b> crecimiento del que la empresa ha logrado (${pct(gi)} frente a ${pct(ref)}). Si el negocio mantiene su ritmo, podría haber margen a favor.`
        : `El precio pide un crecimiento <b>parecido</b> al que la empresa ha logrado (${pct(gi)} frente a ${pct(ref)}).`;
    }
    $("#x-res").innerHTML = `<div class="grande-exige">${gi == null ? "—" : pct(gi)} <span>de crecimiento anual del flujo libre durante ${n} años es lo que exige el precio de $${f.precio?.toFixed(2) ?? "—"}</span></div>
      <div class="comp-g">${filas.map(([a, v, c]) => `<div class="fila-g"><span>${a}</span><div class="barra-g"><div class="b-${c}" style="width:${v == null ? 0 : Math.min(100, Math.max(2, (Math.abs(v) / maxv) * 100))}%"></div></div><b>${pct(v)}</b></div>`).join("")}</div>
      <p class="ayuda">${veredicto} Flujo base ${dinero(fcf0)} · valor empresa ${dinero(ev)} (capitalización + deuda − caja).</p>`;
    const g = +$("#x-g").value / 100;
    $("#x-gv").textContent = pct(g);
    const vEmp = fcf0 > 0 ? vpDcf(fcf0, g, r, n, gt) : null;
    const vAcc = vEmp != null && f.acc ? (vEmp - (b.deuda || 0) + (b.cash || 0)) / f.acc : null;
    const margen = vAcc && f.precio ? vAcc / f.precio - 1 : null;
    const ret = retornoEsperado(ev, fcf0, g, n, gt);
    $("#x-esc").innerHTML = [
      ["Valor intrínseco por acción", vAcc == null ? "—" : "$" + vAcc.toFixed(2), `a una tasa del ${pct(r)}`],
      ["Margen de seguridad", margen == null ? "—" : `<span class="${margen >= 0 ? "compra" : "venta"}">${margen >= 0 ? "+" : ""}${pct(margen)}</span>`, margen == null ? "" : margen >= 0 ? "precio por debajo del valor" : "precio por encima del valor"],
      ["Retorno anual esperado", ret == null ? "—" : `<span class="${E.bono != null && ret > E.bono ? "compra" : "venta"}">${pct(ret)}</span>`, E.bono != null ? `bono EE. UU. 10 años: ${pct(E.bono)}` : ""],
    ].map(([a, v, d]) => `<div class="kpi"><div class="t">${a}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");
    const pot = nt.obj && f.precio ? +nt.obj / f.precio - 1 : null;
    $("#n-res").innerHTML = [pot != null ? `Potencial al precio objetivo: <b class="${pot >= 0 ? "compra" : "venta"}">${pot >= 0 ? "+" : ""}${pct(pot)}</b>` : "",
      gAn != null ? `Crecimiento esperado de la utilidad por acción: <b>${pct(gAn)}</b> anual${epsTtm ? ` (BPA actual ${epsTtm.toFixed(2)})` : ""}` : "",
      nt.rec ? `Recomendación: <b>${esc(nt.rec)}</b>` : ""].filter(Boolean).join(" · ") || "Sin datos de analistas anotados.";
  };
  cont.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", () => {
    if (el.id.startsWith("n-")) guardarNotas(tk, { obj: $("#n-obj").value, rec: $("#n-rec").value, e1: $("#n-e1").value, e2: $("#n-e2").value, g: $("#n-g").value });
    calc();
  }));
  calc();
}

function radarResumen(tk) {
  const l90 = hace(90), c = D.compras.filter((f) => f.tk === tk && f.fr >= l90), v = D.ventas.filter((f) => f.tk === tk);
  const con = D.congreso.filter((f) => f.tk === tk), rt = D.rtat.filter((r) => r.tk === tk), rd = D.retail.find((r) => r.tk === tk);
  const sum = (a) => a.reduce((s, f) => s + f.val, 0);
  const s = D.cortos.datos[tk];
  $("#ana-radar").innerHTML = `<div class="kpis">
    <div class="kpi"><div class="t">Compras de insiders (90 d)</div><div class="v compra">${dinero(sum(c))}</div><div class="d">${c.length} reportes · ${new Set(c.map((f) => f.ins)).size} personas</div></div>
    <div class="kpi"><div class="t">Ventas de insiders (60 d)</div><div class="v venta">${dinero(sum(v))}</div><div class="d">${v.length} reportes · ${v.filter((f) => f.plan).length} con plan 10b5-1</div></div>
    <div class="kpi"><div class="t">Congreso</div><div class="v">${con.length}</div><div class="d">${con.filter((f) => f.tipo === "Compra").length} compras · ${con.filter((f) => (f.tipo || "").startsWith("Venta")).length} ventas</div></div>
    <div class="kpi"><div class="t">Minoristas</div><div class="v">${rt.length ? (rt[0].sen > 0 ? "+" : "") + rt[0].sen : rd ? "#" + rd.rank : "—"}</div><div class="d">${rt.length ? "sentimiento Nasdaq" : rd ? "ranking en Reddit" : "sin actividad destacada"}</div></div>
    <div class="kpi"><div class="t">% en corto</div><div class="v">${s ? pct(s[s.length - 1]?.[0]) : "—"}</div><div class="d">${s ? spark(s.map((x) => (x ? x[0] : null))) : ""}</div></div>
  </div>`;
}

// ---------- Comparador ----------
let compTks = [];
try { compTks = JSON.parse(localStorage.getItem("comparar") || "[]"); } catch {}
async function comparar() {
  try { localStorage.setItem("comparar", JSON.stringify(compTks)); } catch {}
  $("#cmp-chips").innerHTML = compTks.map((t) => `<span class="chip a">${esc(t)} <a href="#" data-q="${esc(t)}">✕</a></span>`).join("");
  $("#cmp-chips").querySelectorAll("[data-q]").forEach((a) => a.onclick = (e) => { e.preventDefault(); compTks = compTks.filter((x) => x !== a.dataset.q); comparar(); });
  const fs = (await Promise.all(compTks.map(ficha))).filter(Boolean);
  if (!fs.length) { $("#cmp-tabla").innerHTML = `<div class="vacio">Agrega de 2 a 5 empresas para compararlas, por ejemplo V, MA y PYPL.</div>`; return; }
  const filas = [
    ["Precio", (f) => f.precio, (x) => (x ? "$" + x.toFixed(2) : "—"), null],
    ["Capitalización", (f) => f.mcap, dinero, null],
    ["Sector", (f) => f.sector, (x) => esc(x || "—"), null],
    ["Crecimiento ventas 5 años", (f) => f.m?.c_rev5, (x) => pct(x), 1],
    ["Crecimiento flujo libre 5 años", (f) => f.m?.c_fcf5, (x) => pct(x), 1],
    ["Margen bruto", (f) => f.m?.mb, (x) => pct(x), 1],
    ["Margen operativo", (f) => f.m?.mo, (x) => pct(x), 1],
    ["Margen de flujo libre", (f) => f.m?.mfcf, (x) => pct(x), 1],
    ["ROIC", (f) => f.m?.roic, (x) => pct(x), 1],
    ["Deuda neta / flujo libre (años)", (f) => f.m?.dn_fcf, (x) => (x == null ? "—" : x.toFixed(1)), -1],
    ["Cambio anual de acciones", (f) => f.m?.dil, (x) => pct(x), -1],
    ["P/E (precio / utilidad)", (f) => f.m?.pe, (x) => (x == null ? "—" : x.toFixed(1)), -1],
    ["Precio / flujo libre", (f) => f.m?.pfcf, (x) => (x == null ? "—" : x.toFixed(1)), -1],
    ["EV / EBIT", (f) => f.m?.ev_ebit, (x) => (x == null ? "—" : x.toFixed(1)), -1],
    ["Rendimiento del flujo libre", (f) => f.m?.fcfy, (x) => pct(x), 1],
    ["Crecimiento que exige el precio", (f) => f.m?.g_impl, (x) => pct(x), -1],
  ];
  const cab = `<th></th>${fs.map((f) => `<th class="num"><span class="tk" data-tk="${esc(f.tk)}">${esc(f.tk)}</span><div class="ayuda" style="margin:0;font-weight:400">${esc((f.n || "").slice(0, 26))}</div></th>`).join("")}<th class="num">Bono EE. UU. 10a</th>`;
  const cuerpo = filas.map(([n, get, fmt, mejor]) => {
    const vals = fs.map(get), nums = vals.filter((x) => typeof x === "number");
    const best = mejor && nums.length > 1 && new Set(nums.map((x) => x.toFixed(4))).size > 1 ? (mejor > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
    const bono = n === "Rendimiento del flujo libre" ? pct(E.bono) : n === "Crecimiento que exige el precio" ? "" : "";
    return `<tr><td>${n}</td>${vals.map((v) => `<td class="num ${best != null && v === best ? "mejor" : ""}">${fmt(v)}</td>`).join("")}<td class="num ayuda">${bono}</td></tr>`;
  }).join("");
  $("#cmp-tabla").innerHTML = `<div class="envoltura"><table class="cmp"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table></div>
    <p class="ayuda">En verde, la mejor de cada fila. El crecimiento exigido usa tasa ${pct(E.tasa)}, 10 años y 2.5% perpetuo. Si el rendimiento del flujo libre es menor que el bono, estás aceptando menos flujo hoy a cambio de crecimiento futuro.</p>
    <div class="filtros">${fs.map((f) => `<button class="mas" data-ana="${esc(f.tk)}" style="margin:0">Analizar ${esc(f.tk)} →</button>`).join("")}</div>`;
  $("#cmp-tabla").querySelectorAll("[data-ana]").forEach((b) => b.onclick = () => analizar(b.dataset.ana));
}

// ---------- eventos ----------
$("#ana-tk").addEventListener("change", (e) => analizar(e.target.value));
$("#ana-tk").addEventListener("keydown", (e) => { if (e.key === "Enter") analizar(e.target.value); });
const agregarComp = () => { const t = $("#cmp-tk").value.trim().toUpperCase(); if (t && !compTks.includes(t) && compTks.length < 5) compTks.push(t); $("#cmp-tk").value = ""; comparar(); };
$("#cmp-add").onclick = agregarComp;
$("#cmp-tk").addEventListener("keydown", (e) => { if (e.key === "Enter") agregarComp(); });
document.querySelectorAll('nav button[data-tab="comparar"]').forEach((b) => b.addEventListener("click", comparar));
cargarIndice().then(() => { const m = location.hash.match(/a=([A-Z0-9.\-]+)/i); if (m) analizar(m[1]); });
