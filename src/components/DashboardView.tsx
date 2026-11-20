import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Landmark,
  Lightbulb,
  Plus,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import type {
  CategoryBudget,
  CustomCategory,
  DisplayCurrency,
  FinancialAccount,
  FinancialTransaction,
  SupportedCurrency,
  TransactionType,
} from '../types';
import {
  convertCurrency,
  formatMoney,
  formatMonthLabel,
  formatShortDate,
  formatShortMonthLabel,
} from '../lib/formatters';
import {
  CategoryBadgeIcon,
  resolveCategoryAppearance,
} from '../lib/categoryVisuals';
import { computeMonthlyBudgetProgress } from '../lib/budgetUtils';
import {
  buildAccountColorMap,
  type ResolvedAccountColor,
} from '../lib/accountColors';
import { useLanguage } from '../lib/i18n';

interface DashboardViewProps {
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  customCategories?: CustomCategory[];
  budgets?: CategoryBudget[];
  displayCurrency: DisplayCurrency;
  aedToIdrRate: number;
  fxRates?: Partial<Record<SupportedCurrency, number>>;
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
  onOpenNewTx: () => void;
  onNavigate: (tab: 'insights' | 'budgets' | 'transactions' | 'accounts' | 'export') => void;
  onOpenBudgets?: (budgetType: TransactionType) => void;
  onOpenPdfImport: () => void;
}

const WEEKDAY_HEADERS_ID = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const WEEKDAY_HEADERS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatCompactMoney(amount: number, currency: DisplayCurrency): string {
  const abs = Math.abs(amount);
  if (currency === 'IDR') {
    if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}jt`;
    if (abs >= 1_000) return `${Math.round(abs / 1_000)}rb`;
    return `${Math.round(abs)}`;
  }
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return Number.isInteger(abs) ? `${abs}` : abs.toFixed(0);
}

function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y, m - 1 + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  accounts,
  transactions,
  customCategories = [],
  budgets = [],
  displayCurrency,
  aedToIdrRate,
  fxRates,
  selectedMonth,
  onSelectMonth,
  onOpenNewTx,
  onNavigate,
  onOpenBudgets,
  onOpenPdfImport,
}) => {
  const { lang, tr } = useLanguage();
  const weekdayHeaders = lang === 'en' ? WEEKDAY_HEADERS_EN : WEEKDAY_HEADERS_ID;
  const rateInput = fxRates ?? aedToIdrRate;
  const [periodMode, setPeriodMode] = useState<'month' | 'date'>('month');
  const [chartMode, setChartMode] = useState<'monthly' | 'daily'>('monthly');
  const [pieType, setPieType] = useState<'expense' | 'income'>('expense');
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [lockedCategory, setLockedCategory] = useState<string | null>(null);
  const [calendarAccountFilter, setCalendarAccountFilter] = useState<string>('all');

  const latestTransactionDate = useMemo(() => {
    let maxDate = '';
    for (const tx of transactions) {
      if (tx.date && tx.date > maxDate) maxDate = tx.date;
    }
    return maxDate || new Date().toISOString().slice(0, 10);
  }, [transactions]);

  const [dateFrom, setDateFrom] = useState(() => '');
  const [dateTo, setDateTo] = useState(() => '');

  const effectiveDateFrom = dateFrom || `${latestTransactionDate.slice(0, 7)}-01`;
  const effectiveDateTo = dateTo || latestTransactionDate;

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    const current = new Date().toISOString().slice(0, 7);
    set.add(current);
    transactions.forEach((tx) => {
      if (tx.monthKey) set.add(tx.monthKey);
    });
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions]);

  const latestMonth = useMemo(() => {
    let maxMonth = '';
    for (const tx of transactions) {
      if (tx.monthKey && tx.monthKey > maxMonth) {
        maxMonth = tx.monthKey;
      }
    }
    return maxMonth || availableMonths[0];
  }, [transactions, availableMonths]);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : latestMonth;

  // Calendar month & selected day state
  const [calendarMonth, setCalendarMonth] = useState<string>(activeMonth);
  const [selectedCalDate, setSelectedCalDate] = useState<string>(latestTransactionDate);

  useEffect(() => {
    setCalendarMonth(activeMonth);
  }, [activeMonth]);

  useEffect(() => {
    if (selectedCalDate && selectedCalDate.startsWith(calendarMonth)) return;
    const latestInCalMonth = transactions
      .filter((t) => t.date.startsWith(calendarMonth))
      .map((t) => t.date)
      .sort()
      .pop();
    if (latestInCalMonth) {
      setSelectedCalDate(latestInCalMonth);
    } else {
      const todayIso = new Date().toISOString().slice(0, 10);
      setSelectedCalDate(todayIso.startsWith(calendarMonth) ? todayIso : `${calendarMonth}-01`);
    }
  }, [calendarMonth, transactions, selectedCalDate]);

  const totalWealth = useMemo(
    () =>
      accounts.reduce(
        (sum, acc) =>
          sum + convertCurrency(acc.balance, acc.currency, displayCurrency, rateInput),
        0
      ),
    [accounts, displayCurrency, rateInput]
  );

  const budgetMonthKey =
    periodMode === 'date' && effectiveDateTo ? effectiveDateTo.slice(0, 7) : activeMonth;

  const budgetSummary = useMemo(
    () =>
      computeMonthlyBudgetProgress({
        budgets,
        transactions,
        customCategories,
        monthKey: budgetMonthKey,
        displayCurrency,
        rateInput,
        budgetType: 'expense',
      }),
    [budgets, transactions, customCategories, budgetMonthKey, displayCurrency, rateInput]
  );

  const incomeBudgetSummary = useMemo(
    () =>
      computeMonthlyBudgetProgress({
        budgets,
        transactions,
        customCategories,
        monthKey: budgetMonthKey,
        displayCurrency,
        rateInput,
        budgetType: 'income',
      }),
    [budgets, transactions, customCategories, budgetMonthKey, displayCurrency, rateInput]
  );

  const latestMonthStats = useMemo(() => {
    let income = 0;
    let expense = 0;
    let txCount = 0;
    for (const tx of transactions) {
      if (tx.monthKey !== latestMonth) continue;
      txCount += 1;
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      if (tx.txType === 'income') income += val;
      else expense += val;
    }
    return { income, expense, netFlow: income - expense, txCount };
  }, [transactions, latestMonth, displayCurrency, rateInput]);

  const periodTxs = useMemo(() => {
    if (periodMode === 'date') {
      return transactions.filter((tx) => {
        if (effectiveDateFrom && tx.date < effectiveDateFrom) return false;
        if (effectiveDateTo && tx.date > effectiveDateTo) return false;
        return true;
      });
    }
    return transactions.filter((tx) => tx.monthKey === activeMonth);
  }, [transactions, periodMode, activeMonth, effectiveDateFrom, effectiveDateTo]);

  const periodLabel = useMemo(() => {
    if (periodMode === 'date') {
      if (effectiveDateFrom && effectiveDateTo) {
        return effectiveDateFrom === effectiveDateTo
          ? formatShortDate(effectiveDateFrom)
          : `${formatShortDate(effectiveDateFrom)} – ${formatShortDate(effectiveDateTo)}`;
      }
      if (effectiveDateFrom) return `Mulai ${formatShortDate(effectiveDateFrom)}`;
      if (effectiveDateTo) return `Hingga ${formatShortDate(effectiveDateTo)}`;
      return 'Semua Tanggal';
    }
    return formatMonthLabel(activeMonth);
  }, [periodMode, activeMonth, effectiveDateFrom, effectiveDateTo]);

  const prevMonthKey = useMemo(() => {
    const [y, m] = activeMonth.split('-').map(Number);
    const dt = new Date(y, m - 2, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  }, [activeMonth]);

  const periodStats = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of periodTxs) {
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      if (tx.txType === 'income') income += val;
      else expense += val;
    }

    let prevExpense = 0;
    if (periodMode === 'month') {
      for (const tx of transactions) {
        if (tx.monthKey === prevMonthKey && tx.txType === 'expense') {
          prevExpense += convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
        }
      }
    }

    const expenseDeltaPct =
      periodMode === 'month' && prevExpense > 0
        ? ((expense - prevExpense) / prevExpense) * 100
        : null;
    const netFlow = income - expense;
    const savingsRate = income > 0 ? Math.max(-100, Math.min(100, (netFlow / income) * 100)) : 0;

    return { income, expense, prevExpense, expenseDeltaPct, netFlow, savingsRate };
  }, [periodTxs, transactions, prevMonthKey, periodMode, displayCurrency, rateInput]);

  // Build 6-12 month chronological chart data
  const monthlySeries = useMemo(() => {
    const buckets = new Map<
      string,
      { monthKey: string; label: string; Pemasukan: number; Pengeluaran: number; ArusKas: number }
    >();

    const [ay, am] = activeMonth.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(ay, am - 1 - i, 1);
      const mk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(mk, {
        monthKey: mk,
        label: formatShortMonthLabel(mk),
        Pemasukan: 0,
        Pengeluaran: 0,
        ArusKas: 0,
      });
    }

    for (const tx of transactions) {
      if (!tx.monthKey) continue;
      if (!buckets.has(tx.monthKey)) {
        buckets.set(tx.monthKey, {
          monthKey: tx.monthKey,
          label: formatShortMonthLabel(tx.monthKey),
          Pemasukan: 0,
          Pengeluaran: 0,
          ArusKas: 0,
        });
      }
      const entry = buckets.get(tx.monthKey)!;
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      if (tx.txType === 'income') entry.Pemasukan += val;
      else entry.Pengeluaran += val;
    }

    return Array.from(buckets.values())
      .sort((a, b) => (a.monthKey > b.monthKey ? 1 : -1))
      .slice(-12)
      .map((item) => {
        const inc = Math.round(item.Pemasukan * 100) / 100;
        const exp = Math.round(item.Pengeluaran * 100) / 100;
        return {
          ...item,
          Pemasukan: inc,
          Pengeluaran: exp,
          ArusKas: Math.round((inc - exp) * 100) / 100,
        };
      });
  }, [transactions, activeMonth, displayCurrency, rateInput]);

  // Daily breakdown for either activeMonth or selected date range
  const dailySeries = useMemo(() => {
    const dailyMap = new Map<
      string,
      { date: string; day: string; Pemasukan: number; Pengeluaran: number; ArusKas: number; Kumulatif: number }
    >();

    if (periodMode === 'month') {
      const [y, m] = activeMonth.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${activeMonth}-${String(d).padStart(2, '0')}`;
        dailyMap.set(key, {
          date: key,
          day: String(d).padStart(2, '0'),
          Pemasukan: 0,
          Pengeluaran: 0,
          ArusKas: 0,
          Kumulatif: 0,
        });
      }
    } else if (effectiveDateFrom && effectiveDateTo && effectiveDateFrom <= effectiveDateTo) {
      const start = new Date(`${effectiveDateFrom}T00:00:00`);
      const end = new Date(`${effectiveDateTo}T00:00:00`);
      const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 62) {
        for (let i = 0; i <= diffDays; i++) {
          const dt = new Date(start);
          dt.setDate(start.getDate() + i);
          const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
          dailyMap.set(iso, {
            date: iso,
            day: formatShortDate(iso),
            Pemasukan: 0,
            Pengeluaran: 0,
            ArusKas: 0,
            Kumulatif: 0,
          });
        }
      }
    }

    for (const tx of periodTxs) {
      let entry = dailyMap.get(tx.date);
      if (!entry) {
        entry = {
          date: tx.date,
          day: periodMode === 'month' ? tx.date.slice(8, 10) : formatShortDate(tx.date),
          Pemasukan: 0,
          Pengeluaran: 0,
          ArusKas: 0,
          Kumulatif: 0,
        };
        dailyMap.set(tx.date, entry);
      }
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      if (tx.txType === 'income') entry.Pemasukan += val;
      else entry.Pengeluaran += val;
    }

    let runningExpense = 0;
    return Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => {
        const inc = Math.round(item.Pemasukan * 100) / 100;
        const exp = Math.round(item.Pengeluaran * 100) / 100;
        runningExpense += exp;
        return {
          date: item.date,
          day: item.day,
          Pemasukan: inc,
          Pengeluaran: exp,
          ArusKas: Math.round((inc - exp) * 100) / 100,
          Kumulatif: Math.round(runningExpense * 100) / 100,
        };
      });
  }, [periodMode, activeMonth, effectiveDateFrom, effectiveDateTo, periodTxs, displayCurrency, rateInput]);

  // Modern Pie Chart Breakdown (supports Expense & Income, uses each category's saved icon & color)
  const pieTotal = pieType === 'income' ? periodStats.income : periodStats.expense;

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const tx of periodTxs) {
      if (tx.txType !== pieType) continue;
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      const prev = map.get(tx.category) || { total: 0, count: 0 };
      map.set(tx.category, { total: prev.total + val, count: prev.count + 1 });
    }
    const sorted = Array.from(map.entries())
      .map(([category, info]) => {
        const appearance = resolveCategoryAppearance(category, customCategories, pieType);
        return {
          category,
          total: Math.round(info.total * 100) / 100,
          count: info.count,
          share: pieTotal > 0 ? (info.total / pieTotal) * 100 : 0,
          color: appearance.color,
          iconKey: appearance.iconKey,
        };
      })
      .sort((a, b) => b.total - a.total);

    if (sorted.length <= 8) {
      return sorted;
    }

    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    const restTotal = rest.reduce((sum, item) => sum + item.total, 0);
    const restCount = rest.reduce((sum, item) => sum + item.count, 0);
    const otherAppearance = resolveCategoryAppearance('Kategori Lainnya', customCategories, pieType);
    top.push({
      category: 'Kategori Lainnya',
      total: Math.round(restTotal * 100) / 100,
      count: restCount,
      share: pieTotal > 0 ? (restTotal / pieTotal) * 100 : 0,
      color: otherAppearance.color,
      iconKey: otherAppearance.iconKey,
    });
    return top;
  }, [periodTxs, pieType, pieTotal, customCategories, displayCurrency, rateInput]);

  useEffect(() => {
    setHoveredCategory(null);
    setLockedCategory(null);
  }, [pieType, periodLabel]);

  const activeCategoryName = hoveredCategory ?? lockedCategory;
  const activeSliceItem = useMemo(
    () =>
      activeCategoryName
        ? categoryBreakdown.find((item) => item.category === activeCategoryName) || null
        : null,
    [activeCategoryName, categoryBreakdown]
  );

  const accountColorMap = useMemo(
    () => buildAccountColorMap(accounts, transactions),
    [accounts, transactions]
  );

  const accountLegendItems = useMemo(
    () => Array.from(accountColorMap.values()),
    [accountColorMap]
  );

  useEffect(() => {
    if (calendarAccountFilter !== 'all' && !accountColorMap.has(calendarAccountFilter)) {
      setCalendarAccountFilter('all');
    }
  }, [calendarAccountFilter, accountColorMap]);

  // Calendar grid & daily aggregates for calendarMonth (with per-account color breakdown)
  const calendarData = useMemo(() => {
    interface DayAccountEntry {
      account: ResolvedAccountColor;
      count: number;
      income: number;
      expense: number;
      totalVolume: number;
    }

    interface DayCalendarStats {
      count: number;
      income: number;
      expense: number;
      totalVolume: number;
      txs: FinancialTransaction[];
      accountsBreakdown: DayAccountEntry[];
    }

    const byDate = new Map<
      string,
      DayCalendarStats & { byAccountMap: Map<string, DayAccountEntry> }
    >();

    let monthTxCount = 0;
    let monthTotalVolume = 0;

    for (const tx of transactions) {
      if (!tx.date || !tx.date.startsWith(calendarMonth)) continue;
      const accId = tx.accountId || 'unassigned';
      if (calendarAccountFilter !== 'all' && accId !== calendarAccountFilter) continue;

      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      const entry = byDate.get(tx.date) || {
        count: 0,
        income: 0,
        expense: 0,
        totalVolume: 0,
        txs: [],
        accountsBreakdown: [],
        byAccountMap: new Map<string, DayAccountEntry>(),
      };

      entry.count += 1;
      entry.totalVolume += val;
      if (tx.txType === 'income') entry.income += val;
      else entry.expense += val;
      entry.txs.push(tx);

      const resolvedAcc = accountColorMap.get(accId);
      if (resolvedAcc) {
        const accEntry = entry.byAccountMap.get(accId) || {
          account: resolvedAcc,
          count: 0,
          income: 0,
          expense: 0,
          totalVolume: 0,
        };
        accEntry.count += 1;
        accEntry.totalVolume += val;
        if (tx.txType === 'income') accEntry.income += val;
        else accEntry.expense += val;
        entry.byAccountMap.set(accId, accEntry);
      }

      byDate.set(tx.date, entry);

      monthTxCount += 1;
      monthTotalVolume += val;
    }

    const finalizedByDate = new Map<string, DayCalendarStats>();
    for (const [dateStr, raw] of byDate.entries()) {
      finalizedByDate.set(dateStr, {
        count: raw.count,
        income: raw.income,
        expense: raw.expense,
        totalVolume: raw.totalVolume,
        txs: raw.txs,
        accountsBreakdown: Array.from(raw.byAccountMap.values()).sort(
          (a, b) => b.totalVolume - a.totalVolume
        ),
      });
    }

    const [y, m] = calendarMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    // Convert JS getDay (0=Sun..6=Sat) to Monday-first offset (0=Mon..6=Sun)
    const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;

    const cells: Array<{
      date: string | null;
      dayNum?: number;
      stats?: DayCalendarStats;
    }> = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ date: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calendarMonth}-${String(d).padStart(2, '0')}`;
      cells.push({
        date: dateStr,
        dayNum: d,
        stats: finalizedByDate.get(dateStr),
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: null });
    }

    return {
      cells,
      byDate: finalizedByDate,
      monthTxCount,
      monthTotalVolume,
    };
  }, [
    transactions,
    calendarMonth,
    calendarAccountFilter,
    accountColorMap,
    displayCurrency,
    rateInput,
  ]);

  const selectedDayInfo = calendarData.byDate.get(selectedCalDate);

  if (accounts.length === 0 && transactions.length === 0) {
    return (
      <div className="border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] rounded-2xl p-10 text-center max-w-2xl mx-auto mt-8">
        <Landmark className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          {tr('Brankas Terenkripsi Anda Siap Digunakan', 'Your Encrypted Vault Is Ready')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
          {tr(
            'Mulai dengan menambahkan sumber dana (ADCB atau Cash) Anda, mencatat transaksi manual, atau mengimpor laporan mutasi PDF maupun gambar JPG/PNG.',
            'Start by adding a funding source (ADCB or Cash), recording a manual transaction, or importing a PDF or JPG/PNG statement.'
          )}
        </p>
        <div className="mt-6 flex flex-wrap items-start justify-center gap-3">
          <button
            onClick={() => onNavigate('accounts')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Landmark className="w-4 h-4" />
            <span>{tr('Tambah Sumber Dana', 'Add Funding Source')}</span>
          </button>
          <button
            onClick={onOpenPdfImport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Import File</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Period Summary Bar with Spending Budgets, Income Budgets & Financial Insights */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {tr('Ringkasan Periode:', 'Period Summary:')}
          </span>
          <span className="font-display font-semibold text-slate-900 dark:text-white">
            {periodLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (onOpenBudgets) onOpenBudgets('expense');
              else onNavigate('budgets');
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              budgetSummary.exceededCount > 0
                ? 'border-red-300 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100/80 dark:hover:bg-red-900/50'
                : 'border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{tr('Budget Pengeluaran', 'Spending Budgets')}</span>
            {budgetSummary.items.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                {budgetSummary.items.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenBudgets) onOpenBudgets('income');
              else onNavigate('budgets');
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <TrendingUp className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{tr('Budget Pemasukan', 'Income Budgets')}</span>
            {incomeBudgetSummary.items.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {incomeBudgetSummary.items.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onNavigate('insights')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Lightbulb className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Insight Keuangan', 'Financial Insights')}</span>
          </button>
        </div>
      </div>

      {/* 4 Individual Spacious KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Total Net Balance */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] p-5 sm:p-6 flex flex-col justify-between transition-colors hover:border-slate-300 dark:hover:border-slate-700/90">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">{tr('Total Saldo Bersih', 'Total Net Balance')}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                {tr('Per', 'As of')} {formatShortMonthLabel(latestMonth)}
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
              {formatMoney(totalWealth, displayCurrency)}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate">
              {accounts.length} {tr('sumber dana', 'sources')}
              {latestMonthStats.txCount > 0
                ? ` · ${tr('Arus kas:', 'Cashflow:')} ${latestMonthStats.netFlow >= 0 ? '+' : '-'}${formatCompactMoney(latestMonthStats.netFlow, displayCurrency)}`
                : ''}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              {tr('Kelola sumber dana →', 'Manage →')}
            </button>
          </div>
        </div>

        {/* Card 2: Income */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] p-5 sm:p-6 flex flex-col justify-between transition-colors hover:border-slate-300 dark:hover:border-slate-700/90">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">{tr('Pemasukan', 'Income')}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                {periodLabel}
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatMoney(periodStats.income, displayCurrency)}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 truncate">
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {periodTxs.filter((t) => t.txType === 'income').length}{' '}
                {tr('transaksi masuk', 'income entries')}
              </span>
            </span>
            {incomeBudgetSummary.items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenBudgets) onOpenBudgets('income');
                  else onNavigate('budgets');
                }}
                className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
              >
                {incomeBudgetSummary.overallPercent.toFixed(0)}% {tr('target', 'goal')} →
              </button>
            )}
          </div>
        </div>

        {/* Card 3: Expenses */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] p-5 sm:p-6 flex flex-col justify-between transition-colors hover:border-slate-300 dark:hover:border-slate-700/90">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">{tr('Pengeluaran', 'Expenses')}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                {periodLabel}
              </span>
            </div>
            <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
              {formatMoney(periodStats.expense, displayCurrency)}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 truncate">
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400 shrink-0" />
              <span className="truncate">
                {periodStats.expenseDeltaPct === null
                  ? `${periodTxs.filter((t) => t.txType === 'expense').length} ${tr('transaksi keluar', 'expense entries')}`
                  : `${periodStats.expenseDeltaPct >= 0 ? '+' : ''}${periodStats.expenseDeltaPct.toFixed(1)}% ${tr('dibanding bulan lalu', 'vs last month')}`}
              </span>
            </span>
          </div>
        </div>

        {/* Card 4: Net Cash Flow */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] p-5 sm:p-6 flex flex-col justify-between transition-colors hover:border-slate-300 dark:hover:border-slate-700/90">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">{tr('Arus Kas Bersih', 'Net Cash Flow')}</span>
              <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                {tr('Rasio', 'Ratio')} {periodStats.savingsRate.toFixed(0)}%
              </span>
            </div>
            <p
              className={`mt-3 font-mono text-2xl font-bold tracking-tight tabular-nums ${
                periodStats.netFlow >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {periodStats.netFlow >= 0 ? '+' : ''}
              {formatMoney(periodStats.netFlow, displayCurrency)}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400 truncate">
            {periodMode === 'date'
              ? `${tr('Selisih pemasukan & pengeluaran', 'Income minus expenses')} (${periodLabel})`
              : tr('Selisih pemasukan & pengeluaran bulan ini', 'Income minus expenses this month')}
          </div>
        </div>
      </div>

      {/* Dominant Focal Anchor: Real-Time Monthly & Daily Spending Trend Chart */}
      <section className="border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] rounded-2xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {tr('Tren Pengeluaran & Arus Kas Real-Time', 'Real-Time Spending & Cash Flow Trend')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {tr(
                'Pantau pengeluaran & arus kas berdasarkan bulan maupun rentang tanggal spesifik',
                'Track spending & cash flow by month or custom date range'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Period Basis Toggle: Month vs Date */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setPeriodMode('month')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  periodMode === 'month'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tr('Per Bulan', 'By Month')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriodMode('date');
                  if (!dateFrom) setDateFrom(`${latestTransactionDate.slice(0, 7)}-01`);
                  if (!dateTo) setDateTo(latestTransactionDate);
                }}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  periodMode === 'date'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tr('Per Tanggal', 'By Date')}
              </button>
            </div>

            {periodMode === 'month' ? (
              <>
                <select
                  value={activeMonth}
                  onChange={(e) => onSelectMonth(e.target.value)}
                  aria-label={tr('Pilih bulan laporan', 'Select report month')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                >
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setChartMode('monthly')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      chartMode === 'monthly'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tr('Tren Bulanan', 'Monthly Trend')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('daily')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      chartMode === 'daily'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tr('Arus Harian', 'Daily Cumulative')}
                  </button>
                </div>
              </>
            ) : (
              <div className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950">
                <Calendar className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                <input
                  type="date"
                  value={effectiveDateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Dari tanggal laporan"
                  className="text-xs font-mono bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400">s/d</span>
                <input
                  type="date"
                  value={effectiveDateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Sampai tanggal laporan"
                  className="text-xs font-mono bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom(latestTransactionDate);
                    setDateTo(latestTransactionDate);
                  }}
                  className="ml-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Tanggal Terakhir
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="h-[300px] w-full pt-5">
          <ResponsiveContainer width="100%" height="100%">
            {periodMode === 'month' && chartMode === 'monthly' ? (
              <BarChart data={monthlySeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={74}
                  tickFormatter={(v) =>
                    displayCurrency === 'IDR'
                      ? `${(v / 1_000_000).toFixed(1)}jt`
                      : `${Math.round(v)}`
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(15, 118, 110, 0.06)' }}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  formatter={(value) => {
                    const num = Array.isArray(value) ? Number(value[0]) : Number(value);
                    return formatMoney(Number.isFinite(num) ? num : 0, displayCurrency);
                  }}
                />
                <Bar dataKey="Pemasukan" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Pengeluaran" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            ) : periodMode === 'date' ? (
              <BarChart data={dailySeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={74}
                  tickFormatter={(v) =>
                    displayCurrency === 'IDR'
                      ? `${(v / 1_000_000).toFixed(1)}jt`
                      : `${Math.round(v)}`
                  }
                />
                <Tooltip
                  cursor={{ fill: 'rgba(16, 185, 129, 0.06)' }}
                  contentStyle={{
                    backgroundColor: '#0B111C',
                    borderColor: '#1e293b',
                    borderRadius: '10px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  formatter={(value) => {
                    const num = Array.isArray(value) ? Number(value[0]) : Number(value);
                    return formatMoney(Number.isFinite(num) ? num : 0, displayCurrency);
                  }}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as { date?: string; ArusKas?: number } | undefined;
                    if (!row?.date) return periodLabel;
                    const net = row.ArusKas ?? 0;
                    return `${formatShortDate(row.date)} · Arus Kas: ${net >= 0 ? '+' : ''}${formatMoney(net, displayCurrency)}`;
                  }}
                />
                <Bar dataKey="Pemasukan" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Pengeluaran" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            ) : (
              <AreaChart data={dailySeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="kumulatifFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={74}
                  tickFormatter={(v) =>
                    displayCurrency === 'IDR'
                      ? `${(v / 1_000_000).toFixed(1)}jt`
                      : `${Math.round(v)}`
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0B111C',
                    borderColor: '#1e293b',
                    borderRadius: '10px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  formatter={(value) => {
                    const num = Array.isArray(value) ? Number(value[0]) : Number(value);
                    return formatMoney(Number.isFinite(num) ? num : 0, displayCurrency);
                  }}
                  labelFormatter={(day) => `Tanggal ${day} · ${formatMonthLabel(activeMonth)}`}
                />
                <Area
                  type="monotone"
                  dataKey="Kumulatif"
                  name="Pengeluaran Kumulatif"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#kumulatifFill)"
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </section>

      {/* Secondary Row: Pengeluaran per Kategori (Grafik Pie) + Kalender Transaksi Harian */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Modern Interactive Category Donut Chart */}
        <section className="lg:col-span-6 border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] rounded-2xl p-6 flex flex-col justify-between h-full">
          <div className="flex flex-col flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {pieType === 'income'
                    ? tr('Pemasukan per Kategori', 'Income by Category')
                    : tr('Pengeluaran per Kategori', 'Spending by Category')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {periodLabel} · {categoryBreakdown.length} {tr('kategori', 'categories')}
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPieType('expense')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      pieType === 'expense'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tr('Keluar', 'Expense')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPieType('income')}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      pieType === 'income'
                        ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tr('Masuk', 'Income')}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('transactions')}
                  className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {tr('Buku Kas →', 'Transactions →')}
                </button>
              </div>
            </div>

            {categoryBreakdown.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tr(
                    `Belum ada ${pieType === 'income' ? 'pemasukan' : 'pengeluaran'} tercatat pada ${periodLabel}.`,
                    `No ${pieType === 'income' ? 'income' : 'expenses'} recorded for ${periodLabel}.`
                  )}
                </p>
                <button
                  type="button"
                  onClick={onOpenNewTx}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{tr('Catat transaksi baru', 'Add new transaction')}</span>
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-between gap-4 pt-4">
                {/* Full-width centered modern donut chart */}
                <div className="w-full h-[250px] sm:h-[270px] lg:h-[290px] relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryBreakdown}
                        dataKey="total"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        innerRadius="62%"
                        outerRadius="92%"
                        paddingAngle={categoryBreakdown.length > 1 ? 3 : 0}
                        cornerRadius={6}
                        stroke="none"
                        onMouseEnter={(_, index) => {
                          const target = categoryBreakdown[index];
                          if (target) setHoveredCategory(target.category);
                        }}
                        onMouseLeave={() => setHoveredCategory(null)}
                        onClick={(_, index) => {
                          const target = categoryBreakdown[index];
                          if (!target) return;
                          setLockedCategory((prev) =>
                            prev === target.category ? null : target.category
                          );
                        }}
                      >
                        {categoryBreakdown.map((entry) => {
                          const isDimmed =
                            activeCategoryName !== null && activeCategoryName !== entry.category;
                          const isSelected = activeCategoryName === entry.category;
                          return (
                            <Cell
                              key={entry.category}
                              fill={entry.color}
                              fillOpacity={isDimmed ? 0.25 : 1}
                              stroke={isSelected ? entry.color : 'transparent'}
                              strokeWidth={isSelected ? 2 : 0}
                              className="transition-opacity duration-200 cursor-pointer outline-none"
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const data = payload[0]?.payload as
                            | (typeof categoryBreakdown)[number]
                            | undefined;
                          if (!data) return null;
                          return (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 py-2.5 shadow-lg text-xs space-y-1 min-w-[175px]">
                              <div className="flex items-center gap-2">
                                <CategoryBadgeIcon
                                  categoryName={data.category}
                                  iconOverride={data.iconKey}
                                  colorOverride={data.color}
                                  size="xs"
                                />
                                <span className="font-semibold text-slate-900 dark:text-white truncate">
                                  {data.category}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between gap-3 pt-0.5">
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                                  {formatMoney(data.total, displayCurrency)}
                                </span>
                                <span
                                  className="font-mono font-semibold tabular-nums text-[11px]"
                                  style={{ color: data.color }}
                                >
                                  {data.share.toFixed(1)}%
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {data.count} transaksi
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Dynamic Center Donut Readout */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                    {activeSliceItem ? (
                      <>
                        <CategoryBadgeIcon
                          categoryName={activeSliceItem.category}
                          iconOverride={activeSliceItem.iconKey}
                          colorOverride={activeSliceItem.color}
                          size="sm"
                        />
                        <span className="mt-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[150px]">
                          {activeSliceItem.category}
                        </span>
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                          {formatCompactMoney(activeSliceItem.total, displayCurrency)}{' '}
                          <span className="font-normal text-[11px] text-slate-500">
                            {displayCurrency}
                          </span>
                        </span>
                        <span
                          className="text-[11px] font-mono font-semibold tabular-nums mt-0.5"
                          style={{ color: activeSliceItem.color }}
                        >
                          {activeSliceItem.share.toFixed(1)}% · {activeSliceItem.count}x
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                          {pieType === 'income' ? 'Total Masuk' : 'Total Keluar'}
                        </span>
                        <span className="font-mono text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5 truncate max-w-[160px]">
                          {formatCompactMoney(pieTotal, displayCurrency)}{' '}
                          <span className="font-normal text-xs text-slate-500">
                            {displayCurrency}
                          </span>
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono tabular-nums">
                          {categoryBreakdown.length} kategori
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Full-width Interactive Category Grid filling remaining card space */}
                <div
                  className={`grid gap-2 ${
                    categoryBreakdown.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {categoryBreakdown.map((item) => {
                    const isActive = activeCategoryName === item.category;
                    const isDimmed = activeCategoryName !== null && !isActive;
                    return (
                      <button
                        key={item.category}
                        type="button"
                        onMouseEnter={() => setHoveredCategory(item.category)}
                        onMouseLeave={() => setHoveredCategory(null)}
                        onClick={() =>
                          setLockedCategory((prev) =>
                            prev === item.category ? null : item.category
                          )
                        }
                        className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all cursor-pointer ${
                          isActive
                            ? 'border-slate-300 dark:border-slate-600 bg-slate-100/90 dark:bg-slate-800/80'
                            : 'border-slate-100 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        } ${isDimmed ? 'opacity-50' : 'opacity-100'}`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <CategoryBadgeIcon
                              categoryName={item.category}
                              iconOverride={item.iconKey}
                              colorOverride={item.color}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800 dark:text-slate-100 truncate">
                                {item.category}
                              </p>
                              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                {item.count} transaksi
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums text-[11.5px]">
                              {formatMoney(item.total, displayCurrency)}
                            </p>
                            <p
                              className="text-[11px] font-mono font-semibold tabular-nums"
                              style={{ color: item.color }}
                            >
                              {item.share.toFixed(1)}%
                            </p>
                          </div>
                        </div>

                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(3, Math.min(100, item.share))}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {categoryBreakdown.length > 0 && (
            <div className="pt-3 mt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-500 dark:text-slate-400 shrink-0">Terbesar:</span>
                <CategoryBadgeIcon
                  categoryName={categoryBreakdown[0].category}
                  iconOverride={categoryBreakdown[0].iconKey}
                  colorOverride={categoryBreakdown[0].color}
                  size="xs"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {categoryBreakdown[0].category}
                </span>
                <span
                  className="font-mono font-semibold tabular-nums shrink-0"
                  style={{ color: categoryBreakdown[0].color }}
                >
                  ({categoryBreakdown[0].share.toFixed(1)}%)
                </span>
              </div>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                Total: {formatMoney(pieTotal, displayCurrency)}
              </span>
            </div>
          )}
        </section>

        {/* Right: Daily Transaction Calendar */}
        <section className="lg:col-span-6 border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {tr('Kalender Transaksi Harian', 'Daily Transaction Calendar')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  {calendarData.monthTxCount} {tr('transaksi', 'transactions')} · Total{' '}
                  {formatMoney(calendarData.monthTotalVolume, displayCurrency)}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => shiftMonthKey(m, -1))}
                  aria-label={tr('Bulan kalender sebelumnya', 'Previous calendar month')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 min-w-[110px] text-center">
                  {formatMonthLabel(calendarMonth)}
                </span>
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => shiftMonthKey(m, 1))}
                  aria-label={tr('Bulan kalender berikutnya', 'Next calendar month')}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Account Color Legend & Filter */}
            {accountLegendItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-3">
                <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mr-1">
                  {tr('Akun:', 'Source:')}
                </span>
                {accountLegendItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCalendarAccountFilter('all')}
                    className={`px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      calendarAccountFilter === 'all'
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tr('Semua', 'All')}
                  </button>
                )}
                {accountLegendItems.map((accItem) => {
                  const isActiveFilter = calendarAccountFilter === accItem.accountId;
                  return (
                    <button
                      key={accItem.accountId}
                      type="button"
                      onClick={() =>
                        setCalendarAccountFilter((prev) =>
                          prev === accItem.accountId ? 'all' : accItem.accountId
                        )
                      }
                      aria-pressed={isActiveFilter}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        isActiveFilter
                          ? `${accItem.theme.badgeClass} ring-1 ring-current`
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: accItem.theme.accentHex }}
                      />
                      <span className="truncate max-w-[130px]">{accItem.accountName}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Weekday Header */}
            <div className="grid grid-cols-7 gap-1 mt-3 text-center">
              {weekdayHeaders.map((dayName) => (
                <div
                  key={dayName}
                  className="py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                >
                  {dayName}
                </div>
              ))}
            </div>

            {/* Month Days Grid */}
            <div className="grid grid-cols-7 gap-1 mt-1">
              {calendarData.cells.map((cell, idx) => {
                if (!cell.date) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="min-h-[64px] rounded-lg bg-slate-50/50 dark:bg-slate-950/30"
                    />
                  );
                }

                const stats = cell.stats;
                const isSelected = selectedCalDate === cell.date;
                const hasTx = Boolean(stats && stats.count > 0);
                const dayAccounts = stats?.accountsBreakdown ?? [];
                const singleAcc = dayAccounts.length === 1 ? dayAccounts[0] : null;
                const visibleDayAccounts =
                  dayAccounts.length > 3 ? dayAccounts.slice(0, 2) : dayAccounts;
                const extraAccCount =
                  dayAccounts.length > 3 ? dayAccounts.length - 2 : 0;

                return (
                  <button
                    key={cell.date}
                    type="button"
                    aria-label={`${formatShortDate(cell.date)}${hasTx && stats ? ` (${stats.count} transaksi)` : ''}`}
                    onClick={() => setSelectedCalDate(cell.date!)}
                    style={
                      hasTx && !isSelected && singleAcc
                        ? { borderLeftColor: singleAcc.account.theme.accentHex }
                        : undefined
                    }
                    className={`relative min-h-[64px] p-1.5 rounded-lg border text-left flex flex-col justify-between transition-colors cursor-pointer overflow-hidden ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/80 dark:bg-teal-950/50 ring-1 ring-teal-600/30'
                        : hasTx
                          ? singleAcc
                            ? `border-slate-200 dark:border-slate-800 border-l-[3px] ${singleAcc.account.theme.cellTintClass} hover:border-teal-400 dark:hover:border-teal-700`
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-teal-400 dark:hover:border-teal-700'
                          : 'border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-950/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {hasTx && !isSelected && dayAccounts.length > 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-0 bottom-0 w-[3px] flex flex-col"
                      >
                        {dayAccounts.map((accItem) => (
                          <span
                            key={accItem.account.accountId}
                            className="flex-1 w-full"
                            style={{ backgroundColor: accItem.account.theme.accentHex }}
                          />
                        ))}
                      </span>
                    )}

                    <div className="flex items-center justify-between gap-0.5 w-full">
                      <span
                        className={`text-[11px] font-mono tabular-nums font-semibold ${
                          isSelected
                            ? 'text-teal-800 dark:text-teal-300'
                            : hasTx
                              ? 'text-slate-900 dark:text-slate-100'
                              : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {cell.dayNum}
                      </span>
                      {hasTx && stats && (
                        <span className="px-1 rounded bg-slate-100/90 dark:bg-slate-800 text-[9px] font-mono font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                          {stats.count}x
                        </span>
                      )}
                    </div>

                    {hasTx && dayAccounts.length > 0 ? (
                      <div className="w-full space-y-0.5 mt-1">
                        {visibleDayAccounts.map((accItem) => {
                          const netAcc = accItem.income - accItem.expense;
                          const displayText =
                            accItem.expense > 0 && accItem.income === 0
                              ? `-${formatCompactMoney(accItem.expense, displayCurrency)}`
                              : accItem.income > 0 && accItem.expense === 0
                                ? `+${formatCompactMoney(accItem.income, displayCurrency)}`
                                : `${netAcc >= 0 ? '+' : '-'}${formatCompactMoney(Math.abs(netAcc), displayCurrency)}`;
                          return (
                            <div
                              key={accItem.account.accountId}
                              title={`${accItem.account.accountName}: ${accItem.count} transaksi`}
                              className="flex items-center gap-1 min-w-0"
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: accItem.account.theme.accentHex }}
                              />
                              <span
                                className={`text-[9.5px] leading-tight font-mono font-semibold tabular-nums truncate ${accItem.account.theme.textClass}`}
                              >
                                {displayText}
                              </span>
                            </div>
                          );
                        })}
                        {extraAccCount > 0 && (
                          <p className="text-[8.5px] leading-tight text-slate-400 dark:text-slate-500 font-mono">
                            +{extraAccCount} {tr('akun', 'accounts')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] text-slate-300 dark:text-slate-700">—</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Day Breakdown Footer */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatShortDate(selectedCalDate)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {selectedDayInfo?.count || 0} {tr('transaksi', 'transactions')}
                </span>
              </div>

              {selectedDayInfo ? (
                <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono tabular-nums">
                  {selectedDayInfo.income > 0 && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                      +{formatMoney(selectedDayInfo.income, displayCurrency)}
                    </span>
                  )}
                  {selectedDayInfo.expense > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      -{formatMoney(selectedDayInfo.expense, displayCurrency)}
                    </span>
                  )}
                  <span className="text-slate-500 dark:text-slate-400">
                    Total: {formatMoney(selectedDayInfo.totalVolume, displayCurrency)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate('transactions')}
                  className="text-xs text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  {tr('Lihat Buku Kas →', 'View Ledger →')}
                </button>
              )}
            </div>

            {selectedDayInfo && selectedDayInfo.txs.length > 0 ? (
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 pr-1">
                {selectedDayInfo.txs.map((tx) => {
                  const accInfo = accountColorMap.get(tx.accountId || 'unassigned');
                  return (
                    <div key={tx.id} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <CategoryBadgeIcon
                          categoryName={tx.category}
                          customCategories={customCategories}
                          txType={tx.txType}
                          size="xs"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {tx.merchant}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {tx.category}
                            </span>
                            {accInfo && (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${accInfo.theme.badgeClass}`}
                              >
                                <span
                                  className="w-1.5 h-1.5 rounded-full shrink-0"
                                  style={{ backgroundColor: accInfo.theme.accentHex }}
                                />
                                <span className="truncate max-w-[110px]">
                                  {accInfo.accountName}
                                </span>
                              </span>
                            )}
                            {tx.createdByName && (
                              <span className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate max-w-[120px]">
                                {tr('oleh', 'by')} {tx.createdByName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums shrink-0 ${
                          tx.txType === 'income'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {tx.txType === 'income' ? '+' : '-'}
                        {formatMoney(tx.amount, tx.currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-1">
                {tr(
                  'Tidak ada transaksi pada tanggal ini. Klik tanggal lain di kalender untuk melihat rincian.',
                  'No transactions on this date. Click another calendar date to see details.'
                )}
              </p>
            )}
          </div>
        </section>
      </div>

    </div>
  );
};
