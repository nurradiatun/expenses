import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
} from 'lucide-react';
import type {
  CategoryBudget,
  CustomCategory,
  DisplayCurrency,
  FinancialTransaction,
  SupportedCurrency,
  TransactionType,
  VaultShareRole,
} from '../types';
import { formatMoney, formatMonthLabel } from '../lib/formatters';
import { CategoryBadgeIcon } from '../lib/categoryVisuals';
import {
  computeMonthlyBudgetProgress,
  formatBudgetPeriodLabel,
  getBudgetSelectableMonths,
} from '../lib/budgetUtils';
import { useLanguage } from '../lib/i18n';

interface BudgetsViewProps {
  transactions: FinancialTransaction[];
  customCategories?: CustomCategory[];
  budgets?: CategoryBudget[];
  displayCurrency: DisplayCurrency;
  aedToIdrRate: number;
  fxRates?: Partial<Record<SupportedCurrency, number>>;
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
  onNavigate: (tab: 'dashboard' | 'transactions' | 'accounts' | 'export') => void;
  onOpenBudgetManager?: (budgetType?: TransactionType) => void;
  initialBudgetType?: TransactionType;
  readOnly?: boolean;
  isSharedVault?: boolean;
  activeRole?: VaultShareRole;
}

export const BudgetsView: React.FC<BudgetsViewProps> = ({
  transactions,
  customCategories = [],
  budgets = [],
  displayCurrency,
  aedToIdrRate,
  fxRates,
  selectedMonth,
  onSelectMonth,
  onNavigate,
  onOpenBudgetManager,
  initialBudgetType = 'expense',
  readOnly = false,
  isSharedVault = false,
  activeRole = 'editor',
}) => {
  const { tr } = useLanguage();
  const rateInput = fxRates ?? aedToIdrRate;
  const [activeBudgetType, setActiveBudgetType] = useState<TransactionType>(initialBudgetType);
  const [budgetFilter, setBudgetFilter] = useState<'all' | 'monthly' | 'multi'>('all');

  useEffect(() => {
    setActiveBudgetType(initialBudgetType);
  }, [initialBudgetType]);

  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const availableMonths = useMemo(() => {
    const list = getBudgetSelectableMonths(transactions, budgets, 12);
    if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth) && !list.includes(selectedMonth)) {
      return [...list, selectedMonth].sort((a, b) => (a < b ? 1 : -1));
    }
    return list;
  }, [transactions, budgets, selectedMonth]);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : availableMonths[0];

  const activeMonthIndex = availableMonths.indexOf(activeMonth);
  const canStepPrev = activeMonthIndex >= 0 && activeMonthIndex < availableMonths.length - 1;
  const canStepNext = activeMonthIndex > 0;
  const isFutureMonth = activeMonth > currentMonthKey;

  const expenseSummary = useMemo(
    () =>
      computeMonthlyBudgetProgress({
        budgets,
        transactions,
        customCategories,
        monthKey: activeMonth,
        displayCurrency,
        rateInput,
        budgetType: 'expense',
      }),
    [budgets, transactions, customCategories, activeMonth, displayCurrency, rateInput]
  );

  const incomeSummary = useMemo(
    () =>
      computeMonthlyBudgetProgress({
        budgets,
        transactions,
        customCategories,
        monthKey: activeMonth,
        displayCurrency,
        rateInput,
        budgetType: 'income',
      }),
    [budgets, transactions, customCategories, activeMonth, displayCurrency, rateInput]
  );

  const budgetSummary = activeBudgetType === 'income' ? incomeSummary : expenseSummary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{tr('Kembali ke Ringkasan', 'Back to Overview')}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {isSharedVault && (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium ${
                readOnly
                  ? 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>
                {activeRole === 'editor' && !readOnly
                  ? tr(
                      'Role Editor · Bisa ubah budget saat ini & mendatang',
                      'Editor Role · Can edit current & future budgets'
                    )
                  : tr('Role Viewer · Hanya Baca', 'Viewer Role · Read-only')}
              </span>
            </span>
          )}

          {/* Month Selector with Future Month Steppers */}
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={!canStepPrev}
              onClick={() => {
                if (canStepPrev) onSelectMonth(availableMonths[activeMonthIndex + 1]);
              }}
              aria-label={tr('Bulan budget sebelumnya', 'Previous budget month')}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <select
              value={activeMonth}
              onChange={(e) => onSelectMonth(e.target.value)}
              aria-label={tr('Pilih bulan budget', 'Select budget month')}
              className="px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] text-slate-800 dark:text-slate-200"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                  {m > currentMonthKey ? ` (${tr('Mendatang', 'Future')})` : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={!canStepNext}
              onClick={() => {
                if (canStepNext) onSelectMonth(availableMonths[activeMonthIndex - 1]);
              }}
              aria-label={tr('Bulan budget berikutnya', 'Next budget month')}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {!readOnly && onOpenBudgetManager && (
            <button
              type="button"
              onClick={() => onOpenBudgetManager(activeBudgetType)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{tr('Atur Budget', 'Manage Budgets')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Expense vs Income Budget Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={tr('Tipe Budget', 'Budget Category Type')}
          className="inline-flex items-center p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#0B111C]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeBudgetType === 'expense'}
            onClick={() => setActiveBudgetType('expense')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeBudgetType === 'expense'
                ? 'bg-white dark:bg-[#0E1523] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{tr('Pengeluaran', 'Spending')}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10.5px] font-mono tabular-nums">
              {expenseSummary.items.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeBudgetType === 'income'}
            onClick={() => setActiveBudgetType('income')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeBudgetType === 'income'
                ? 'bg-white dark:bg-[#0E1523] text-emerald-700 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{tr('Pemasukan', 'Income')}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10.5px] font-mono tabular-nums">
              {incomeSummary.items.length}
            </span>
          </button>
        </div>

        {isFutureMonth && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span>
              {tr(
                `Perencanaan Bulan Mendatang (${formatMonthLabel(activeMonth)})`,
                `Future Month Planning (${formatMonthLabel(activeMonth)})`
              )}
            </span>
          </div>
        )}
      </div>

      {/* Budget Section */}
      <section className="border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E1523] rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800/80">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {activeBudgetType === 'income'
                ? tr('Budget Pemasukan', 'Income Budgets')
                : tr('Budget Pengeluaran', 'Spending Budgets')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {formatMonthLabel(budgetSummary.monthKey)} ·{' '}
              {budgetSummary.items.length > 0
                ? `${budgetSummary.items.length} ${tr('kategori dipantau', 'categories tracked')}`
                : activeBudgetType === 'income'
                  ? tr('Belum ada target pemasukan ditetapkan', 'No income targets configured yet')
                  : tr('Belum ada batas anggaran ditetapkan', 'No budget limits configured yet')}
              {activeBudgetType === 'expense' && budgetSummary.exceededCount > 0 && (
                <span className="text-red-600 dark:text-red-400 font-medium">
                  {' '}
                  · {budgetSummary.exceededCount} {tr('melebihi batas', 'exceeded')}
                </span>
              )}
              {activeBudgetType === 'expense' && budgetSummary.warningCount > 0 && (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {' '}
                  · {budgetSummary.warningCount} {tr('mendekati batas', 'near limit')}
                </span>
              )}
              {activeBudgetType === 'income' && budgetSummary.achievedCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {' '}
                  · {budgetSummary.achievedCount} {tr('target tercapai', 'targets achieved')}
                </span>
              )}
              {activeBudgetType === 'income' && budgetSummary.behindCount > 0 && (
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  {' '}
                  · {budgetSummary.behindCount} {tr('belum tercapai', 'in progress')}
                </span>
              )}
            </p>
          </div>

          {budgetSummary.hasMultiMonthBudgets && (
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
              {(
                [
                  { id: 'all', label: tr('Semua', 'All') },
                  { id: 'monthly', label: tr('Bulanan', 'Monthly') },
                  { id: 'multi', label: tr('Multi-Bulan', 'Multi-Month') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBudgetFilter(tab.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    budgetFilter === tab.id
                      ? 'bg-white dark:bg-[#0E1523] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {budgetSummary.items.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {activeBudgetType === 'income'
                ? tr(
                    'Tetapkan target pemasukan bulanan atau berkala per kategori (mis. Gaji, Bonus, Usaha & Freelance) untuk memantau realisasi pemasukan.',
                    'Set monthly or periodic income targets per category (e.g., Salary, Bonus, Freelance) to track income realization.'
                  )
                : tr(
                    'Tetapkan batas pengeluaran bulanan maupun berkala (seperti per 4 bulan untuk sekolah dan apartemen) agar sisa anggaran terpantau lewat progress bar.',
                    'Set monthly or periodic spending limits (e.g., every 4 months for school and apartment) to track remaining budget.'
                  )}
            </p>
            {!readOnly && onOpenBudgetManager && (
              <button
                type="button"
                onClick={() => onOpenBudgetManager(activeBudgetType)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {activeBudgetType === 'income'
                    ? tr('Tetapkan Target Pemasukan', 'Set Income Target')
                    : tr('Tetapkan Budget Kategori', 'Set Category Budget')}
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Overall Budget Summary Bar */}
            <div className="rounded-xl bg-slate-50/80 dark:bg-[#0B111C] border border-slate-100 dark:border-slate-800/80 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {activeBudgetType === 'income'
                    ? budgetSummary.hasMultiMonthBudgets
                      ? `${tr('Target Pemasukan Setara Bulanan', 'Monthly Equivalent Income Target')} (${budgetSummary.overallPercent.toFixed(1)}%)`
                      : `${tr('Total Realisasi Target Pemasukan', 'Total Income Target Realization')} (${budgetSummary.overallPercent.toFixed(1)}%)`
                    : budgetSummary.hasMultiMonthBudgets
                      ? `${tr('Beban Budget Setara Bulanan', 'Monthly Equivalent Budget Load')} (${budgetSummary.overallPercent.toFixed(1)}%)`
                      : `${tr('Total Penggunaan Budget', 'Total Budget Usage')} (${budgetSummary.overallPercent.toFixed(1)}%)`}
                </span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatMoney(budgetSummary.totalSpent, displayCurrency)}
                  </span>{' '}
                  / {formatMoney(budgetSummary.totalLimit, displayCurrency)}
                  {budgetSummary.hasMultiMonthBudgets && ` /${tr('bln', 'mo')}`}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  role="progressbar"
                  aria-label={
                    activeBudgetType === 'income'
                      ? tr('Total pencapaian budget pemasukan', 'Total income budget realization')
                      : tr('Total penggunaan budget bulanan', 'Total monthly budget usage')
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(budgetSummary.overallPercent)}
                  className={`h-full rounded-full transition-all duration-300 ${
                    activeBudgetType === 'income'
                      ? budgetSummary.overallStatus === 'safe'
                        ? 'bg-emerald-500'
                        : budgetSummary.overallStatus === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-sky-500'
                      : budgetSummary.overallStatus === 'exceeded'
                        ? 'bg-red-600'
                        : budgetSummary.overallStatus === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.max(2, budgetSummary.clampedOverallPercent)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>
                  {activeBudgetType === 'income'
                    ? budgetSummary.totalRemaining <= 0
                      ? `${tr('Melampaui target', 'Above target')}: +${formatMoney(Math.abs(budgetSummary.totalRemaining), displayCurrency)}${budgetSummary.hasMultiMonthBudgets ? `/${tr('bln', 'mo')}` : ''}`
                      : `${tr('Kurang dari target', 'Remaining to target')}: ${formatMoney(budgetSummary.totalRemaining, displayCurrency)}${budgetSummary.hasMultiMonthBudgets ? `/${tr('bln', 'mo')}` : ''}`
                    : budgetSummary.totalRemaining >= 0
                      ? `${tr('Sisa alokasi', 'Remaining')}: ${formatMoney(budgetSummary.totalRemaining, displayCurrency)}${budgetSummary.hasMultiMonthBudgets ? `/${tr('bln', 'mo')}` : ''}`
                      : `${tr('Melebihi alokasi', 'Over limit')}: ${formatMoney(Math.abs(budgetSummary.totalRemaining), displayCurrency)}${budgetSummary.hasMultiMonthBudgets ? `/${tr('bln', 'mo')}` : ''}`}
                </span>
                <span>
                  {budgetSummary.hasMultiMonthBudgets
                    ? tr(
                        'Rata-rata bulanan · detail per siklus di bawah',
                        'Monthly average · cycle details below'
                      )
                    : formatMonthLabel(budgetSummary.monthKey)}
                </span>
              </div>
            </div>

            {/* Per-Category Progress Bars Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {budgetSummary.items
                .filter((item) => {
                  if (budgetFilter === 'monthly') return item.periodMonths === 1;
                  if (budgetFilter === 'multi') return item.periodMonths > 1;
                  return true;
                })
                .map((item) => {
                  const barClass =
                    activeBudgetType === 'income'
                      ? item.status === 'safe'
                        ? 'bg-emerald-500'
                        : item.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-sky-500'
                      : item.status === 'exceeded'
                        ? 'bg-red-600'
                        : item.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-emerald-500';

                  return (
                    <div
                      key={item.budgetId}
                      className="rounded-xl bg-slate-50/70 dark:bg-[#0B111C] border border-slate-100 dark:border-slate-800/80 p-4 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CategoryBadgeIcon
                            categoryName={item.category}
                            iconOverride={item.iconKey}
                            colorOverride={item.color}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {item.category}
                              </p>
                              {item.isMonthOverride && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-semibold">
                                  {tr('Khusus Bulan Ini', 'Month Override')}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.periodMonths > 1
                                ? `${formatBudgetPeriodLabel(item.periodMonths)} (${item.cycleLabel})`
                                : tr('Per Bulan', 'Monthly')}{' '}
                              · {item.txCount} {tr('transaksi', 'transactions')}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-xs font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                            {formatMoney(item.spent, displayCurrency)}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                            {tr('dari', 'of')} {formatMoney(item.limit, displayCurrency)}
                          </p>
                        </div>
                      </div>

                      <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          role="progressbar"
                          aria-label={
                            activeBudgetType === 'income'
                              ? `Budget Pemasukan ${item.category}`
                              : `Budget ${item.category}`
                          }
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(item.percent)}
                          className={`h-full rounded-full transition-all duration-300 ${barClass}`}
                          style={{
                            width: `${item.spent > 0 ? Math.max(3, item.clampedPercent) : 0}%`,
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            activeBudgetType === 'income'
                              ? item.status === 'safe'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : item.status === 'warning'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-sky-600 dark:text-sky-400'
                              : item.status === 'exceeded'
                                ? 'text-red-600 dark:text-red-400'
                                : item.status === 'warning'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {item.status === 'safe' ? (
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                          ) : activeBudgetType === 'income' && item.status === 'behind' ? (
                            <Target className="w-3 h-3 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                          )}
                          <span>
                            {activeBudgetType === 'income'
                              ? item.status === 'safe'
                                ? tr('Target Tercapai', 'Target Reached')
                                : item.status === 'warning'
                                  ? tr('Mendekati Target', 'Near Target')
                                  : tr('Belum Tercapai', 'In Progress')
                              : item.status === 'exceeded'
                                ? tr('Melebihi Batas', 'Over Limit')
                                : item.status === 'warning'
                                  ? tr('Mendekati Batas', 'Near Limit')
                                  : tr('Aman', 'On Track')}{' '}
                            ({item.percent.toFixed(1)}%)
                          </span>
                        </span>

                        <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                          {activeBudgetType === 'income'
                            ? item.remaining <= 0
                              ? `+${formatMoney(Math.abs(item.remaining), displayCurrency)} ${tr('surplus', 'above')}`
                              : `${tr('Kurang', 'Short')} ${formatMoney(item.remaining, displayCurrency)}`
                            : item.remaining >= 0
                              ? `${tr('Sisa', 'Left')} ${formatMoney(item.remaining, displayCurrency)}`
                              : `+${formatMoney(Math.abs(item.remaining), displayCurrency)} over`}
                        </span>
                      </div>

                      {item.periodMonths > 1 && (
                        <p className="text-[10.5px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                          {tr('Setara', 'Equivalent to')}{' '}
                          {formatMoney(item.monthlyEquivalentLimit, displayCurrency)}/{tr('bln', 'mo')}
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
