import type { DisplayCurrency, SupportedCurrency } from '../types';

export const DEFAULT_AED_TO_IDR_RATE = 4350;
const USD_TO_IDR_RATE = 15950;
const SGD_TO_IDR_RATE = 11900;
const EUR_TO_IDR_RATE = 17150;

export const DEFAULT_FX_RATES_TO_IDR: Record<SupportedCurrency, number> = {
  AED: DEFAULT_AED_TO_IDR_RATE,
  IDR: 1,
  USD: USD_TO_IDR_RATE,
  SGD: SGD_TO_IDR_RATE,
  EUR: EUR_TO_IDR_RATE,
};

export function convertCurrency(
  amount: number,
  from: SupportedCurrency,
  to: DisplayCurrency,
  rateOrMap: number | Partial<Record<SupportedCurrency, number>> = DEFAULT_AED_TO_IDR_RATE
): number {
  if (from === to) return amount;

  const rates: Record<SupportedCurrency, number> =
    typeof rateOrMap === 'number'
      ? {
          ...DEFAULT_FX_RATES_TO_IDR,
          AED: rateOrMap > 0 ? rateOrMap : DEFAULT_AED_TO_IDR_RATE,
        }
      : {
          AED: rateOrMap.AED && rateOrMap.AED > 0 ? rateOrMap.AED : DEFAULT_AED_TO_IDR_RATE,
          IDR: 1,
          USD: rateOrMap.USD && rateOrMap.USD > 0 ? rateOrMap.USD : USD_TO_IDR_RATE,
          SGD: rateOrMap.SGD && rateOrMap.SGD > 0 ? rateOrMap.SGD : SGD_TO_IDR_RATE,
          EUR: rateOrMap.EUR && rateOrMap.EUR > 0 ? rateOrMap.EUR : EUR_TO_IDR_RATE,
        };

  const inIdr = amount * (rates[from] ?? 1);
  if (to === 'IDR') return inIdr;
  return inIdr / (rates[to] ?? 1);
}

export function formatMoney(amount: number, currency: SupportedCurrency | DisplayCurrency): string {
  if (currency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatShortMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'short',
    year: '2-digit',
  }).format(date);
}

export function formatRelativeTimestamp(isoString: string): string {
  if (!isoString) return 'Belum pernah';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return isoString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}
