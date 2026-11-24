export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Columnas compactas: 1 millón de velas en IndexedDB sin inflar el almacenamiento. */
export type Columns = {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
};

export type Parsed = {
  symbol: string;
  timeframe: string;
  count: number;
  from: number;
  to: number;
  columns: Columns;
};

const TF_SUFFIX = /_(M1|M2|M3|M4|M5|M6|M10|M12|M15|M20|M30|H1|H2|H3|H4|H6|H8|H12|D1|W1)$/i;

export function symbolFromName(name: string): string {
  const base = name.replace(/\.csv$/i, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? name;
  return base
    .replace(TF_SUFFIX, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function timeframeFromName(name: string): string {
  const m = name.match(TF_SUFFIX);
  return m ? m[1].toLowerCase() : '1m';
}

export function detectSeparator(header: string): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestCount = 0;
  for (const sep of candidates) {
    const n = header.split(sep).length - 1;
    if (n > bestCount) {
      best = sep;
      bestCount = n;
    }
  }
  return best;
}

function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Números con coma decimal, espacios finos y separador de miles. */
export function parseNumber(raw: string): number {
  const text = raw.trim().replace(/[\s\u00a0']/g, '');
  if (!text) return NaN;
  let value = text;
  const hasComma = value.includes(',');
  const hasDot = value.includes('.');
  if (hasComma && hasDot) {
    value = value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '');
  } else if (hasComma) {
    value = value.replace(/,/g, '.');
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Fechas de MT5 (`2024.11.24 10:00`), ISO, `24.11.2024`, epoch en s o ms. */
export function parseTime(raw: string): number {
  const text = raw.trim().replace(/\u00a0/g, ' ');
  if (!text) return NaN;
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  if (/^\d{13}$/.test(text)) return Number(text);

  let m = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  m = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

type Layout = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dateColumn?: number;
  timeColumn?: number;
};

function mapHeader(cells: string[]): Layout | null {
  const names = cells.map(normalise);
  const find = (...keys: string[]): number =>
    names.findIndex((name) => keys.some((key) => name === key || name.startsWith(key)));

  const date = find('date', 'fecha', 'datetime', 'fechahora');
  const clockColumn = find('time', 'hora');
  const open = find('open', 'apertura');
  const high = find('high', 'maximo', 'max');
  const low = find('low', 'minimo', 'min');
  const close = find('close', 'cierre', 'last');
  if (open < 0 || high < 0 || low < 0 || close < 0 || date < 0) return null;

  return {
    time: -1,
    open,
    high,
    low,
    close,
    volume: find('volume', 'volumen', 'tickvol', 'vol', 'realvolume'),
    dateColumn: date,
    timeColumn: clockColumn >= 0 && clockColumn !== date ? clockColumn : undefined,
  };
}

/** Carga un CSV de velas y devuelve columnas tipadas ordenadas por tiempo. */
export function parseCsv(text: string, filename: string): Parsed {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && !lines[first].trim()) first++;
  if (first >= lines.length) throw new Error('El archivo está vacío.');
  const header = lines[first];
  const sep = detectSeparator(header);
  const headerCells = header.split(sep);

  let layout = mapHeader(headerCells);
  let startLine = first + 1;
  if (!layout) {
    // Sin cabecera: se asume Date;Open;High;Low;Close;Volume
    if (!Number.isNaN(parseTime(headerCells[0] ?? ''))) {
      layout = { time: -1, open: 1, high: 2, low: 3, close: 4, volume: 5 };
      startLine = first;
    } else {
      throw new Error('No encuentro las columnas Open/High/Low/Close ni una fecha válida.');
    }
  }

  const maxColumns = 8;
  const times: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const cells = line.split(sep);
    if (cells.length < 5) continue;

    let stamp: number;
    if (layout.dateColumn !== undefined) {
      const dateText = cells[layout.dateColumn] ?? '';
      stamp = parseTime(dateText);
      if (layout.timeColumn !== undefined && !/\d{1,2}:\d{2}/.test(dateText)) {
        stamp = parseTime(`${dateText.split(' ')[0]} ${cells[layout.timeColumn] ?? '00:00'}`);
      }
    } else {
      stamp = parseTime(cells[0] ?? '');
    }

    const o = parseNumber(cells[layout.open] ?? '');
    const h = parseNumber(cells[layout.high] ?? '');
    const l = parseNumber(cells[layout.low] ?? '');
    const c = parseNumber(cells[layout.close] ?? '');
    if (!Number.isFinite(stamp) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;

    times.push(stamp);
    opens.push(o);
    highs.push(h);
    lows.push(l);
    closes.push(c);
    volumes.push(layout.volume >= 0 ? parseNumber(cells[layout.volume] ?? '') || 0 : 0);

    if (times.length > 20_000_000) throw new Error('El archivo es demasiado grande.');
    void maxColumns;
  }

  if (times.length === 0) throw new Error('No hay velas válidas en el archivo.');

  // Orden ascendente por tiempo y sin duplicados.
  const order = new Array<number>(times.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  let sorted = true;
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) {
      sorted = false;
      break;
    }
  }
  if (!sorted) order.sort((a, b) => times[a] - times[b]);

  const n = times.length;
  const columns: Columns = {
    time: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    volume: new Float64Array(n),
  };

  let kept = 0;
  let last = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const t = times[i];
    if (t === last) continue;
    last = t;
    columns.time[kept] = t;
    columns.open[kept] = opens[i];
    columns.high[kept] = highs[i];
    columns.low[kept] = lows[i];
    columns.close[kept] = closes[i];
    columns.volume[kept] = volumes[i];
    kept++;
  }

  const trimmed: Columns = {
    time: columns.time.subarray(0, kept),
    open: columns.open.subarray(0, kept),
    high: columns.high.subarray(0, kept),
    low: columns.low.subarray(0, kept),
    close: columns.close.subarray(0, kept),
    volume: columns.volume.subarray(0, kept),
  };

  return {
    symbol: symbolFromName(filename),
    timeframe: timeframeFromName(filename),
    count: kept,
    from: trimmed.time[0],
    to: trimmed.time[kept - 1],
    columns: trimmed,
  };
}

export function toBars(columns: Columns): Bar[] {
  const n = columns.time.length;
  const bars: Bar[] = new Array(n);
  for (let i = 0; i < n; i++) {
    bars[i] = {
      time: columns.time[i],
      open: columns.open[i],
      high: columns.high[i],
      low: columns.low[i],
      close: columns.close[i],
      volume: columns.volume[i],
    };
  }
  return bars;
}
