/* Pruebas del motor de rayas rodantes. Sin dependencias.
 * Uso: node rayas-v2/probar.mjs
 * Sale con código 1 si alguna garantía se rompe. */
import { analizar, listaDeDibujo, normalizar, BH, BL } from "./motor.mjs";
import { serieTendencia, serieConRuptura } from "./series.mjs";

let fallos = 0;
const check = (nombre, cond, extra) => {
  if (cond) console.log(`  ok   ${nombre}`);
  else { fallos++; console.log(`  FALLA ${nombre}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`); }
};

console.log("\n[1] Tendencia limpia: nace en el origen y se corre hasta el último retroceso");
{
  const velas = serieTendencia(600);
  const r = analizar(velas);
  const m = r.marcas.find(x => x.rol === "M");
  const d = normalizar(velas);
  const last = d.length - 2;
  check("hay raya maestra", !!m, r.audit);
  if (m) {
    check("nace al inicio de la tendencia (a <= 40)", m.a <= 40, { a: m.a });
    check("ancla en el pivote de cuerpo real", Math.abs(m.pa - BL(d[m.a])) < 1e-6, { pa: m.pa, bl: BL(d[m.a]) });
    check("se corrió hasta el último retroceso (b cerca del final)", last - m.b <= 30, { b: m.b, last });
    check("CERO cierres violando", m.viol === 0, { viol: m.viol });
    check("al menos 3 toques", m.touches >= 3, { toques: m.touches });
    check("pendiente ~ 0.05 por vela", Math.abs((m.pb - m.pa) / (m.b - m.a) - 0.05) < 0.02,
      { pendiente: (m.pb - m.pa) / (m.b - m.a) });
    check("grado A o B", m.grade === "A" || m.grade === "B", { grade: m.grade });
    check("buscó desde el retroceso más reciente hacia atrás", r.audit.pasos >= 2, { pasos: r.audit.pasos });
  }
  check("2 o 3 marcas", r.marcas.length >= 2 && r.marcas.length <= 3, { n: r.marcas.length });
  check("auditoría OK", r.audit.ok === true, r.audit);
}

console.log("\n[2] La tendencia se acelera: la raya se corre al nuevo ritmo");
{
  const velas = serieTendencia(620, { slopeIni: 0.04, slopeFin: 0.16, cambio: 260 });
  const r = analizar(velas);
  const m = r.marcas.find(x => x.rol === "M");
  check("hay raya maestra", !!m);
  if (m) {
    const pend = (m.pb - m.pa) / (m.b - m.a);
    check("ancla en el tramo nuevo (b > 300)", m.b > 300, { b: m.b });
    check("pendiente adoptó el ritmo nuevo (> 0.10)", pend > 0.10, { pendiente: pend });
    check("sin violaciones", m.viol === 0);
  }
}

console.log("\n[3] Ruptura fuerte: no se marca ninguna raya violada");
{
  const n = 320, corte = n - 40;
  const r = analizar(serieConRuptura(n));
  const violadas = r.marcas.filter(x => x.viol > 0);
  check("ninguna marca con violaciones", violadas.length === 0, violadas.map(v => ({ rol: v.rol, viol: v.viol })));
  const m = r.marcas.find(x => x.rol === "M");
  /* Tras la ruptura la tendencia cambia de sentido: la vieja alcista no puede
     seguir viva cruzando el desplome. */
  check("la maestra no cruza el desplome", !m || m.a >= corte || m.b < corte, m && { a: m.a, b: m.b, corte });
}

console.log("\n[4] Determinismo y límites");
{
  const velas = serieTendencia(450);
  const a = JSON.stringify(analizar(velas));
  const b = JSON.stringify(analizar(velas));
  check("mismas velas -> mismas rayas", a === b);
  const r = analizar(velas);
  check("máximo 3 marcas", r.marcas.length <= 3, { n: r.marcas.length });
  check("toda raya nace antes de morir", r.marcas.every(m => m.a <= m.b));
  check("ninguna proyección hacia atrás", listaDeDibujo(r, { leftBar: 0, rightBar: 449 })
    .every(s => s.x1Bar >= s.clipLeftBar));
  const d = normalizar(velas);
  const i = r.marcas.find(m => m.rol === "I");
  if (i) check("interna anclada en pivote real",
    Math.abs(i.pa - BL(d[i.a])) < 1e-6 || Math.abs(i.pa - BH(d[i.a])) < 1e-6);
}

console.log("\n[5] Bajista: espejo exacto");
{
  const up = serieTendencia(500);
  const down = up.map((c, i) => {
    const nivel = 300 - (c.c - 100);
    return { t: c.t, o: 300 - (c.o - 100), h: 300 - (c.l - 100), l: 300 - (c.h - 100), c: nivel };
  });
  const r = analizar(down);
  const m = r.marcas.find(x => x.rol === "M");
  check("detecta bajista", r.dir === -1, { dir: r.dir });
  check("hay maestra bajista", !!m && m.dir === -1);
  if (m) {
    check("ancla en máximo de cuerpo real", Math.abs(m.pa - BH(normalizar(down)[m.a])) < 1e-6);
    check("pendiente negativa", (m.pb - m.pa) / (m.b - m.a) < 0);
    check("sin violaciones", m.viol === 0);
  }
}

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLOS\n`);
process.exit(fallos === 0 ? 0 : 1);
