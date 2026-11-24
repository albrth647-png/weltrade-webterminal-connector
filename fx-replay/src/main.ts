import { ChartWidget } from '@tradecanvas/chart/widget';
import { es } from '@tradecanvas/chart/widget/locales';
import { PaperExecutionAdapter } from '@tradecanvas/chart';
import type { FillEvent, OHLCBar, SymbolInfo, TimeFrame, TradingPosition } from '@tradecanvas/chart';
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
  libBtn: document.getElementById('btnLib') as HTMLButtonElement,
  lib: document.getElementById('lib') as HTMLDialogElement,
  libClose: document.getElementById('libClose') as HTMLButtonElement,
  libList: document.getElementById('libList') as HTMLElement,
  libNote: document.getElementById('libNote') as HTMLElement,
  libImport: document.getElementById('libImport') as HTMLButtonElement,
  libWipe: document.getElementById('libWipe') as HTMLButtonElement,
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
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise<Parsed>((resolve, reject) => {
        const id = ++jobId;
        jobs.set(id, { resolve, reject });
        worker.postMessage({ id, buffer, name: file.name }, [buffer]);
      }),
  );
}

async function importFiles(files: FileList): Promise<void> {
  const list = Array.from(files);
  if (list.length === 0) return;
  const total = list.length;
  let saved = 0;
  let largest: string | null = null;
  let largestCount = 0;
  const failures: string[] = [];
  try {
    for (let i = 0; i < total; i++) {
      const file = list[i];
      const label = total > 1 ? ` (${i + 1}/${total})` : '';
      showProgress(`Leyendo ${file.name}${label}…`);
      let parsed: Parsed;
      try {
        parsed = await parseFile(file);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : 'error'}`);
        continue;
      }
      showProgress(`Guardando ${parsed.symbol} · ${parsed.count.toLocaleString('es-ES')} velas${label}…`);
      const record: store.DatasetRecord = {
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        count: parsed.count,
        from: parsed.from,
        to: parsed.to,
        savedAt: Date.now(),
        columns: parsed.columns,
      };
      await store.saveDataset(record);
      saved++;
      if (record.count > largestCount) {
        largestCount = record.count;
        largest = record.symbol;
      }
      // Deja respirar a la interfaz entre archivos grandes.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    if (saved === 0) {
      throw new Error(failures[0] ?? 'No hay datos que guardar.');
    }
    const current = await store.getMeta<string>('active');
    if (!current && largest) await store.setMeta('active', largest);
    hideProgress();
    if (failures.length > 0) {
      toast(`${saved} de ${total} archivos importados. Falló: ${failures[0]}`);
    } else {
      toast(total === 1 ? `${largestCount.toLocaleString('es-ES')} velas guardadas` : `${saved} activos guardados en el móvil`);
    }
    window.setTimeout(() => window.location.reload(), failures.length > 0 ? 2500 : 600);
  } catch (error) {
    hideProgress();
    toast(error instanceof Error ? error.message : 'Error al importar');
  }
}

/* --------------------------------- gráfico -------------------------------- */

const TF_MINUTES: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

const ALL_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h'] as const;

/** `1m` → `M1`, `1h` → `H1` (para que no se confunda con «1 millón»). */
function tfLabel(tf: string): string {
  const match = tf.match(/^(\d+)([mhd])$/i);
  return match ? `${match[2].toUpperCase()}${match[1]}` : tf.toUpperCase();
}

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
  el.sub.textContent = `${record.count.toLocaleString('es-ES')} velas ${tfLabel(record.timeframe)} · ${new Date(record.from).toLocaleDateString('es-ES')} → ${new Date(record.to).toLocaleDateString('es-ES')}`;
  el.empty.hidden = true;

  // La base es la temporalidad real del archivo; arriba de ella se remuestrea.
  const baseTf = (TF_MINUTES[record.timeframe] ? record.timeframe : '1m') as TimeFrame;
  const baseMinutes = TF_MINUTES[baseTf];
  const timeframes = ALL_TIMEFRAMES.filter((tf) => TF_MINUTES[tf] >= baseMinutes);

  widget = new ChartWidget(el.chart, {
    symbol: record.symbol,
    timeframe: baseTf,
    theme: 'dark',
    locale: 'es',
    messages: es,
    trading: true,
    resampleTimeframes: true,
    customTimeframes: false,
    timeframes: [...timeframes],
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
  const stepMs = baseMinutes * 60_000;
  requestAnimationFrame(() => {
    const chart = widget?.getChart();
    if (!chart) return;
    chart.setVisibleRange(from, last.time + stepMs);
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

/* -------------------------------- biblioteca ------------------------------ */

function mb(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function renderLibrary(): Promise<void> {
  const list = await store.listDatasets();
  if (list.length === 0) {
    el.libList.innerHTML = '<p class="empty-note">Todavía no has importado ningún activo.</p>';
  } else {
    el.libList.innerHTML = list
      .map((d) => {
        const active = d.symbol === dataset?.symbol ? ' active' : '';
        return `<div class="lib-item${active}">
          <button class="lib-main" data-sym="${d.symbol}">
            <b>${d.symbol}</b>
            <span>${d.count.toLocaleString('es-ES')} velas ${tfLabel(d.timeframe)} · ${formatDate(d.from)} → ${formatDate(d.to)}</span>
          </button>
          <button class="lib-del" data-del="${d.symbol}" aria-label="Borrar ${d.symbol}">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </div>`;
      })
      .join('');
  }

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const used = estimate?.usage ? `${mb(estimate.usage)} usados` : '';
  el.libNote.textContent = list.length === 0 ? '' : `${list.length} ${list.length === 1 ? 'activo' : 'activos'}${used ? ` · ${used}` : ''}`;

  el.libList.querySelectorAll<HTMLButtonElement>('[data-sym]').forEach((button) => {
    button.addEventListener('click', () => void switchTo(button.dataset.sym ?? ''));
  });
  el.libList.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((button) => {
    button.addEventListener('click', () => void removeDataset(button.dataset.del ?? ''));
  });
}

async function switchTo(symbol: string): Promise<void> {
  if (!symbol || symbol === dataset?.symbol) {
    el.lib.close();
    return;
  }
  await store.setMeta('active', symbol);
  window.location.reload();
}

async function removeDataset(symbol: string): Promise<void> {
  if (!window.confirm(`¿Borrar ${symbol} del móvil? Se pueden volver a importar los archivos.`)) return;
  const wasActive = symbol === dataset?.symbol;
  await store.deleteDataset(symbol);
  const rest = await store.listDatasets();
  if (wasActive) {
    const next = rest[0];
    if (next) await store.setMeta('active', next.symbol);
    else await store.setMeta('active', '');
    window.location.reload();
    return;
  }
  await renderLibrary();
}

/* --------------------------------- arranque ------------------------------- */

async function setupNativeShell(): Promise<void> {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return;
  document.body.classList.add('native');
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#0b0e13' });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Sin plugin: el CSS ya reserva el hueco de la barra de estado.
  }
}

async function boot(): Promise<void> {
  void setupNativeShell();
  el.pick.addEventListener('click', () => el.file.click());
  el.importBtn.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    if (el.file.files) void importFiles(el.file.files);
    el.file.value = '';
  });

  el.libBtn.addEventListener('click', () => {
    el.lib.showModal();
    void renderLibrary();
  });
  el.libClose.addEventListener('click', () => el.lib.close());
  el.libImport.addEventListener('click', () => {
    el.lib.close();
    el.file.click();
  });
  el.libWipe.addEventListener('click', async () => {
    if (!window.confirm('¿Borrar todos los activos y el diario de este móvil?')) return;
    for (const item of await store.listDatasets()) await store.deleteDataset(item.symbol);
    await store.clearTrades();
    await store.setMeta('active', '');
    window.location.reload();
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
