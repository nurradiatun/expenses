import {
  formatAccountProviderLabel,
  type AccountProvider,
  type CustomCategory,
  type DisplayCurrency,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
} from '../types';
import {
  convertCurrency,
  formatMoney,
  formatMonthLabel,
  formatShortDate,
} from './formatters';
import { resolveCategoryAppearance } from './categoryVisuals';

export type InsightScope = 'month' | '3m' | 'all';
export type InsightTone = 'positive' | 'warning' | 'neutral';

export interface InsightNotice {
  id: string;
  tone: InsightTone;
  topic: string;
  title: string;
  description: string;
  metricLabel?: string;
}

export interface CategoryComparisonRow {
  category: string;
  currentTotal: number;
  previousTotal: number;
  deltaAmount: number;
  deltaPct: number | null;
  sharePct: number;
  txCount: number;
  color: string;
  iconKey?: string;
}

export interface WeekdaySpendBucket {
  dayIndex: number; // 0=Sen .. 6=Min
  label: string;
  total: number;
  count: number;
  avgPerTx: number;
  isWeekend: boolean;
}

export interface MerchantInsightRow {
  merchantKey: string;
  merchantName: string;
  category: string;
  total: number;
  count: number;
  sharePct: number;
  avgAmount: number;
  lastDate: string;
  color: string;
  iconKey?: string;
}

export interface RecurringSpendCandidate {
  merchantName: string;
  category: string;
  monthsCount: number;
  txCount: number;
  avgAmount: number;
  totalAmount: number;
  lastDate: string;
}

export interface FundingSourceSplitRow {
  accountId: string;
  accountName: string;
  providerLabel: string;
  expenseTotal: number;
  incomeTotal: number;
  txCount: number;
  expenseSharePct: number;
}

export interface FinancialInsightReport {
  scope: InsightScope;
  activeMonth: string;
  previousMonth: string;
  periodLabel: string;
  totalTxCount: number;
  expenseTxCount: number;
  incomeTxCount: number;
  totalIncome: number;
  totalExpense: number;
  netCashFlow: number;
  savingsRatePct: number | null;
  previousExpense: number;
  previousIncome: number;
  expenseDeltaPct: number | null;
  avgDailyExpense: number;
  projectedMonthExpense: number | null;
  activeDaysCount: number;
  largestExpenseTx: {
    id: string;
    merchant: string;
    description: string;
    category: string;
    date: string;
    convertedAmount: number;
  } | null;
  weekendAvgPerDay: number;
  weekdayAvgPerDay: number;
  topWeekday: WeekdaySpendBucket | null;
  weekdayBuckets: WeekdaySpendBucket[];
  categoryComparisons: CategoryComparisonRow[];
  topMerchants: MerchantInsightRow[];
  recurringCandidates: RecurringSpendCandidate[];
  fundingSourceSplits: FundingSourceSplitRow[];
  notices: InsightNotice[];
}

const WEEKDAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1 + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function parseIsoDayIndexMonFirst(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const jsDay = dt.getDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 6 : jsDay - 1; // 0=Sen..6=Min
}

function normalizeMerchantLabel(tx: FinancialTransaction): string {
  const raw = (tx.merchant || tx.description || 'Tanpa Nama').trim().replace(/\s+/g, ' ');
  return raw || 'Tanpa Nama';
}

export function computeFinancialInsights(params: {
  transactions: FinancialTransaction[];
  accounts: FinancialAccount[];
  customCategories?: CustomCategory[];
  displayCurrency: DisplayCurrency;
  rateInput: number | Partial<Record<SupportedCurrency, number>>;
  selectedMonth: string;
  scope: InsightScope;
}): FinancialInsightReport {
  const {
    transactions,
    accounts,
    customCategories = [],
    displayCurrency,
    rateInput,
    selectedMonth,
    scope,
  } = params;

  const activeMonth = selectedMonth || new Date().toISOString().slice(0, 7);
  const previousMonth = shiftMonthKey(activeMonth, -1);

  const monthSetFor3M = new Set([
    activeMonth,
    shiftMonthKey(activeMonth, -1),
    shiftMonthKey(activeMonth, -2),
  ]);
  const prevMonthSetFor3M = new Set([
    shiftMonthKey(activeMonth, -3),
    shiftMonthKey(activeMonth, -4),
    shiftMonthKey(activeMonth, -5),
  ]);

  const toDisplay = (amount: number, currency: SupportedCurrency) =>
    convertCurrency(amount, currency, displayCurrency, rateInput);

  const scopedTxs = transactions.filter((tx) => {
    if (scope === 'all') return true;
    if (scope === '3m') return monthSetFor3M.has(tx.monthKey);
    return tx.monthKey === activeMonth;
  });

  const comparisonTxs = transactions.filter((tx) => {
    if (scope === 'all') return false;
    if (scope === '3m') return prevMonthSetFor3M.has(tx.monthKey);
    return tx.monthKey === previousMonth;
  });

  const periodLabel =
    scope === 'all'
      ? 'Semua Periode'
      : scope === '3m'
        ? `3 Bulan hingga ${formatMonthLabel(activeMonth)}`
        : formatMonthLabel(activeMonth);

  let totalIncome = 0;
  let totalExpense = 0;
  let expenseTxCount = 0;
  let incomeTxCount = 0;
  const activeDates = new Set<string>();
  const weekdayActiveDays = Array.from({ length: 7 }, () => new Set<string>());
  const weekdayTotals = new Array<number>(7).fill(0);
  const weekdayCounts = new Array<number>(7).fill(0);

  let largestExpenseTx: FinancialInsightReport['largestExpenseTx'] = null;

  const currentCatMap = new Map<string, { total: number; count: number }>();
  const prevCatMap = new Map<string, number>();

  const merchantMap = new Map<
    string,
    {
      merchantName: string;
      category: string;
      total: number;
      count: number;
      lastDate: string;
    }
  >();

  const accountMap = new Map<string, FinancialAccount>();
  for (const acc of accounts) accountMap.set(acc.id, acc);

  const accountSplitMap = new Map<
    string,
    { expenseTotal: number; incomeTotal: number; txCount: number }
  >();

  for (const tx of scopedTxs) {
    const val = toDisplay(tx.amount, tx.currency);
    if (tx.date) activeDates.add(tx.date);

    const accEntry = accountSplitMap.get(tx.accountId) || {
      expenseTotal: 0,
      incomeTotal: 0,
      txCount: 0,
    };
    accEntry.txCount += 1;

    if (tx.txType === 'income') {
      incomeTxCount += 1;
      totalIncome += val;
      accEntry.incomeTotal += val;
    } else {
      expenseTxCount += 1;
      totalExpense += val;
      accEntry.expenseTotal += val;

      const catName = tx.category || 'Lainnya';
      const catEntry = currentCatMap.get(catName) || { total: 0, count: 0 };
      catEntry.total += val;
      catEntry.count += 1;
      currentCatMap.set(catName, catEntry);

      if (!largestExpenseTx || val > largestExpenseTx.convertedAmount) {
        largestExpenseTx = {
          id: tx.id,
          merchant: normalizeMerchantLabel(tx),
          description: tx.description,
          category: catName,
          date: tx.date,
          convertedAmount: val,
        };
      }

      const dayIdx = parseIsoDayIndexMonFirst(tx.date);
      if (dayIdx !== null) {
        weekdayTotals[dayIdx] += val;
        weekdayCounts[dayIdx] += 1;
        weekdayActiveDays[dayIdx].add(tx.date);
      }

      const merchantName = normalizeMerchantLabel(tx);
      const mKey = merchantName.toLowerCase();
      const prevM = merchantMap.get(mKey);
      if (!prevM) {
        merchantMap.set(mKey, {
          merchantName,
          category: catName,
          total: val,
          count: 1,
          lastDate: tx.date,
        });
      } else {
        prevM.total += val;
        prevM.count += 1;
        if (tx.date > prevM.lastDate) {
          prevM.lastDate = tx.date;
          prevM.category = catName;
        }
      }
    }

    accountSplitMap.set(tx.accountId, accEntry);
  }

  let previousIncome = 0;
  let previousExpense = 0;
  for (const tx of comparisonTxs) {
    const val = toDisplay(tx.amount, tx.currency);
    if (tx.txType === 'income') {
      previousIncome += val;
    } else {
      previousExpense += val;
      const catName = tx.category || 'Lainnya';
      prevCatMap.set(catName, (prevCatMap.get(catName) || 0) + val);
    }
  }

  const netCashFlow = totalIncome - totalExpense;
  const savingsRatePct =
    totalIncome > 0 ? Math.max(-200, Math.min(100, (netCashFlow / totalIncome) * 100)) : null;

  const expenseDeltaPct =
    scope !== 'all' && previousExpense > 0
      ? ((totalExpense - previousExpense) / previousExpense) * 100
      : null;

  // Determine active day span for daily burn rate
  const distinctDaysInScope = Math.max(activeDates.size, 1);
  let daysForPace = distinctDaysInScope;
  if (scope === 'month') {
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    if (activeMonth === currentMonthKey) {
      daysForPace = Math.max(new Date().getDate(), 1);
    } else {
      daysForPace = daysInMonth(activeMonth);
    }
  }
  const avgDailyExpense = expenseTxCount > 0 ? totalExpense / daysForPace : 0;
  const projectedMonthExpense =
    scope === 'month' && expenseTxCount > 0
      ? avgDailyExpense * daysInMonth(activeMonth)
      : null;

  const weekdayBuckets: WeekdaySpendBucket[] = WEEKDAY_LABELS.map((label, idx) => ({
    dayIndex: idx,
    label,
    total: weekdayTotals[idx],
    count: weekdayCounts[idx],
    avgPerTx: weekdayCounts[idx] > 0 ? weekdayTotals[idx] / weekdayCounts[idx] : 0,
    isWeekend: idx >= 5,
  }));

  let weekdayDayCount = 0;
  let weekdaySpendSum = 0;
  let weekendDayCount = 0;
  let weekendSpendSum = 0;
  for (let i = 0; i < 7; i += 1) {
    if (i < 5) {
      weekdaySpendSum += weekdayTotals[i];
      weekdayDayCount += weekdayActiveDays[i].size;
    } else {
      weekendSpendSum += weekdayTotals[i];
      weekendDayCount += weekdayActiveDays[i].size;
    }
  }
  const weekdayAvgPerDay = weekdayDayCount > 0 ? weekdaySpendSum / weekdayDayCount : 0;
  const weekendAvgPerDay = weekendDayCount > 0 ? weekendSpendSum / weekendDayCount : 0;

  const topWeekday =
    weekdayBuckets.reduce<WeekdaySpendBucket | null>((best, curr) => {
      if (curr.total <= 0) return best;
      if (!best || curr.total > best.total) return curr;
      return best;
    }, null);

  // Category comparison across current & previous period
  const allCatKeys = new Set<string>([
    ...Array.from(currentCatMap.keys()),
    ...Array.from(prevCatMap.keys()),
  ]);

  const categoryComparisons: CategoryComparisonRow[] = Array.from(allCatKeys)
    .map((cat) => {
      const curr = currentCatMap.get(cat) || { total: 0, count: 0 };
      const prev = prevCatMap.get(cat) || 0;
      const deltaAmount = curr.total - prev;
      const deltaPct = prev > 0 ? ((curr.total - prev) / prev) * 100 : null;
      const sharePct = totalExpense > 0 ? (curr.total / totalExpense) * 100 : 0;
      const appearance = resolveCategoryAppearance(cat, customCategories, 'expense');
      return {
        category: cat,
        currentTotal: curr.total,
        previousTotal: prev,
        deltaAmount,
        deltaPct,
        sharePct,
        txCount: curr.count,
        color: appearance.color,
        iconKey: appearance.iconKey,
      };
    })
    .filter((row) => row.currentTotal > 0 || row.previousTotal > 0)
    .sort((a, b) => b.currentTotal - a.currentTotal || b.previousTotal - a.previousTotal);

  const topMerchants: MerchantInsightRow[] = Array.from(merchantMap.entries())
    .map(([merchantKey, item]) => {
      const appearance = resolveCategoryAppearance(item.category, customCategories, 'expense');
      return {
        merchantKey,
        merchantName: item.merchantName,
        category: item.category,
        total: item.total,
        count: item.count,
        sharePct: totalExpense > 0 ? (item.total / totalExpense) * 100 : 0,
        avgAmount: item.count > 0 ? item.total / item.count : item.total,
        lastDate: item.lastDate,
        color: appearance.color,
        iconKey: appearance.iconKey,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // Detect recurring spend candidates across ALL transactions (appearing in >=2 months or >=3 times)
  const recurringMap = new Map<
    string,
    {
      merchantName: string;
      category: string;
      months: Set<string>;
      txCount: number;
      totalAmount: number;
      lastDate: string;
    }
  >();

  for (const tx of transactions) {
    if (tx.txType !== 'expense') continue;
    const merchantName = normalizeMerchantLabel(tx);
    const key = merchantName.toLowerCase();
    const val = toDisplay(tx.amount, tx.currency);
    const prev = recurringMap.get(key);
    if (!prev) {
      recurringMap.set(key, {
        merchantName,
        category: tx.category || 'Lainnya',
        months: new Set([tx.monthKey]),
        txCount: 1,
        totalAmount: val,
        lastDate: tx.date,
      });
    } else {
      prev.months.add(tx.monthKey);
      prev.txCount += 1;
      prev.totalAmount += val;
      if (tx.date > prev.lastDate) {
        prev.lastDate = tx.date;
        prev.category = tx.category || 'Lainnya';
      }
    }
  }

  const recurringCandidates: RecurringSpendCandidate[] = Array.from(recurringMap.values())
    .filter((entry) => entry.months.size >= 2 || entry.txCount >= 3)
    .map((entry) => ({
      merchantName: entry.merchantName,
      category: entry.category,
      monthsCount: entry.months.size,
      txCount: entry.txCount,
      avgAmount: entry.totalAmount / entry.txCount,
      totalAmount: entry.totalAmount,
      lastDate: entry.lastDate,
    }))
    .sort((a, b) => b.monthsCount - a.monthsCount || b.totalAmount - a.totalAmount)
    .slice(0, 6);

  // Funding source splits (ADCB vs Cash etc.)
  const fundingSourceSplits: FundingSourceSplitRow[] = Array.from(accountSplitMap.entries())
    .map(([accountId, split]) => {
      const acc = accountMap.get(accountId);
      const provider: AccountProvider = acc?.provider || 'OTHER';
      return {
        accountId,
        accountName: acc?.name || 'Sumber Dana Terhapus',
        providerLabel: formatAccountProviderLabel(provider),
        expenseTotal: split.expenseTotal,
        incomeTotal: split.incomeTotal,
        txCount: split.txCount,
        expenseSharePct: totalExpense > 0 ? (split.expenseTotal / totalExpense) * 100 : 0,
      };
    })
    .sort((a, b) => b.expenseTotal - a.expenseTotal || b.incomeTotal - a.incomeTotal);

  // Generate quantitative actionable notices
  const notices: InsightNotice[] = [];

  if (scopedTxs.length > 0) {
    // 1. Cashflow & Savings Rate
    if (totalIncome > 0 && savingsRatePct !== null) {
      if (netCashFlow >= 0) {
        notices.push({
          id: 'cashflow-surplus',
          tone: savingsRatePct >= 20 ? 'positive' : 'neutral',
          topic: 'Arus Kas & Tabungan',
          title: `Surplus ${formatMoney(netCashFlow, displayCurrency)} (${savingsRatePct.toFixed(1)}% tersimpan)`,
          description:
            savingsRatePct >= 20
              ? `Porsi tabungan Anda pada ${periodLabel} melampaui patokan sehat 20% dari total pemasukan ${formatMoney(totalIncome, displayCurrency)}.`
              : `Arus kas tetap positif, namun porsi tabungan masih di bawah 20%. Menyisihkan sedikit pengeluaran akan memperkuat cadangan.`,
          metricLabel: `${savingsRatePct.toFixed(1)}% rasio simpan`,
        });
      } else {
        notices.push({
          id: 'cashflow-deficit',
          tone: 'warning',
          topic: 'Arus Kas Defisit',
          title: `Pengeluaran melampaui pemasukan sebesar ${formatMoney(Math.abs(netCashFlow), displayCurrency)}`,
          description: `Total pengeluaran (${formatMoney(totalExpense, displayCurrency)}) lebih besar daripada pemasukan (${formatMoney(totalIncome, displayCurrency)}) pada ${periodLabel}.`,
          metricLabel: `Defisit ${formatMoney(Math.abs(netCashFlow), displayCurrency)}`,
        });
      }
    } else if (totalExpense > 0) {
      notices.push({
        id: 'expense-no-income',
        tone: 'neutral',
        topic: 'Arus Kas',
        title: `Total pengeluaran tercatat ${formatMoney(totalExpense, displayCurrency)}`,
        description: `Belum ada transaksi pemasukan tercatat pada ${periodLabel} untuk menghitung rasio tabungan otomatis.`,
        metricLabel: `${expenseTxCount} transaksi keluar`,
      });
    }

    // 2. Month-over-Month Expense Delta
    if (expenseDeltaPct !== null && previousExpense > 0) {
      const diff = totalExpense - previousExpense;
      if (expenseDeltaPct >= 15) {
        notices.push({
          id: 'mom-spike',
          tone: 'warning',
          topic: 'Perbandingan Periode',
          title: `Pengeluaran naik +${expenseDeltaPct.toFixed(1)}% dibanding periode sebelumnya`,
          description: `Belanja meningkat ${formatMoney(diff, displayCurrency)} dari ${formatMoney(previousExpense, displayCurrency)} menjadi ${formatMoney(totalExpense, displayCurrency)}.`,
          metricLabel: `+${expenseDeltaPct.toFixed(1)}%`,
        });
      } else if (expenseDeltaPct <= -10) {
        notices.push({
          id: 'mom-drop',
          tone: 'positive',
          topic: 'Efisiensi Pengeluaran',
          title: `Pengeluaran turun ${Math.abs(expenseDeltaPct).toFixed(1)}% dibanding periode sebelumnya`,
          description: `Anda menghemat ${formatMoney(Math.abs(diff), displayCurrency)} dibanding total ${formatMoney(previousExpense, displayCurrency)} sebelumnya.`,
          metricLabel: `${expenseDeltaPct.toFixed(1)}%`,
        });
      } else {
        notices.push({
          id: 'mom-steady',
          tone: 'neutral',
          topic: 'Stabilitas Belanja',
          title: `Pengeluaran relatif stabil (${expenseDeltaPct >= 0 ? '+' : ''}${expenseDeltaPct.toFixed(1)}%)`,
          description: `Selisih pengeluaran terhadap periode sebelumnya hanya ${formatMoney(Math.abs(diff), displayCurrency)}.`,
          metricLabel: `${expenseDeltaPct >= 0 ? '+' : ''}${expenseDeltaPct.toFixed(1)}%`,
        });
      }
    }

    // 3. Biggest Category Growth or Concentration
    const growingCategory = categoryComparisons
      .filter((c) => c.previousTotal > 0 && c.deltaAmount > 0 && (c.deltaPct ?? 0) >= 20)
      .sort((a, b) => b.deltaAmount - a.deltaAmount)[0];

    if (growingCategory && growingCategory.deltaPct !== null) {
      notices.push({
        id: 'category-growth',
        tone: 'warning',
        topic: 'Lonjakan Kategori',
        title: `${growingCategory.category} melonjak +${growingCategory.deltaPct.toFixed(1)}%`,
        description: `Kategori ini naik ${formatMoney(growingCategory.deltaAmount, displayCurrency)} dari ${formatMoney(growingCategory.previousTotal, displayCurrency)} menjadi ${formatMoney(growingCategory.currentTotal, displayCurrency)}.`,
        metricLabel: `${growingCategory.sharePct.toFixed(1)}% porsi`,
      });
    } else if (categoryComparisons[0] && categoryComparisons[0].currentTotal > 0) {
      const topCat = categoryComparisons[0];
      notices.push({
        id: 'category-concentration',
        tone: topCat.sharePct >= 50 ? 'warning' : 'neutral',
        topic: 'Konsentrasi Kategori',
        title: `${topCat.category} menyerap ${topCat.sharePct.toFixed(1)}% total pengeluaran`,
        description: `Terdiri dari ${topCat.txCount} transaksi dengan total ${formatMoney(topCat.currentTotal, displayCurrency)}.`,
        metricLabel: formatMoney(topCat.currentTotal, displayCurrency),
      });
    }

    // 4. Weekend vs Weekday Spending Pattern
    if (weekdayAvgPerDay > 0 && weekendAvgPerDay > 0) {
      const ratio = weekendAvgPerDay / weekdayAvgPerDay;
      if (ratio >= 1.25) {
        notices.push({
          id: 'weekend-heavy',
          tone: 'warning',
          topic: 'Pola Hari Belanja',
          title: `Belanja akhir pekan ${ratio.toFixed(1)}x lebih tinggi per hari aktif`,
          description: `Rata-rata pengeluaran akhir pekan ${formatMoney(weekendAvgPerDay, displayCurrency)}/hari dibanding hari kerja ${formatMoney(weekdayAvgPerDay, displayCurrency)}/hari.`,
          metricLabel: topWeekday ? `Puncak: ${topWeekday.label}` : undefined,
        });
      } else if (topWeekday) {
        notices.push({
          id: 'weekday-peak',
          tone: 'neutral',
          topic: 'Pola Hari Belanja',
          title: `Hari ${topWeekday.label} mencatat belanja tertinggi (${formatMoney(topWeekday.total, displayCurrency)})`,
          description: `Terdapat ${topWeekday.count} transaksi pada hari ${topWeekday.label} dengan rata-rata ${formatMoney(topWeekday.avgPerTx, displayCurrency)} per transaksi.`,
          metricLabel: `${topWeekday.count} transaksi`,
        });
      }
    } else if (topWeekday) {
      notices.push({
        id: 'single-day-peak',
        tone: 'neutral',
        topic: 'Aktivitas Harian',
        title: `Puncak pengeluaran terjadi pada hari ${topWeekday.label}`,
        description: `Total ${formatMoney(topWeekday.total, displayCurrency)} dari ${topWeekday.count} transaksi.`,
        metricLabel: formatMoney(topWeekday.total, displayCurrency),
      });
    }

    // 5. Top Merchant Concentration or Recurring Subscription
    if (recurringCandidates.length > 0) {
      const topRec = recurringCandidates[0];
      notices.push({
        id: 'recurring-merchant',
        tone: 'neutral',
        topic: 'Pengeluaran Berulang',
        title: `${topRec.merchantName} muncul di ${topRec.monthsCount} bulan (${topRec.txCount}x)`,
        description: `Rata-rata nominal ${formatMoney(topRec.avgAmount, displayCurrency)} per transaksi pada kategori ${topRec.category}.`,
        metricLabel: formatMoney(topRec.totalAmount, displayCurrency),
      });
    } else if (topMerchants[0]) {
      const tm = topMerchants[0];
      notices.push({
        id: 'top-merchant',
        tone: 'neutral',
        topic: 'Merchant Terbesar',
        title: `${tm.merchantName} menyumbang ${tm.sharePct.toFixed(1)}% pengeluaran`,
        description: `Total ${formatMoney(tm.total, displayCurrency)} (${tm.count} transaksi), terakhir pada ${formatShortDate(tm.lastDate)}.`,
        metricLabel: `${tm.count}x transaksi`,
      });
    }

    // 6. Funding Source Insight (ADCB vs Cash)
    if (fundingSourceSplits.length >= 2 && totalExpense > 0) {
      const primarySource = fundingSourceSplits[0];
      notices.push({
        id: 'funding-source-dominant',
        tone: 'positive',
        topic: 'Distribusi Sumber Dana',
        title: `${primarySource.providerLabel} mendominasi ${primarySource.expenseSharePct.toFixed(1)}% pembayaran`,
        description: `${primarySource.accountName} digunakan untuk ${formatMoney(primarySource.expenseTotal, displayCurrency)} dari total pengeluaran periode ini.`,
        metricLabel: primarySource.providerLabel,
      });
    }
  }

  return {
    scope,
    activeMonth,
    previousMonth,
    periodLabel,
    totalTxCount: scopedTxs.length,
    expenseTxCount,
    incomeTxCount,
    totalIncome,
    totalExpense,
    netCashFlow,
    savingsRatePct,
    previousExpense,
    previousIncome,
    expenseDeltaPct,
    avgDailyExpense,
    projectedMonthExpense,
    activeDaysCount: activeDates.size,
    largestExpenseTx,
    weekendAvgPerDay,
    weekdayAvgPerDay,
    topWeekday,
    weekdayBuckets,
    categoryComparisons,
    topMerchants,
    recurringCandidates,
    fundingSourceSplits,
    notices,
  };
}
