"use strict";
const D = { rtat: [], rtatUlt: "", compras: [], ventas: [], congreso: [], retail: [], retailHist: {}, cortos: { fechas: [], datos: {} }, estado: {} };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- formatos ----------
function dinero(v) {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + " mil M";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + " M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(0) + " mil";
  return "$" + v.toFixed(0);
}
const num = (v) => (v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString("es-CO"));
const pct = (v, d = 1) => (v == null || isNaN(v) ? "—" : (v * 100).toFixed(d) + "%");
const fecha = (s) => (s ? s.slice(0, 10) : "—");
const hace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); };
const tk = (t) => (t ? `<span class="tk" data-tk="${esc(t)}">${esc(t)}</span>` : "—");
function sinceDias(iso) { if (!iso) return ""; const h = (Date.now() - new Date(iso)) / 36e5; return h < 1 ? "hace minutos" : h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`; }

function spark(serie, w = 70, h = 20) {
  const v = serie.filter((x) => x != null);
  if (v.length < 2) return "";
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const pts = serie.map((x, i) => (x == null ? null : `${(i / (serie.length - 1)) * w},${h - 2 - ((x - mn) / r) * (h - 4)}`)).filter(Boolean).join(" ");
  const sube = v[v.length - 1] >= v[0];
  return `<svg class="spark" width="${w}" height="${h}"><polyline fill="none" stroke="${sube ? "var(--verde)" : "var(--rojo)"}" stroke-width="1.5" points="${pts}"/></svg>`;
}

// ---------- tabla genérica con orden y paginado ----------
function tabla(cont, cols, filas, opc = {}) {
  const el = typeof cont === "string" ? $(cont) : cont;
  const st = el._st || (el._st = { k: opc.orden || null, asc: !!opc.asc, lim: opc.lim || 200 });
  if (opc.reset) st.lim = opc.lim || 200;
  const col = cols.find((c) => c.k === st.k);
  let fs = filas.slice();
  if (col) {
    const val = col.s || ((f) => f[col.k]);
    fs.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.asc ? 1 : -1); });
  }
  if (!fs.length) { el.innerHTML = `<div class="vacio">${opc.vacio || "Sin datos con estos filtros."}</div>`; return; }
  const cab = cols.map((c) => `<th data-k="${c.k}" class="${c.n ? "num" : ""} ${st.k === c.k ? "ord" + (st.asc ? " asc" : "") : ""}">${c.t}</th>`).join("");
  const cuerpo = fs.slice(0, st.lim).map((f) => "<tr>" + cols.map((c) => `<td class="${c.n ? "num" : ""} ${c.corta ? "corta" : ""}">${c.f ? c.f(f) : esc(f[c.k] ?? "—")}</td>`).join("") + "</tr>").join("");
  el.innerHTML = (opc.cuenta === false ? "" : `<div class="cuenta">${fs.length.toLocaleString("es-CO")} filas</div>`) +
    `<div class="envoltura"><table><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table></div>` +
    (fs.length > st.lim ? `<button class="mas">Mostrar más (${fs.length - st.lim} restantes)</button>` : "");
  el.querySelectorAll("th").forEach((th) => th.onclick = () => { const k = th.dataset.k; if (st.k === k) st.asc = !st.asc; else { st.k = k; st.asc = false; } tabla(el, cols, filas, opc); });
  const b = el.querySelector(".mas"); if (b) b.onclick = () => { st.lim += 300; tabla(el, cols, filas, opc); };
}

// ---------- carga ----------
async function cargar(nombre, def) {
  try { const r = await fetch("data/" + nombre + "?v=" + Date.now()); if (!r.ok) return def; return await r.json(); } catch { return def; }
}
async function iniciar() {
  const [c, v, con, ret, rh, cor, est, rt] = await Promise.all([
    cargar("insiders_compras.json", {}), cargar("insiders_ventas.json", {}), cargar("congreso.json", {}),
    cargar("retail.json", {}), cargar("retail_hist.json", {}), cargar("cortos.json", {}), cargar("estado.json", {}),
    cargar("rtat.json", {}),
  ]);
  D.rtat = rt.filas || []; D.rtatUlt = rt.ultimo || "";
  D.comprasTodas = c.filas || []; D.ventasTodas = v.filas || [];
  D.compras = D.comprasTodas.filter((f) => !f.dudoso); D.ventas = D.ventasTodas.filter((f) => !f.dudoso); D.congreso = con.filas || []; D.retail = ret.filas || [];
  D.retailHist = rh || {}; D.cortos = cor.datos ? cor : { fechas: [], datos: {} }; D.estado = est || {};
  pintarEstado(); resumen(); insiders(); congreso(); retail(); cortos();
  const m = location.hash.match(/t=([A-Z0-9.\-]+)/i); if (m) irTicker(m[1]);
}

function pintarEstado() {
  const f = D.estado.fuentes || {};
  const nombres = { insiders: "Insiders", congreso: "Congreso", rtat: "Retail Nasdaq", retail: "Reddit", cortos: "Cortos" };
  $("#estado").innerHTML = Object.entries(nombres).map(([k, n]) => {
    const x = f[k]; if (!x) return `<span>${n}: <b>sin datos</b></span>`;
    return `<span class="${x.ok ? "" : "err"}" title="${esc(x.error || x.msg || "")}">${n}: <b>${x.ok ? sinceDias(x.fecha) : "error"}</b></span>`;
  }).join("");
  $("#demo").hidden = !D.estado.demo;
}

// ---------- análisis ----------
function deltaTenencia(f) { // % de cambio de la tenencia por la operación
  if (!f.post && f.cod === "S") return 1;
  const antes = f.cod === "P" ? f.post - f.acc : f.post + f.acc;
  return antes > 0 ? (f.cod === "P" ? f.acc / antes : -f.acc / antes) : null;
}
function clusters(dias = 30) {
  const lim = hace(dias), g = {};
  for (const f of D.compras) {
    if (f.fr < lim || !f.tk) continue;
    const x = g[f.tk] || (g[f.tk] = { tk: f.tk, emp: f.emp, ins: new Set(), val: 0, ult: "" });
    x.ins.add(f.ins); x.val += f.val; if (f.fr > x.ult) x.ult = f.fr;
  }
  return Object.values(g).filter((x) => x.ins.size >= 2).map((x) => ({ ...x, n: x.ins.size, nombres: [...x.ins].join("; ") }));
}
function senales() {
  const s = {}, get = (t) => s[t] || (s[t] = { tk: t, insVal: 0, insN: 0, conN: 0, ret: null, corto: null });
  const l30 = hace(30), l90 = hace(90);
  for (const f of D.compras) if (f.fr >= l30 && f.tk) { const x = get(f.tk); x.insVal += f.val; x.insN++; x.emp = x.emp || f.emp; }
  for (const f of D.congreso) if (f.fr >= l90 && f.tk && f.tipo === "Compra") get(f.tk).conN++;
  for (const r of D.retail) if (r.tk && (r.cambio ?? 0) > 0 && r.rank <= 150) { const x = get(r.tk); x.ret = r; x.emp = x.emp || r.nom; }
  for (const r of rtatUltimo()) if (r.sen != null && r.sen > 0) { const x = get(r.tk); x.nas = r; if (!x.ret) x.ret = { rank: "N", men: 0, cambio: null, nas: true }; }
  const out = [];
  for (const x of Object.values(s)) {
    const n = (x.insN > 0) + (x.conN > 0) + (x.ret != null);
    const serie = D.cortos.datos[x.tk]; x.corto = serie ? serie[serie.length - 1]?.[0] : null;
    if (n >= 2) out.push({ ...x, n });
  }
  return out;
}

// ---------- pestañas ----------
function resumen() {
  const l7 = hace(7), l30 = hace(30);
  const c7 = D.compras.filter((f) => f.fr >= l7), v7 = D.ventas.filter((f) => f.fr >= l7);
  const sum = (a) => a.reduce((s, f) => s + (f.val || 0), 0);
  const con30 = D.congreso.filter((f) => f.fr >= l30 && f.tk);
  const top = rtatUltimo()[0] || D.retail[0];
  const ratio = sum(v7) ? sum(c7) / sum(v7) : null;
  $("#kpis").innerHTML = [
    ["Compras de insiders · 7 días", dinero(sum(c7)), `${c7.length} reportes`, "compra"],
    ["Ventas de insiders · 7 días", dinero(sum(v7)), `${v7.length} reportes`, "venta"],
    ["Ratio compra/venta (valor)", ratio == null ? "—" : ratio.toFixed(3), "valor comprado ÷ valor vendido, 7 días", ""],
    ["Operaciones del Congreso · 30 días", num(con30.length), `${con30.filter((f) => f.tipo === "Compra").length} compras`, ""],
    [top && top.act != null ? "Más operada por minoristas" : "Más mencionada en Reddit", top ? top.tk : "—", top ? (top.act != null ? `${pct(top.act)} del dinero retail · ${fecha(D.rtatUlt)}` : `${num(top.men)} menciones 24 h`) : "", ""],
  ].map(([t, v, d, c]) => `<div class="kpi"><div class="t">${t}</div><div class="v ${c}">${v}</div><div class="d">${d}</div></div>`).join("");

  tabla("#cruce", [
    { k: "tk", t: "Ticker", f: (x) => tk(x.tk) },
    { k: "n", t: "Señales", n: 1, f: (x) => (x.insN ? `<span class="chip v">Insiders</span>` : "") + (x.conN ? `<span class="chip a">Congreso</span>` : "") + (x.ret ? `<span class="chip m">Retail</span>` : "") },
    { k: "insVal", t: "Insiders $", n: 1, f: (x) => (x.insVal ? dinero(x.insVal) : "—") },
    { k: "conN", t: "Congreso", n: 1, f: (x) => x.conN || "—" },
    { k: "ret", t: "Retail", n: 1, s: (x) => (x.nas ? 1e9 : 0) + (x.ret?.men || 0), f: (x) => [x.nas ? `<span title="Sentimiento Nasdaq">N +${x.nas.sen}</span>` : "", x.ret && !x.ret.nas ? `<span title="Ranking Reddit">R #${x.ret.rank}</span>` : ""].filter(Boolean).join(" · ") || "—" },
    { k: "corto", t: "% corto", n: 1, f: (x) => pct(x.corto, 0) },
  ], senales(), { orden: "n", lim: 25, cuenta: false, vacio: "Ninguna acción con dos o más señales por ahora." });

  tabla("#cluster", [
    { k: "tk", t: "Ticker", f: (x) => tk(x.tk) },
    { k: "emp", t: "Empresa", corta: 1 },
    { k: "n", t: "Insiders", n: 1, f: (x) => `<span title="${esc(x.nombres)}">${x.n}</span>` },
    { k: "val", t: "Total", n: 1, f: (x) => dinero(x.val) },
    { k: "ult", t: "Último", f: (x) => fecha(x.ult) },
  ], clusters(), { orden: "n", lim: 25, cuenta: false, vacio: "No hay compras agrupadas en los últimos 30 días." });

  tabla("#topcompras", colsInsiders(), D.compras.filter((f) => f.fr >= l30), { orden: "val", lim: 15, cuenta: false });
}

function colsInsiders() {
  return [
    { k: "fr", t: "Reportado", f: (f) => fecha(f.fr) },
    { k: "ft", t: "Operación", f: (f) => fecha(f.ft) },
    { k: "tk", t: "Ticker", f: (f) => tk(f.tk) },
    { k: "emp", t: "Empresa", corta: 1 },
    { k: "ins", t: "Insider", corta: 1, f: (f) => esc(f.ins) + (f.enm ? ` <span class="chip m" title="Enmienda (4/A)">4/A</span>` : "") + (f.plan ? ` <span class="chip a" title="Plan 10b5-1 programado">10b5-1</span>` : "") },
    { k: "cargo", t: "Cargo", corta: 1 },
    { k: "acc", t: "Acciones", n: 1, f: (f) => num(f.acc) },
    { k: "pre", t: "Precio", n: 1, f: (f) => (f.pre ? "$" + f.pre.toFixed(2) : "—") },
    { k: "val", t: "Valor", n: 1, s: (f) => (f.dudoso ? -1 : f.val), f: (f) => (f.dudoso ? `<span class="chip m" title="Precio o monto con probable error de digitación en el reporte original. No se suma en los totales.">⚠ revisar</span> <s>${dinero(f.val)}</s>` : `<span class="${f.cod === "P" ? "compra" : "venta"}">${dinero(f.val)}</span>`) },
    { k: "dt", t: "Δ tenencia", n: 1, s: deltaTenencia, f: (f) => pct(deltaTenencia(f), 0) },
    { k: "url", t: "", f: (f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">SEC ↗</a>` },
  ];
}

function insiders() {
  let tipo = "P";
  const pintar = (reset) => {
    const q = $("#ins-tk").value.trim().toLowerCase(), lim = hace(+$("#ins-dias").value), min = +$("#ins-min").value;
    const cargo = $("#ins-cargo").value, sinPlan = $("#ins-plan").checked;
    const re = cargo ? new RegExp(cargo, "i") : null;
    const fs = (tipo === "P" ? D.comprasTodas : D.ventasTodas).filter((f) => f.fr >= lim && f.val >= min && (!q || f.tk.toLowerCase().startsWith(q) || (f.emp || "").toLowerCase().includes(q) || (f.ins || "").toLowerCase().includes(q)) && (!re || re.test(f.cargo || "")) && (!sinPlan || !f.plan));
    tabla("#ins-tabla", colsInsiders(), fs, { orden: "fr", reset, vacio: tipo === "P" ? "Sin compras con estos filtros." : "Sin ventas con estos filtros." });
  };
  $("#ins-tipo").querySelectorAll("button").forEach((b) => b.onclick = () => { $("#ins-tipo .activo").classList.remove("activo"); b.classList.add("activo"); tipo = b.dataset.v; pintar(true); });
  ["#ins-tk", "#ins-dias", "#ins-min", "#ins-cargo", "#ins-plan"].forEach((s) => $(s).addEventListener("input", () => pintar(true)));
  pintar();
}

function colsCongreso() {
  return [
    { k: "fr", t: "Reportado", f: (f) => fecha(f.fr) },
    { k: "ft", t: "Operación", f: (f) => fecha(f.ft) },
    { k: "dias", t: "Retraso", n: 1, f: (f) => (f.dias == null ? "—" : f.dias + " d") },
    { k: "mem", t: "Congresista", corta: 1, f: (f) => esc(f.mem) + (f.par || f.est ? ` <span class="par-${esc(f.par)}">(${esc([f.par, f.est].filter(Boolean).join("-"))})</span>` : "") },
    { k: "cam", t: "Cámara" },
    { k: "tk", t: "Ticker", f: (f) => tk(f.tk) },
    { k: "act", t: "Activo", corta: 1 },
    { k: "tipo", t: "Tipo", f: (f) => `<span class="${f.tipo === "Compra" ? "compra" : f.tipo?.startsWith("Venta") ? "venta" : ""}">${esc(f.tipo || "—")}</span>` },
    { k: "mmin", t: "Monto", n: 1, s: (f) => f.mmax || f.mmin, f: (f) => esc(f.monto || "—") },
    { k: "url", t: "", f: (f) => (f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">Reporte ↗</a>` : "") },
  ];
}
function congreso() {
  const pintar = (reset) => {
    const q = $("#con-tk").value.trim().toLowerCase(), cam = $("#con-cam").value, tp = $("#con-tipo").value, par = $("#con-par").value, lim = hace(+$("#con-dias").value);
    const fs = D.congreso.filter((f) => (f.fr || "") >= lim && (!cam || f.cam === cam) && (!tp || (f.tipo || "").startsWith(tp)) && (!par || f.par === par) && (!q || (f.tk || "").toLowerCase().startsWith(q) || (f.mem || "").toLowerCase().includes(q)));
    tabla("#con-tabla", colsCongreso(), fs, { orden: "fr", reset });
  };
  ["#con-tk", "#con-cam", "#con-tipo", "#con-par", "#con-dias"].forEach((s) => $(s).addEventListener("input", () => pintar(true)));
  pintar();
}

function rtatUltimo() { return D.rtat.filter((r) => r.f === D.rtatUlt).sort((a, b) => b.act - a.act); }
function rtatSerie(t) { const d = [...new Set(D.rtat.map((r) => r.f))].sort().slice(-30); const m = {}; D.rtat.forEach((r) => { if (r.tk === t) m[r.f] = r.sen; }); return d.map((f) => m[f] ?? null); }
function rtat() {
  const l30 = hace(30), dias = {};
  D.rtat.forEach((r) => { if (r.f >= l30) dias[r.tk] = (dias[r.tk] || 0) + 1; });
  tabla("#rtat-tabla", [
    { k: "pos", t: "#", n: 1 },
    { k: "tk", t: "Ticker", f: (r) => tk(r.tk) },
    { k: "act", t: "Actividad", n: 1, f: (r) => pct(r.act, 2) },
    { k: "sen", t: "Sentimiento (10 días)", n: 1, f: (r) => (r.sen == null ? "—" : `<span class="${r.sen > 0 ? "compra" : r.sen < 0 ? "venta" : ""}">${r.sen > 0 ? "+" : ""}${r.sen} ${r.sen > 0 ? "comprando" : r.sen < 0 ? "vendiendo" : ""}</span>`) },
    { k: "d30", t: "Días en el top 10 (30 d)", n: 1 },
    { k: "s", t: "Sentimiento 30 d", f: (r) => spark(rtatSerie(r.tk)) },
  ], rtatUltimo().map((r, i) => ({ ...r, pos: i + 1, d30: dias[r.tk] || 1 })), { orden: "pos", asc: true, cuenta: false,
    vacio: "Sin datos de Nasdaq todavía. Revisa que el secreto NASDAQ_API_KEY esté creado y ejecuta la actualización." });
  if (D.rtatUlt) $("#rtat-tabla").insertAdjacentHTML("afterbegin", `<div class="cuenta">Día de mercado: ${fecha(D.rtatUlt)}</div>`);
}

function retail() {
  rtat();
  const l30 = hace(30), compraIns = new Set(D.compras.filter((f) => f.fr >= l30).map((f) => f.tk));
  const pintar = (reset) => {
    const q = $("#ret-tk").value.trim().toLowerCase(), sube = $("#ret-sub").checked;
    const fs = D.retail.filter((r) => (!q || r.tk.toLowerCase().startsWith(q) || r.nom.toLowerCase().includes(q)) && (!sube || (r.cambio ?? 0) > 0));
    tabla("#ret-tabla", [
      { k: "rank", t: "#", n: 1 },
      { k: "tk", t: "Ticker", f: (r) => tk(r.tk) + (compraIns.has(r.tk) ? ` <span class="chip v" title="Compras de insiders en 30 días">insiders</span>` : "") },
      { k: "nom", t: "Nombre", corta: 1 },
      { k: "men", t: "Menciones 24 h", n: 1, f: (r) => num(r.men) },
      { k: "men24", t: "24 h antes", n: 1, f: (r) => num(r.men24) },
      { k: "cambio", t: "Cambio", n: 1, f: (r) => (r.cambio == null ? "nuevo" : `<span class="${r.cambio >= 0 ? "compra" : "venta"}">${r.cambio > 0 ? "+" : ""}${r.cambio}%</span>`) },
      { k: "up", t: "Upvotes", n: 1, f: (r) => num(r.up) },
      { k: "h", t: "Tendencia", f: (r) => spark((D.retailHist[r.tk] || []).map((x) => x[1])) },
    ], fs, { orden: "rank", asc: true, reset });
  };
  ["#ret-tk", "#ret-sub"].forEach((s) => $(s).addEventListener("input", () => pintar(true)));
  pintar();
}

function filasCortos() {
  return Object.entries(D.cortos.datos).map(([t, serie]) => {
    const r = serie.map((x) => (x ? x[0] : null)), v = r.filter((x) => x != null);
    const prom = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    const ult = serie[serie.length - 1];
    return { tk: t, ult: ult?.[0], vol: ult?.[1], prom, dif: ult && prom != null ? ult[0] - prom : null, serie: r };
  });
}
function cortos() {
  const todas = filasCortos();
  const pintar = (reset) => {
    const q = $("#cor-tk").value.trim().toUpperCase(), vmin = +$("#cor-vol").value;
    tabla("#cor-tabla", [
      { k: "tk", t: "Ticker", f: (r) => tk(r.tk) },
      { k: "ult", t: "% corto (último día)", n: 1, f: (r) => pct(r.ult) },
      { k: "prom", t: `Promedio ${D.cortos.fechas.length} días`, n: 1, f: (r) => pct(r.prom) },
      { k: "dif", t: "vs. promedio", n: 1, f: (r) => (r.dif == null ? "—" : `<span class="${r.dif > 0 ? "venta" : "compra"}">${r.dif > 0 ? "+" : ""}${(r.dif * 100).toFixed(1)} pts</span>`) },
      { k: "vol", t: "Volumen reportado", n: 1, f: (r) => num(r.vol) },
      { k: "s", t: "Tendencia", f: (r) => spark(r.serie) },
    ], todas.filter((r) => r.vol >= vmin && (!q || r.tk.startsWith(q))), { orden: "ult", reset });
  };
  ["#cor-tk", "#cor-vol"].forEach((s) => $(s).addEventListener("input", () => pintar(true)));
  pintar();
}

function irTicker(t) {
  t = t.toUpperCase();
  activar("buscar"); $("#bus-tk").value = t; buscar(t);
  history.replaceState(null, "", "#t=" + t);
}
function buscar(t) {
  t = t.trim().toUpperCase(); const res = $("#bus-res");
  if (!t) { res.innerHTML = ""; return; }
  const c = D.compras.filter((f) => f.tk === t), v = D.ventas.filter((f) => f.tk === t), con = D.congreso.filter((f) => f.tk === t);
  const r = D.retail.find((x) => x.tk === t), s = D.cortos.datos[t];
  const sum = (a) => a.reduce((x, f) => x + f.val, 0);
  const nombre = c[0]?.emp || v[0]?.emp || r?.nom || "";
  res.innerHTML = `<div class="kpis">
    <div class="kpi"><div class="t">${esc(nombre) || "Ticker"}</div><div class="v">${esc(t)}</div><div class="d"><a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4&owner=include&company=&CIK=${esc(t)}" target="_blank" rel="noopener">Ver Form 4 en la SEC ↗</a></div></div>
    <div class="kpi"><div class="t">Compras de insiders</div><div class="v compra">${dinero(sum(c))}</div><div class="d">${c.length} reportes</div></div>
    <div class="kpi"><div class="t">Ventas de insiders</div><div class="v venta">${dinero(sum(v))}</div><div class="d">${v.length} reportes (últimos 60 días)</div></div>
    <div class="kpi"><div class="t">Congreso</div><div class="v">${con.length}</div><div class="d">${con.filter((f) => f.tipo === "Compra").length} compras · ${con.filter((f) => f.tipo?.startsWith("Venta")).length} ventas</div></div>
    <div class="kpi"><div class="t">Reddit</div><div class="v">${r ? "#" + r.rank : "—"}</div><div class="d">${r ? num(r.men) + " menciones 24 h " + spark((D.retailHist[t] || []).map((x) => x[1])) : "fuera del top"}</div></div>
    <div class="kpi"><div class="t">Minoristas (Nasdaq)</div><div class="v">${(() => { const x = D.rtat.filter((q) => q.tk === t); return x.length ? (x[0].sen > 0 ? '<span class="compra">+' : '<span class="venta">') + x[0].sen + "</span>" : "—"; })()}</div><div class="d">${(() => { const x = D.rtat.filter((q) => q.tk === t); return x.length ? `sentimiento al ${fecha(x[0].f)} · ${x.length} días en el top 10` : "no ha estado en el top 10"; })()}</div></div>
    <div class="kpi"><div class="t">% en corto (FINRA)</div><div class="v">${s ? pct(s[s.length - 1]?.[0]) : "—"}</div><div class="d">${s ? spark(s.map((x) => (x ? x[0] : null))) : "sin datos"}</div></div>
  </div>
  <div class="panel"><h2>Insiders</h2><div id="bus-ins"></div></div>
  <div class="panel"><h2>Congreso</h2><div id="bus-con"></div></div>`;
  tabla("#bus-ins", colsInsiders(), c.concat(v), { orden: "fr", cuenta: false, vacio: "Sin operaciones de insiders registradas." });
  tabla("#bus-con", colsCongreso(), con, { orden: "fr", cuenta: false, vacio: "Sin operaciones de congresistas registradas." });
}

function activar(id) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("activo", b.dataset.tab === id));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("activo", s.id === id));
}
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => activar(b.dataset.tab));
document.addEventListener("click", (e) => { const t = e.target.closest(".tk"); if (t) irTicker(t.dataset.tk); });
$("#bus-tk").addEventListener("input", (e) => buscar(e.target.value));
iniciar();
