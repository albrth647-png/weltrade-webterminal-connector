/* Visor del motor de rayas rodantes.
 * Uso:
 *   node rayas-v2/ver.mjs --file velas.json
 *   node rayas-v2/ver.mjs --url "http://127.0.0.1:3000/velas?simbodo=FX%20Vol%2020&tf=M30"
 *   node rayas-v2/ver.mjs --demo            (serie sintética con línea plantada)
 * Escribe rayas-v2/vista.html y resume las marcas por stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analizar, listaDeDibujo, normalizar } from "./motor.mjs";
import { serieDemo, serieConRuptura } from "./series.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, def) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : def;
};

let velas, etiqueta;
const url = arg("--url");
const file = arg("--file");
if (process.argv.includes("--demo")) {
  velas = serieDemo(600);
  etiqueta = "demo · tendencia con impulsos y retrocesos";
} else if (url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
  const j = await r.json();
  velas = j.velas || j.candles || j;
  etiqueta = url;
} else if (file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  velas = j.velas || j.candles || j;
  etiqueta = path.basename(file);
} else {
  console.error("Falta --file, --url o --demo");
  process.exit(1);
}

const d = normalizar(velas);
const tol = arg("--tol");
const res = analizar(velas, tol ? { tolATR: +tol } : undefined);
const dib = listaDeDibujo(res, { leftBar: 0, rightBar: d.length - 1 });

const resumen = {
  fuente: etiqueta,
  velas: d.length,
  tendencia: res.dir > 0 ? "ALCISTA" : "BAJISTA",
  origen: res.audit.origen,
  marcas: res.marcas.map(m => ({
    rol: m.rol, grado: m.grade, dir: m.dir,
    desdeBarra: m.a, hastaBarra: m.b,
    desdePrecio: +m.pa.toFixed(5), hastaPrecio: +m.pb.toFixed(5),
    toques: m.touches, rechazos: m.rejects, violaciones: m.viol,
    rota: !!m.rota, roturaEnBarra: m.breakBar ?? null,
    pendienteATR: +m.slopeATR.toFixed(4), valida: m.valid
  })),
  auditoria: res.audit
};
console.log(JSON.stringify(resumen, null, 2));

const html = plantilla({ etiqueta, velas: d, res, dib });
const salida = path.join(aqui, "vista.html");
fs.writeFileSync(salida, html);
console.log(`\nvista: ${salida}`);

function plantilla({ etiqueta, velas, res, dib }) {
  const datos = JSON.stringify({
    velas: velas.map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
    rayas: dib,
    dir: res.dir,
    etiqueta,
    marcas: res.marcas.map(m => ({
      rol: m.rol, a: m.a, b: m.b, grade: m.grade,
      touches: m.touches, viol: m.viol, pa: m.pa, pb: m.pb
    }))
  });
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Rayas v2 · ${etiqueta}</title>
<style>
  html,body{margin:0;background:#0d1117;color:#c9d1d9;font:13px/1.4 ui-sans-serif,system-ui,sans-serif}
  header{display:flex;gap:16px;align-items:baseline;padding:10px 16px;border-bottom:1px solid #21262d}
  h1{font-size:14px;margin:0;font-weight:600}
  .tag{padding:2px 8px;border-radius:99px;border:1px solid #30363d;font-size:11px}
  .tag.bull{color:#3fb950;border-color:#238636}.tag.bear{color:#f85149;border-color:#8b2c2c}
  .leyenda{display:flex;gap:14px;padding:6px 16px;font-size:11px;color:#8b949e;flex-wrap:wrap}
  .leyenda i{display:inline-block;width:22px;height:0;border-top:2px solid;vertical-align:middle;margin-right:6px}
  canvas{display:block;width:100%;height:calc(100vh - 92px)}
</style></head>
<body>
<header>
  <h1>Rayas v2 · trendline rodante</h1>
  <span class="tag ${res.dir > 0 ? "bull" : "bear"}">${res.dir > 0 ? "ALCISTA" : "BAJISTA"}</span>
  <span class="tag">${etiqueta}</span>
  <span class="tag">${velas.length} velas</span>
  <span class="tag">${res.marcas.length} marcas</span>
</header>
<div class="leyenda">
  <span><i style="border-color:#58a6ff"></i>M · maestra rodante (nace en el origen, se corre a cada retroceso)</span>
  <span><i style="border-color:#8b949e"></i>I · interna del impulso</span>
  <span><i style="border-color:#d29922"></i>C · canal paralelo</span>
</div>
<canvas id="cv"></canvas>
<script>
const D = ${datos};
const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
const COLOR = { bull: "#3fb950", bear: "#f85149", channel: "#d29922" };
let W = 0, H = 0, PADL = 8, PADR = 78, PADT = 14, PADB = 26;

function pintar() {
  const dpr = window.devicePixelRatio || 1;
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const v = D.velas, n = v.length;
  let hi = -Infinity, lo = Infinity;
  for (const c of v) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
  const margen = (hi - lo) * 0.06 || 1;
  hi += margen; lo -= margen;

  const x = (i) => PADL + (W - PADL - PADR) * (i + 0.5) / n;
  const y = (p) => PADT + (H - PADT - PADB) * (1 - (p - lo) / (hi - lo));
  const paso = (W - PADL - PADR) / n;
  const ancho = Math.max(1, Math.min(9, paso * 0.62));

  // rejilla + precios
  ctx.font = "11px ui-monospace,monospace";
  ctx.textBaseline = "middle";
  for (let k = 0; k <= 5; k++) {
    const p = lo + (hi - lo) * k / 5, yy = y(p);
    ctx.strokeStyle = "#161b22"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PADL, yy); ctx.lineTo(W - PADR, yy); ctx.stroke();
    ctx.fillStyle = "#6e7681"; ctx.textAlign = "left";
    ctx.fillText(p.toFixed(2), W - PADR + 8, yy);
  }

  // velas
  for (let i = 0; i < n; i++) {
    const c = v[i], sube = c.c >= c.o;
    ctx.strokeStyle = ctx.fillStyle = sube ? "#3fb950" : "#f85149";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(i), y(c.h)); ctx.lineTo(x(i), y(c.l)); ctx.stroke();
    const yo = y(c.o), yc = y(c.c);
    ctx.fillRect(x(i) - ancho / 2, Math.min(yo, yc), ancho, Math.max(1, Math.abs(yc - yo)));
  }

  // rayas
  const etiquetas = [];
  for (const r of D.rayas) {
    const col = COLOR[r.colorRole] || "#58a6ff";
    ctx.strokeStyle = col;
    ctx.lineWidth = r.width;
    ctx.setLineDash(r.style === "dash" ? [5, 5] : []);
    ctx.beginPath();
    ctx.moveTo(x(r.x1Bar), y(r.p1));
    ctx.lineTo(x(r.x2Bar), y(r.p2));
    ctx.stroke();
    ctx.setLineDash([]);
    etiquetas.push({
      col,
      texto: r.rol + " · " + r.touches + "t · " + r.grade,
      ex: x(r.x2Bar) - 6,
      ey: y(r.p2) - 6
    });
  }

  // etiquetas: se separan para que no se pisen
  ctx.font = "600 11px ui-sans-serif,system-ui,sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  etiquetas.sort((p, q) => p.ey - q.ey);
  for (let k = 1; k < etiquetas.length; k++) {
    if (etiquetas[k].ey - etiquetas[k - 1].ey < 15) etiquetas[k].ey = etiquetas[k - 1].ey + 15;
  }
  for (const e of etiquetas) {
    const w = ctx.measureText(e.texto).width + 10;
    ctx.fillStyle = "rgba(13,17,23,.82)";
    ctx.fillRect(e.ex - w + 6, e.ey - 13, w, 15);
    ctx.fillStyle = e.col;
    ctx.fillText(e.texto, e.ex, e.ey);
  }
}
pintar();
addEventListener("resize", pintar);
</script>
</body></html>`;
}
