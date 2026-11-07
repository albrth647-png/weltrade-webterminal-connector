'use strict';
/* ============================================================
   HELPERS DOCX — informe de auditoría (receta R1 + paleta DM-1)
   ============================================================ */
const {
  Paragraph, TextRun, Table, TableRow, TableCell, TableLayoutType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
} = require('docx');

/* ---------- paleta DM-1 (Deep Cyan — tech) ---------- */
const P = {
  bg: '162235',
  titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078',
  accent: '37DCF2',
  primary: '0A1628',          // títulos del cuerpo (tono tech oscuro)
  body: '000000',             // Perfil A formal: negro puro
  secondary: '506070',
  code: '24435C',
  table: { headerBg: '1B6B7A', headerText: 'FFFFFF', accentLine: '1B6B7A', innerLine: 'C8DDE2', surface: 'EDF3F5' },
};

/* ---------- bordes ---------- */
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

/* ---------- fuentes (documento en español → perfil latino) ---------- */
const F_BODY = { ascii: 'Times New Roman', eastAsia: 'Times New Roman' };
const F_HEAD = { ascii: 'Arial', eastAsia: 'Arial' };
const F_CODE = { ascii: 'Courier New', eastAsia: 'Courier New' };

/* ---------- títulos (HeadingLevel obligatorio para el TOC) ---------- */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: F_HEAD })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: F_HEAD })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100, line: 312 },
    children: [new TextRun({ text, bold: true, size: 24, color: P.primary, font: F_HEAD })],
  });
}

/* ---------- párrafos ---------- */
/* trozos: string o {t, b(cursiva no usada), bold, code} */
function runDe(x) {
  if (typeof x === 'string') return new TextRun({ text: x, size: 24, color: P.body, font: F_BODY });
  return new TextRun({
    text: x.t, bold: !!x.bold, size: x.code ? 21 : 24,
    color: x.code ? P.code : (x.color || P.body),
    font: x.code ? F_CODE : F_BODY,
  });
}
function p(...trozos) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    children: trozos.map(runDe),
  });
}
/* lista con viñeta real */
function bullet(...trozos) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    bullet: { level: 0 },
    spacing: { line: 312, after: 60 },
    children: trozos.map(runDe),
  });
}

/* ---------- tabla horizontal-only (estilo negocio, tokens DM-1) ---------- */
function tabla(cabeceras, filas, anchos) {
  const mk = (text, esCab, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: esCab ? { type: ShadingType.CLEAR, fill: P.table.headerBg } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({
      spacing: { line: 312 },
      children: String(text).split('\n').map((linea, i) => new TextRun({
        text: linea, bold: esCab, size: 20,
        color: esCab ? P.table.headerText : P.body,
        font: F_BODY,
        break: i > 0 ? 1 : undefined,
      })),
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: cabeceras.map((t, i) => mk(t, true, anchos[i])),
      }),
      ...filas.map((fila) => new TableRow({
        cantSplit: true,
        children: fila.map((t, i) => mk(t, false, anchos[i])),
      })),
    ],
  });
}
/* título de tabla (keepNext) */
function tituloTabla(texto) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text: texto, bold: true, size: 21, color: P.secondary, font: F_BODY })],
  });
}
/* espacio tras tabla */
function posTabla() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

/* ============================================================
   PORTADA — Receta R1 (Pure Paragraph Left) con calcTitleLayout
   y calcCoverSpacing, adaptada a texto latino (ancho ~pt*11)
   ============================================================ */
function calcTitleLayoutLatin(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 11;                    // carácter latino ≈ 0.55 em
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  const partir = (texto, cpl) => {
    if (texto.length <= cpl) return [texto];
    const palabras = texto.split(' ');
    const lineas = []; let actual = '';
    for (const w of palabras) {
      const prueba = actual ? actual + ' ' + w : w;
      if (prueba.length > cpl && actual) { lineas.push(actual); actual = w; }
      else actual = prueba;
    }
    if (actual) lineas.push(actual);
    if (lineas.length > 1 && lineas[lineas.length - 1].length <= 4) {
      const ult = lineas.pop();
      lineas[lineas.length - 1] += ' ' + ult;
    }
    return lineas;
  };
  let titlePt = preferredPt, lineas;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 4) { titlePt -= 2; continue; }
    lineas = partir(title, cpl);
    if (lineas.length <= 3) break;
    titlePt -= 2;
  }
  if (!lineas || lineas.length > 3) { lineas = partir(title, charsPerLine(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lineas };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838,
  } = params;
  const SAFETY = 1200;
  const usable = pageHeight - SAFETY;
  const titleH = titleLineCount * (titlePt * 23 + 200);
  const subH = hasSubtitle ? (12 * 23 + 600) : 0;
  const engH = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaH = metaLineCount * (10 * 23 + 100);
  const implicit = 3 * 300;
  const content = titleH + subH + engH + metaH + fixedHeight + implicit;
  const restante = Math.max(usable - content, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(restante * 0.45);
  const rawBottom = Math.floor(restante * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutLatin(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split('').join('  '),
        size: 18, color: P.accent, font: { ascii: 'Arial', eastAsia: 'Arial' }, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { ascii: 'Arial', eastAsia: 'Arial' },
      })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({
        text: config.subtitle, size: 24, color: P.subtitleColor,
        font: { ascii: 'Arial', eastAsia: 'Arial' },
      })],
    }));
  }

  for (const linea of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200, right: padR }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: linea, size: 22, color: P.metaColor,
        font: { ascii: 'Arial', eastAsia: 'Arial' },
      })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.footerColor, font: { ascii: 'Arial' } }),
      new TextRun({ text: '                                                            ' }),
      new TextRun({ text: config.footerRight || '', size: 16, color: P.footerColor, font: { ascii: 'Arial' } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: noBorders,
        verticalAlign: 'top',
        children,
      })],
    })],
  })];
}

module.exports = { P, h1, h2, h3, p, bullet, tabla, tituloTabla, posTabla, buildCoverR1, runDe };
