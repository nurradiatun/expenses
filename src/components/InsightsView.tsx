import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  FileUp,
  Info,
  Landmark,
  Lightbulb,
  Plus,
  Repeat,
  Store,
} from 'lucide-react';
import type {
  CustomCategory,
  DisplayCurrency,
  FinancialAccount,
  FinancialTransaction,
  SupportedCurrency,
} from '../types';
import { formatMoney, formatMonthLabel, formatShortDate } from '../lib/formatters';
import { CategoryBadgeIcon } from '../lib/categoryVisuals';
import {
  computeFinancialInsights,
  type InsightScope,
  type InsightTone,
} from '../lib/financialInsights';
import { useLanguage } from '../lib/i18n';

interface InsightsViewProps {
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  customCategories?: CustomCategory[];
  displayCurrency: DisplayCurrency;
  aedToIdrRate: number;
  fxRates?: Partial<Record<SupportedCurrency, number>>;
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
  onNavigate: (tab: 'dashboard' | 'transactions' | 'accounts' | 'export') => void;
  onOpenNewTx: () => void;
  onOpenPdfImport: () => void;
}

type NoticeFilter = 'all' | 'warning' | 'positive';
type DetailTab = 'merchants' | 'recurring' | 'sources';

export const InsightsView: React.FC<InsightsViewProps> = ({
  accounts,
  transactions,
  customCategories = [],
  displayCurrency,
  aedToIdrRate,
  fxRates,
  selectedMonth,
  onSelectMonth,
  onNavigate,
  onOpenNewTx,
  onOpenPdfImport,
}) => {
  const { tr } = useLanguage();
  const rateInput = fxRates ?? aedToIdrRate;
  const [scope, setScope] = useState<InsightScope>('month');
  const [noticeFilter, setNoticeFilter] = useState<NoticeFilter>('all');
  const [detailTab, setDetailTab] = useState<DetailTab>('merchants');

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(new Date().toISOString().slice(0, 7));
    for (const tx of transactions) {
      if (tx.monthKey) set.add(tx.monthKey);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions]);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : availableMonths[0];

  const report = useMemo(
    () =>
      computeFinancialInsights({
        transactions,
        accounts,
        customCategories,
        displayCurrency,
        rateInput,
        selectedMonth: activeMonth,
        scope,
      }),
    [transactions, accounts, customCategories, displayCurrency, rateInput, activeMonth, scope]
  );

  const filteredNotices = useMemo(() => {
    if (noticeFilter === 'all') return report.notices;
    return report.notices.filter((n) => n.tone === noticeFilter);
  }, [report.notices, noticeFilter]);

  const warningCount = useMemo(
    () => report.notices.filter((n) => n.tone === 'warning').length,
    [report.notices]
  );
  const positiveCount = useMemo(
    () => report.notices.filter((n) => n.tone === 'positive').length,
    [report.notices]
  );

  const renderToneMeta = (tone: InsightTone) => {
    if (tone === 'warning') {
      return {
        label: tr('Perlu Perhatian', 'Needs Attention'),
        colorClass: 'text-amber-700 dark:text-amber-400',
        Icon: AlertTriangle,
      };
    }
    if (tone === 'positive') {
      return {
        label: tr('Tren Positif', 'Positive Trend'),
        colorClass: 'text-emerald-700 dark:text-emerald-400',
        Icon: CheckCircle2,
      };
    }
    return {
      label: tr('Observasi', 'Observation'),
      colorClass: 'text-teal-700 dark:text-teal-400',
      Icon: Info,
    };
  };

  if (transactions.length === 0) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{tr('Kembali ke Ringkasan', 'Back to Overview')}</span>
        </button>

        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center mx-auto">
          <Lightbulb className="w-6 h-6" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            {tr('Belum ada data untuk dianalisis', 'No data to analyze yet')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {tr(
              'Catat transaksi manual atau impor mutasi PDF, gambar, maupun CSV untuk melihat insight otomatis pola pengeluaran dan arus kas Anda.',
              'Record manual transactions or import PDF, image, or CSV statements to view automated insights on your spending and cash flow.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenNewTx}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{tr('Catat Transaksi Pertama', 'Record First Transaction')}</span>
          </button>
          <button
            type="button"
            onClick={onOpenPdfImport}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>{tr('Import File Mutasi', 'Import Statement File')}</span>
          </button>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Control Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{tr('Kembali ke Ringkasan', 'Back to Overview')}</span>
          </button>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            {tr('Insight Keuangan', 'Financial Insights')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {report.periodLabel} · {report.totalTxCount}{' '}
            {tr('transaksi dianalisis secara lokal di perangkat Anda', 'transactions analyzed locally on your device')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {(
              [
                { id: 'month', label: tr('Bulan Ini', 'This Month') },
                { id: '3m', label: tr('3 Bulan', '3 Months') },
                { id: 'all', label: tr('Semua', 'All') },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScope(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  scope === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {scope !== 'all' && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={activeMonth}
                onChange={(e) => onSelectMonth(e.target.value)}
                aria-label={tr('Pilih bulan insight', 'Select insight month')}
                className="text-xs font-medium bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m} className="bg-white dark:bg-slate-900">
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Empty Scope State */}
      {report.totalTxCount === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-8 text-center space-y-3">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {tr(`Tidak ada transaksi pada ${report.periodLabel}.`, `No transactions in ${report.periodLabel}.`)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tr(
              'Pilih bulan lain atau tampilkan semua periode transaksi untuk melihat ringkasan insight.',
              'Choose another month or show all periods to view insights summary.'
            )}
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setScope('all')}
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {tr('Tampilkan Semua Periode', 'Show All Periods')}
            </button>
            <button
              type="button"
              onClick={onOpenNewTx}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium transition-colors cursor-pointer"
            >
              {tr('Catat Transaksi', 'Add Transaction')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 4-Column Quantitative Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{tr('Rasio Tabungan', 'Savings Rate')}</span>
                <span className="font-mono tabular-nums">
                  {report.incomeTxCount}x {tr('masuk', 'inflow')}
                </span>
              </div>
              <p
                className={`mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums ${
                  report.savingsRatePct === null
                    ? 'text-slate-500 dark:text-slate-400'
                    : report.netCashFlow >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {report.savingsRatePct !== null ? `${report.savingsRatePct.toFixed(1)}%` : '—'}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                {report.totalIncome > 0
                  ? `${report.netCashFlow >= 0 ? tr('Surplus', 'Surplus') : tr('Defisit', 'Deficit')} ${formatMoney(Math.abs(report.netCashFlow), displayCurrency)}`
                  : tr('Belum ada pemasukan periode ini', 'No income in this period yet')}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{tr('Rata-rata Harian', 'Daily Average')}</span>
                <span className="font-mono tabular-nums">
                  {report.activeDaysCount} {tr('hari aktif', 'active days')}
                </span>
              </div>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatMoney(report.avgDailyExpense, displayCurrency)}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                {report.projectedMonthExpense !== null
                  ? `${tr('Proyeksi sebulan', 'Monthly projection')}: ${formatMoney(report.projectedMonthExpense, displayCurrency)}`
                  : `${tr('Total keluar', 'Total outflow')}: ${formatMoney(report.totalExpense, displayCurrency)}`}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{tr('Tren Pengeluaran', 'Spending Trend')}</span>
                <span className="truncate">
                  {scope === 'month'
                    ? tr('vs Bulan Lalu', 'vs Last Month')
                    : scope === '3m'
                      ? tr('vs 3 Bln Sblm', 'vs Prior 3 Mos')
                      : tr('Periode Penuh', 'Full Period')}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {report.expenseDeltaPct !== null ? (
                  <>
                    {report.expenseDeltaPct > 0 ? (
                      <ArrowUpRight className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    <p
                      className={`font-mono text-2xl font-semibold tracking-tight tabular-nums ${
                        report.expenseDeltaPct > 10
                          ? 'text-amber-700 dark:text-amber-400'
                          : report.expenseDeltaPct < 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {report.expenseDeltaPct >= 0 ? '+' : ''}
                      {report.expenseDeltaPct.toFixed(1)}%
                    </p>
                  </>
                ) : (
                  <p className="font-mono text-2xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                    {formatMoney(report.totalExpense, displayCurrency)}
                  </p>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                {report.previousExpense > 0
                  ? `${tr('Sebelumnya', 'Previously')}: ${formatMoney(report.previousExpense, displayCurrency)}`
                  : `${report.expenseTxCount} ${tr('transaksi pengeluaran', 'expense transactions')}`}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{tr('Pengeluaran Terbesar', 'Largest Expense')}</span>
                <span className="truncate">
                  {report.largestExpenseTx ? formatShortDate(report.largestExpenseTx.date) : '—'}
                </span>
              </div>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {report.largestExpenseTx
                  ? formatMoney(report.largestExpenseTx.convertedAmount, displayCurrency)
                  : '—'}
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                {report.largestExpenseTx
                  ? `${report.largestExpenseTx.merchant} · ${report.largestExpenseTx.category}`
                  : tr('Belum ada transaksi keluar', 'No expense transactions yet')}
              </p>
            </div>
          </div>

          {/* Section 2: Sorotan & Temuan Otomatis */}
          <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {tr('Sorotan & Temuan Otomatis', 'Highlights & Automated Findings')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'Ringkasan anomali kategori, rasio tabungan, pola akhir pekan, dan merchant berulang',
                    'Summary of category anomalies, savings rate, weekend patterns, and recurring merchants'
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
                <button
                  type="button"
                  onClick={() => setNoticeFilter('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    noticeFilter === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Semua', 'All')} ({report.notices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setNoticeFilter('warning')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    noticeFilter === 'warning'
                      ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Perhatian', 'Attention')} ({warningCount})
                </button>
                <button
                  type="button"
                  onClick={() => setNoticeFilter('positive')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    noticeFilter === 'positive'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Positif', 'Positive')} ({positiveCount})
                </button>
              </div>
            </div>

            {filteredNotices.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                {tr('Tidak ada sorotan pada kategori filter ini.', 'No highlights in this filter category.')}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredNotices.map((notice) => {
                  const meta = renderToneMeta(notice.tone);
                  const ToneIcon = meta.Icon;
                  return (
                    <div
                      key={notice.id}
                      className="rounded-lg bg-slate-50/80 dark:bg-slate-950/60 p-4 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.colorClass}`}>
                          <ToneIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{meta.label}</span>
                          <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-normal text-slate-500 dark:text-slate-400">
                            {notice.topic}
                          </span>
                        </span>
                        {notice.metricLabel && (
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap shrink-0">
                            {notice.metricLabel}
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                        {notice.title}
                      </h4>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {notice.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section 3: 2-Column Deep Analytics (Weekday Pattern + Merchant/Recurring/Source) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left: Weekday Spending Habit */}
            <section className="lg:col-span-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                      {tr('Pola Pengeluaran per Hari', 'Daily Spending Pattern')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {tr(
                        'Distribusi belanja Senin–Minggu (hari kerja vs akhir pekan)',
                        'Monday–Sunday spending distribution (weekdays vs weekends)'
                      )}
                    </p>
                  </div>
                  {report.topWeekday && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                      {tr('Puncak', 'Peak')}: {report.topWeekday.label}
                    </span>
                  )}
                </div>

                <div className="h-56 w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={report.weekdayBuckets}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        axisLine={false}
                        tickLine={false}
                        width={64}
                      />
                      <Tooltip
                        formatter={(value: unknown) =>
                          formatMoney(Number(value ?? 0), displayCurrency)
                        }
                        labelFormatter={(label) => `${tr('Hari', 'Day')} ${String(label)}`}
                        contentStyle={{
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="total" name={tr('Pengeluaran', 'Expense')} radius={[4, 4, 0, 0]}>
                        {report.weekdayBuckets.map((bucket) => (
                          <Cell
                            key={bucket.label}
                            fill={bucket.isWeekend ? '#D97706' : '#0F766E'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-slate-500 dark:text-slate-400">
                    {tr('Rata-rata Hari Kerja (Sen–Jum)', 'Weekday Avg (Mon–Fri)')}
                  </p>
                  <p className="mt-1 font-mono font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
                    {formatMoney(report.weekdayAvgPerDay, displayCurrency)}/{tr('hari', 'day')}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">
                    {tr('Rata-rata Akhir Pekan (Sab–Min)', 'Weekend Avg (Sat–Sun)')}
                  </p>
                  <p className="mt-1 font-mono font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                    {formatMoney(report.weekendAvgPerDay, displayCurrency)}/{tr('hari', 'day')}
                  </p>
                </div>
              </div>
            </section>

            {/* Right: Top Merchants / Recurring / Funding Sources */}
            <section className="lg:col-span-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                      {tr('Merchant, Berulang & Sumber Dana', 'Merchants, Recurring & Funding Sources')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {tr(
                        'Konsentrasi pengeluaran berdasarkan merchant dan jalur pembayaran',
                        'Spending concentration by merchant and payment source'
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setDetailTab('merchants')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        detailTab === 'merchants'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Store className="w-3 h-3" />
                      <span>{tr('Merchant', 'Merchants')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('recurring')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        detailTab === 'recurring'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Repeat className="w-3 h-3" />
                      <span>{tr('Berulang', 'Recurring')} ({report.recurringCandidates.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('sources')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        detailTab === 'sources'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Landmark className="w-3 h-3" />
                      <span>{tr('Sumber Dana', 'Funding Sources')}</span>
                    </button>
                  </div>
                </div>

                {detailTab === 'merchants' && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
                    {report.topMerchants.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
                        {tr('Belum ada transaksi pengeluaran pada periode ini.', 'No expense transactions in this period.')}
                      </p>
                    ) : (
                      report.topMerchants.map((m) => (
                        <div key={m.merchantKey} className="py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <CategoryBadgeIcon
                                categoryName={m.category}
                                iconOverride={m.iconKey}
                                colorOverride={m.color}
                                size="sm"
                              />
                              <div className="min-w-0">
                                <p className="font-medium text-slate-900 dark:text-white truncate">
                                  {m.merchantName}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {m.category} · {m.count}x · {tr('Terakhir', 'Last')} {formatShortDate(m.lastDate)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                                {formatMoney(m.total, displayCurrency)}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {m.sharePct.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(3, Math.min(100, m.sharePct))}%`,
                                backgroundColor: m.color,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'recurring' && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
                    {report.recurringCandidates.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
                        {tr(
                          'Belum terdeteksi transaksi berulang (minimal muncul di 2 bulan berbeda atau ≥3 kali).',
                          'No recurring transactions detected yet (must appear in ≥2 distinct months or ≥3 times).'
                        )}
                      </p>
                    ) : (
                      report.recurringCandidates.map((rec) => (
                        <div
                          key={`${rec.merchantName}-${rec.lastDate}`}
                          className="py-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CategoryBadgeIcon
                              categoryName={rec.category}
                              customCategories={customCategories}
                              txType="expense"
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 dark:text-white truncate">
                                {rec.merchantName}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {rec.monthsCount} {tr('bulan', 'months')} · {rec.txCount}x {tr('transaksi', 'txs')} · {rec.category}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                              ~{formatMoney(rec.avgAmount, displayCurrency)}/tx
                            </p>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                              Total {formatMoney(rec.totalAmount, displayCurrency)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'sources' && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-2">
                    {report.fundingSourceSplits.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
                        {tr('Belum ada aktivitas sumber dana pada periode ini.', 'No funding source activity in this period.')}
                      </p>
                    ) : (
                      report.fundingSourceSplits.map((src) => (
                        <div key={src.accountId} className="py-3 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-white truncate">
                                {src.accountName}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                {src.providerLabel} · {src.txCount} {tr('transaksi', 'transactions')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                                -{formatMoney(src.expenseTotal, displayCurrency)}
                              </p>
                              <p className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                                +{formatMoney(src.incomeTotal, displayCurrency)} {tr('masuk', 'in')}
                              </p>
                            </div>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-teal-700 dark:bg-teal-500"
                              style={{
                                width: `${Math.max(2, Math.min(100, src.expenseSharePct))}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {tr('Ingin memeriksa detail baris transaksi?', 'Want to inspect transaction rows?')}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('transactions')}
                  className="font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  {tr('Buka Buku Kas →', 'Open Ledger →')}
                </button>
              </div>
            </section>
          </div>

          {/* Section 4: Category Month-over-Month Comparison Table */}
          <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {tr('Perbandingan Pengeluaran per Kategori', 'Spending Comparison by Category')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {scope === 'all'
                    ? tr('Peringkat kategori pengeluaran sepanjang semua periode', 'Spending category ranking across all periods')
                    : tr(
                        `Perbandingan ${report.periodLabel} terhadap periode sebelumnya`,
                        `Comparing ${report.periodLabel} against the previous period`
                      )}
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {report.categoryComparisons.length} {tr('kategori', 'categories')}
              </span>
            </div>

            {report.categoryComparisons.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                {tr('Belum ada pengeluaran per kategori pada periode ini.', 'No category expenses in this period yet.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 pr-4 font-semibold">{tr('Kategori', 'Category')}</th>
                      <th className="py-2.5 px-3 font-semibold text-right">{tr('Transaksi', 'Transactions')}</th>
                      <th className="py-2.5 px-3 font-semibold text-right">{tr('Periode Ini', 'This Period')}</th>
                      {scope !== 'all' && (
                        <>
                          <th className="py-2.5 px-3 font-semibold text-right">{tr('Periode Lalu', 'Prior Period')}</th>
                          <th className="py-2.5 px-3 font-semibold text-right">{tr('Perubahan', 'Change')}</th>
                        </>
                      )}
                      <th className="py-2.5 pl-3 font-semibold text-right">{tr('Porsi', 'Share')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {report.categoryComparisons.map((row) => (
                      <tr
                        key={row.category}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CategoryBadgeIcon
                              categoryName={row.category}
                              iconOverride={row.iconKey}
                              colorOverride={row.color}
                              size="xs"
                            />
                            <span className="font-medium text-slate-900 dark:text-white truncate">
                              {row.category}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                          {row.txCount}x
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                          {formatMoney(row.currentTotal, displayCurrency)}
                        </td>
                        {scope !== 'all' && (
                          <>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                              {formatMoney(row.previousTotal, displayCurrency)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                              {row.deltaPct !== null ? (
                                <span
                                  className={
                                    row.deltaPct > 10
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : row.deltaPct < 0
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-slate-600 dark:text-slate-300'
                                  }
                                >
                                  {row.deltaPct >= 0 ? '+' : ''}
                                  {row.deltaPct.toFixed(1)}%
                                </span>
                              ) : row.currentTotal > 0 ? (
                                <span className="text-slate-500 dark:text-slate-400">{tr('Baru', 'New')}</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="py-2.5 pl-3 text-right font-mono font-semibold tabular-nums">
                          <span style={{ color: row.color }}>{row.sharePct.toFixed(1)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
