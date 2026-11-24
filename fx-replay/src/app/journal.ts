import type { TradeRecord } from '../data/db';

export type Stats = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  net: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number | null;
  rTotal: number;
  rAverage: number | null;
  best: number | null;
  worst: number | null;
  maxStreak: number;
  maxDrawdown: number;
  byReason: Record<string, number>;
};

export function computeStats(trades: TradeRecord[]): Stats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const net = trades.reduce((sum, t) => sum + t.pnl, 0);
  const withR = trades.filter((t) => t.r !== null && Number.isFinite(t.r));
  const rTotal = withR.reduce((sum, t) => sum + (t.r as number), 0);

  let streak = 0;
  let maxStreak = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      streak = Math.max(1, streak + 1);
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const byReason: Record<string, number> = {};
  for (const trade of trades) byReason[trade.reason] = (byReason[trade.reason] ?? 0) + 1;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    net,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    rTotal,
    rAverage: withR.length ? rTotal / withR.length : null,
    best: trades.length ? Math.max(...trades.map((t) => t.pnl)) : null,
    worst: trades.length ? Math.min(...trades.map((t) => t.pnl)) : null,
    maxStreak,
    maxDrawdown,
    byReason,
  };
}

export function formatPrice(value: number, digits = 2): string {
  return value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSigned(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : '';
  return sign + formatPrice(value, digits);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
