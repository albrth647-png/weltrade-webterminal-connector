import { ChartWidget } from '@tradecanvas/chart/widget';
import { es } from '@tradecanvas/chart/widget/locales';
import { PaperExecutionAdapter } from '@tradecanvas/chart';
import type { FillEvent, OHLCBar, SymbolInfo, TradingPosition } from '@tradecanvas/chart';
import { toBars, type Parsed } from './data/csv';
import * as store from './data/db';
import type { TradeRecord } from './data/db';
import { computeStats, formatDate, formatPrice, formatSigned } from './app/journal';
import './styles.css';

const el = {
  chart: document.getElementById('chart') as HTMLElement,
  empty: document.getElementById('empty') as HTMLElement,
  sym: document.getElementById('sym') as HTMLElement,
  sub: document.getElementById('sub') as HTMLElement,
  file: document.getElementById('file') as HTMLInputElement,
  pick: document.getElementById('btnPick') as HTMLButtonElement,
  importBtn: document.getElementById('btnImport') as HTMLButtonElement,
  replay: document.getElementById('btnReplay') as HTMLButtonElement,
  ops: document.getElementById('btnOps') as HTMLButtonElement,
  opsBadge: document.getElementById('opsBadge') as HTMLElement,
  sheet: document.getElementById('ops') as HTMLDialogElement,
  sheetClose: document.getElementById('opsClose') as HTMLButtonElement,
  stats: document.getElementById('stats') as HTMLElement,
  tradeList: document.getElementById('tradeList') as HTMLElement,
  exportBtn: document.getElementById('btnExport') as HTMLButtonElement,
  wipe: document.getElementById('btnWipe') as HTMLButtonElement,
  progress: document.getElementById('progress') as HTMLElement,
  progressText: document.getElementById('progressText') as HTMLElement,
  toast: document.getElementById('toast') as HTMLElement,
};

let widget: ChartWidget | null = null;
let paper: PaperExecutionAdapter | null = null;
let dataset: store.DatasetRecord | null = null;
let bars: OHLCBar[] = [];
let visibleFrom = 0;
let openPosition: { id: string; entry: number; sl?: number; tp?: number; quantity: number; side: 'buy' | 'sell'; openedAt: number } | null = null;

function toast(message: string): void {
  el.toast.textContent = message;
  el.toast.classList.add('on');
  window.clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => el.toast.classList.remove('on'), 2600);
}

function showProgress(text: string): void {
  el.progressText.textContent = text;
  el.progress.hidden = false;
}

function hideProgress(): void {
  el.progress.hidden = true;
}

/* ---------------------------------- datos --------------------------------- */

const worker = new Worker(new URL('./data/parse.worker.ts', import.meta.url), { type: 'module' });
let jobId = 0;
const jobs = new Map<number, { resolve: (v: Parsed) => void; reject: (e: Error) => void }>();

worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; parsed?: Parsed; error?: string }>) => {
  const job = jobs.get(event.data.id);
  if (!job) return;
  jobs.delete(event.data.id);
  if (event.data.ok && event.data.parsed) job.resolve(event.data.parsed);
  else job.reject(new Error(event.data.error ?? 'No se pudo leer el CSV'));
};

function parseFile(file: File): Promise<Parsed> {
  return file.text().then(
    (text) =>
      new Promise<Parsed>((resolve, reject) => {
        const id = ++jobId;
        jobs.set(id, { resolve, reject });
        worker.postMessage({ id, text, name: file.name });
      }),
  );
}

async function importFiles(files: FileList): Promise<void> {
  const list = Array.from(files);
  if (list.length === 0) return;
  try {
    let best: store.DatasetRecord | null = null;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      showProgress(`Leyendo ${file.name} (${Math.round(file.size / 1048576)} MB)…`);
      const parsed = await parseFile(file);
      showProgress(`Guardando ${parsed.count.toLocaleString('es-ES')} velas…`);
      const record: store.DatasetRecord = {
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        count: parsed.count,
        from: parsed.from,
        to: parsed.to,
        savedAt: Date.now(),
        columns: parsed.columns,
      };
      if (!best || record.count > best.count) best = record;
    }
    if (!best) throw new Error('No hay datos que guardar.');
    await store.saveDataset(best, true);
    await store.setMeta('active', best.symbol);
    hideProgress();
    toast(`${best.count.toLocaleString('es-ES')} velas guardadas en el móvil`);
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    hideProgress();
    toast(error instanceof Error ? error.message : 'Error al importar');
  }
}

/* --------------------------------- gráfico -------------------------------- */

const BASE_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'] as const;

function createChart(record: store.DatasetRecord): void {
  dataset = record;
  bars = toBars(record.columns);
  const info: SymbolInfo = {
    symbol: record.symbol,
    description: record.symbol,
    type: 'forex',
    pricePrecision: 2,
    currency: 'USD',
  };

  el.sym.textContent = record.symbol;
  el.sub.textContent = `${record.count.toLocaleString('es-ES')} velas · ${new Date(record.from).toLocaleDateString('es-ES')} → ${new Date(record.to).toLocaleDateString('es-ES')}`;
  el.empty.hidden = true;

  widget = new ChartWidget(el.chart, {
    symbol: record.symbol,
    timeframe: '1m',
    theme: 'dark',
    locale: 'es',
    messages: es,
    trading: true,
    resampleTimeframes: true,
    customTimeframes: false,
    timeframes: [...BASE_TIMEFRAMES],
    symbols: [info],
    features: {
      // Nada automático: sin fibs automáticos, sin niveles, sin indicadores añadidos solos.
      autoFib: false,
      symbolSearch: false,
      'toolbar.symbol': false,
    },
  });

  widget.setData(bars);

  const last = bars[bars.length - 1];
  const from = bars[Math.max(0, bars.length - 460)].time;
  requestAnimationFrame(() => {
    const chart = widget?.getChart();
    if (!chart) return;
    chart.setVisibleRange(from, last.time + 60_000);
  });

  paper = new PaperExecutionAdapter({ markPrice: last.close });
  widget.getChart().connectExecution(paper, { brackets: 'place' });
  paper.setMarkPrice(last.close, last.time);

  paper.on<FillEvent>('fill', (event) => {
    void onFill(event.data);
  });
  paper.on<TradingPosition[]>('positions', (event) => {
    if (!openPosition) return;
    const match = event.data.find((p) => p.id === openPosition?.id);
    if (match) {
      openPosition.sl = match.stopLoss;
      openPosition.tp = match.takeProfit;
    }
  });

  const chart = widget.getChart();
  (window as unknown as Record<string, unknown>).__fxr = { widget, chart, paper, bars, store };
  chart.on('visibleRangeChange', (payload: unknown) => {
    const p = payload as { from?: number; to?: number; fromTime?: number };
    const value = p?.from ?? p?.fromTime;
    if (typeof value === 'number' && Number.isFinite(value)) visibleFrom = value;
  });
}

function indexAtOrAfter(time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time >= time) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

/* -------------------------------- ejecución ------------------------------- */

async function onFill(event: FillEvent): Promise<void> {
  const closes = event.pnl !== undefined || event.reason === 'close' || event.reason === 'stopLoss' || event.reason === 'takeProfit' || event.reason === 'reverse';

  if (!closes) {
    openPosition = {
      id: event.positionId ?? event.orderId,
      entry: event.price,
      quantity: event.quantity,
      side: event.side === 'sell' ? 'sell' : 'buy',
      openedAt: event.time,
    };
    return;
  }

  const position = openPosition;
  const risk = position && position.sl !== undefined ? Math.abs(position.entry - position.sl) * position.quantity : 0;
  const pnl = event.pnl ?? 0;
  const trade: TradeRecord = {
    symbol: dataset?.symbol ?? '',
    side: position?.side ?? (event.side === 'sell' ? 'buy' : 'sell'),
    entry: position?.entry ?? event.price,
    exit: event.price,
    stopLoss: position?.sl,
    takeProfit: position?.tp,
    quantity: position?.quantity ?? event.quantity,
    pnl,
    risk,
    r: risk > 0 ? pnl / risk : null,
    openedAt: position?.openedAt ?? event.time,
    closedAt: event.time,
    reason: event.reason ?? 'close',
  };
  openPosition = null;
  await store.addTrade(trade);
  await refreshBadge();
  if (el.sheet.open) await renderJournal();
}

async function refreshBadge(): Promise<void> {
  const trades = await store.listTrades();
  el.opsBadge.textContent = String(trades.length);
  el.opsBadge.hidden = trades.length === 0;
}

/* ---------------------------------- diario -------------------------------- */

function statCard(label: string, value: string, tone?: 'pos' | 'neg'): string {
  return `<div><span>${label}</span><strong class="${tone ?? ''}">${value}</strong></div>`;
}

async function renderJournal(): Promise<void> {
  const trades = await store.listTrades();
  const s = computeStats(trades);
  const pf = s.profitFactor === null ? '—' : s.profitFactor.toFixed(2);
  el.stats.innerHTML = [
    statCard('Ops', String(s.trades)),
    statCard('Aciertos', `${s.winRate.toFixed(0)}%`),
    statCard('Profit factor', pf),
    statCard('Neto', formatSigned(s.net), s.net >= 0 ? 'pos' : 'neg'),
    statCard('R medio', s.rAverage === null ? '—' : formatSigned(s.rAverage, 2), (s.rAverage ?? 0) >= 0 ? 'pos' : 'neg'),
    statCard('Mejor racha', String(s.maxStreak)),
  ].join('');

  if (trades.length === 0) {
    el.tradeList.innerHTML = '<p class="empty-note">Todavía no hay operaciones cerradas.</p>';
    return;
  }

  el.tradeList.innerHTML = trades
    .slice()
    .reverse()
    .map((t) => {
      const tone = t.pnl >= 0 ? 'pos' : 'neg';
      const r = t.r === null ? '' : ` · ${formatSigned(t.r, 2)}R`;
      return `<article class="trade">
        <div><b>${t.side === 'buy' ? 'Compra' : 'Venta'}</b> <span class="meta">${formatPrice(t.entry)} → ${formatPrice(t.exit)}${r}</span></div>
        <div class="pnl ${tone}">${formatSigned(t.pnl)}</div>
        <span class="tag">${t.reason}</span>
        <span class="meta" style="text-align:right">${formatDate(t.closedAt)}</span>
      </article>`;
    })
    .join('');
}

/* --------------------------------- arranque ------------------------------- */

async function boot(): Promise<void> {
  el.pick.addEventListener('click', () => el.file.click());
  el.importBtn.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    if (el.file.files) void importFiles(el.file.files);
    el.file.value = '';
  });

  el.ops.addEventListener('click', () => {
    el.sheet.showModal();
    void renderJournal();
  });
  el.sheetClose.addEventListener('click', () => el.sheet.close());

  el.wipe.addEventListener('click', async () => {
    if (!window.confirm('¿Borrar todo el diario de operaciones?')) return;
    await store.clearTrades();
    await refreshBadge();
    await renderJournal();
  });

  el.exportBtn.addEventListener('click', async () => {
    const trades = await store.listTrades();
    const blob = new Blob([JSON.stringify(trades, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fx-replay-diario-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  el.replay.addEventListener('click', () => {
    if (!widget || !bars.length) return;
    const start = indexAtOrAfter(visibleFrom || bars[Math.max(0, bars.length - 460)].time);
    widget.replayFrom(start, false);
  });

  await refreshBadge();

  const active = await store.getMeta<string>('active');
  const datasets = await store.listDatasets();
  const chosen = (active && datasets.find((d) => d.symbol === active)) ?? datasets[0];
  if (chosen) createChart(chosen);
  else el.empty.hidden = false;

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

void boot();
