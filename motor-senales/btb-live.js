/* btb-live.js · POLÍTICA DE VISUALIZACIÓN EN VIVO (máx. 2 marcaciones)
 * El motor calcula la estructura; este módulo decide QUÉ se ve.
 * Regla: en pantalla solo la trendline vigente + el nivel horizontal vigente.
 * Lo histórico NO se dibuja. Cada actualización reemplaza, no acumula.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(typeof require === "function" ? require("./btb-core.js") : root.BTB);
  else root.BTBLive = factory(root.BTB);
})(typeof globalThis !== "undefined" ? globalThis : this, function (BTB) {
  "use strict";
  const at = (m, x) => m.pa + (m.pb - m.pa) * (x - m.a) / ((m.b - m.a) || 1);

  /* Devuelve como máximo `maxMarks` marcas vivas (por defecto 2). */
  function liveMarks(result, opts) {
    opts = opts || {};
    const max = opts.maxMarks == null ? 2 : opts.maxMarks;
    const out = [];
    const ln = (result.activeLine && result.activeLine.dir === result.trend) ? result.activeLine : null;
    let lvl = result.protectedLevel || null;
    if (!lvl && result.levels.length) lvl = result.levels[result.levels.length - 1];
    if (ln) out.push({ kind: "trendline", id: ln.id, dir: ln.dir, valid: ln.valid, warn: ln.warn,
                       a: ln.a, pa: ln.pa, b: ln.b, pb: ln.pb, touches: ln.touches });
    if (lvl) out.push({ kind: "level", id: lvl.id, role: lvl.role, active: lvl.active,
                        a: lvl.a, b: lvl.b, price: lvl.price });
    return out.slice(0, max);
  }

  /* Lista de dibujo en vivo: su renderizador solo pinta esto (máx. 2 segmentos). */
  function buildLiveDrawList(result, view, opts) {
    const L = view.leftBar, R = view.rightBar;
    return liveMarks(result, opts).map(m => {
      if (m.kind === "level") {
        const x2 = m.active ? R : (m.b == null ? R : m.b);
        /* El nivel vigente es una referencia de precio: ocupa todo el ancho
           visible, no solo el tramo desde su ancla. */
        const x1 = L;
        return { kind: "level", id: m.id, role: m.role, active: m.active,
                 x1Bar: x1, p1: m.price, x2Bar: x2, p2: m.price,
                 clipLeftBar: Math.min(m.a, x1), rayRight: !!m.active,
                 style: "solid", width: 2, colorRole: "level",
                 label: `${m.role} ${m.price.toFixed(2)}` };
      }
      const x1 = Math.max(m.a, L);
      return { kind: "trendline", id: m.id, dir: m.dir, valid: m.valid, warn: m.warn,
               x1Bar: x1, p1: at(m, x1), x2Bar: R, p2: at(m, R),
               clipLeftBar: m.a, rayRight: true,
               style: m.warn ? "dash" : (m.valid ? "solid" : "dash"),
               width: 2, colorRole: m.warn ? "warn" : (m.dir > 0 ? "bull" : "bear"),
               label: `${m.id} · ${m.touches}t · ${m.valid ? "VIVA" : "CAND"}` };
    }).filter(s => s.x2Bar >= L && s.x1Bar <= R);
  }

  /* Verificación de la política (hechos, no promesas). */
  function liveSelfTest(result, view) {
    const dl = buildLiveDrawList(result, view);
    return {
      max2: dl.length <= 2,
      clip: dl.every(s => s.x1Bar >= s.clipLeftBar),
      kinds: dl.map(s => s.kind)
    };
  }

  return { liveMarks, buildLiveDrawList, liveSelfTest };
});
