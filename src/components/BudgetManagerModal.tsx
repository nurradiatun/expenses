import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Copy, TrendingUp, Wallet, X } from 'lucide-react';
import {
  mergeCategoryListsByType,
  normalizeCategoryKey,
  type CategoryBudget,
  type CustomCategory,
  type DisplayCurrency,
  type FinancialTransaction,
  type SupportedCurrency,
  type TransactionType,
} from '../types';
import { convertCurrency, formatMoney, formatMonthLabel } from '../lib/formatters';
import { CategoryBadgeIcon } from '../lib/categoryVisuals';
import {
  formatBudgetPeriodLabel,
  getBudgetCycleWindow,
  getBudgetSelectableMonths,
} from '../lib/budgetUtils';
import { useLanguage } from '../lib/i18n';

export interface BudgetSaveEntry {
  category: string;
  monthlyLimit: number;
  currency: SupportedCurrency;
  periodMonths?: number;
  anchorMonth?: string;
  budgetType?: TransactionType;
  targetMonth?: string;
}

interface BudgetManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgets: CategoryBudget[];
  transactions: FinancialTransaction[];
  customCategories: CustomCategory[];
  displayCurrency: DisplayCurrency;
  rateInput: number | Partial<Record<SupportedCurrency, number>>;
  activeMonth: string;
  initialBudgetType?: TransactionType;
  readOnly?: boolean;
  onSaveBudgets: (entries: BudgetSaveEntry[]) => Promise<void>;
}

interface DraftBudgetRow {
  limitText: string;
  periodMonths: number;
  isCustomPeriod: boolean;
  anchorMonth: string;
}

const PRESET_PERIOD_OPTIONS = [1, 2, 3, 4, 6, 12] as const;

function makeScopeKey(budgetType: TransactionType, scopeMode: 'default' | 'month', scopeMonth: string): string {
  return `${budgetType}::${scopeMode === 'month' ? scopeMonth : ''}`;
}

export const BudgetManagerModal: React.FC<BudgetManagerModalProps> = ({
  isOpen,
  onClose,
  budgets,
  transactions,
  customCategories,
  displayCurrency,
  rateInput,
  activeMonth,
  initialBudgetType = 'expense',
  readOnly = false,
  onSaveBudgets,
}) => {
  const { tr } = useLanguage();
  const [activeBudgetType, setActiveBudgetType] = useState<TransactionType>(initialBudgetType);
  const [scopeMode, setScopeMode] = useState<'default' | 'month'>('default');
  const [scopeMonth, setScopeMonth] = useState<string>(activeMonth);
  const [budgetCurrency, setBudgetCurrency] = useState<DisplayCurrency>(displayCurrency);
  const [draftsByScope, setDraftsByScope] = useState<Record<string, Record<string, DraftBudgetRow>>>({});
  const [dirtyScopes, setDirtyScopes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const selectableMonths = useMemo(() => {
    const base = getBudgetSelectableMonths(transactions, budgets, 12);
    if (activeMonth && /^\d{4}-\d{2}$/.test(activeMonth) && !base.includes(activeMonth)) {
      return [...base, activeMonth].sort((a, b) => (a < b ? 1 : -1));
    }
    return base;
  }, [transactions, budgets, activeMonth]);

  const effectiveMonthForHints = scopeMode === 'month' ? scopeMonth : activeMonth;
  const defaultAnchorMonth = `${(effectiveMonthForHints || currentMonthKey).slice(0, 4)}-01`;

  const getCategoriesForType = useCallback(
    (bType: TransactionType) => {
      const base = mergeCategoryListsByType(customCategories, transactions, bType);
      const seen = new Set(base.map((c) => normalizeCategoryKey(c)));
      const combined = [...base];
      for (const b of budgets) {
        const entryType: TransactionType = b.budgetType === 'income' ? 'income' : 'expense';
        if (entryType !== bType) continue;
        const k = normalizeCategoryKey(b.category);
        if (!seen.has(k)) {
          seen.add(k);
          combined.push(b.category);
        }
      }
      return combined;
    },
    [customCategories, transactions, budgets]
  );

  const activeCategories = useMemo(
    () => getCategoriesForType(activeBudgetType),
    [getCategoriesForType, activeBudgetType]
  );

  // Build initial draft map for any (budgetType, targetMonth) scope
  const buildDraftForScope = useCallback(
    (
      bType: TransactionType,
      targetMonth: string | undefined,
      targetCurrency: DisplayCurrency
    ): Record<string, DraftBudgetRow> => {
      const cats = getCategoriesForType(bType);
      const anchorFallback = `${(targetMonth || activeMonth || currentMonthKey).slice(0, 4)}-01`;
      const budgetByKey = new Map<string, CategoryBudget>();
      for (const b of budgets) {
        const entryType: TransactionType = b.budgetType === 'income' ? 'income' : 'expense';
        if (entryType !== bType) continue;
        const bTarget = b.targetMonth || undefined;
        if (bTarget !== targetMonth) continue;
        budgetByKey.set(normalizeCategoryKey(b.category), b);
      }

      const nextDraft: Record<string, DraftBudgetRow> = {};
      for (const cat of cats) {
        const existing = budgetByKey.get(normalizeCategoryKey(cat));
        if (existing && existing.monthlyLimit > 0) {
          const converted = convertCurrency(
            existing.monthlyLimit,
            existing.currency,
            targetCurrency,
            rateInput
          );
          const rounded =
            targetCurrency === 'IDR'
              ? Math.round(converted)
              : Math.round(converted * 100) / 100;
          const period =
            Number.isInteger(existing.periodMonths) && existing.periodMonths >= 1
              ? existing.periodMonths
              : 1;
          const isPreset = (PRESET_PERIOD_OPTIONS as readonly number[]).includes(period);
          nextDraft[cat] = {
            limitText: String(rounded),
            periodMonths: period,
            isCustomPeriod: !isPreset,
            anchorMonth: existing.anchorMonth || anchorFallback,
          };
        } else {
          nextDraft[cat] = {
            limitText: '',
            periodMonths: 1,
            isCustomPeriod: false,
            anchorMonth: anchorFallback,
          };
        }
      }
      return nextDraft;
    },
    [getCategoriesForType, budgets, activeMonth, currentMonthKey, rateInput]
  );

  // Initialize modal state whenever opened
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setBudgetCurrency(displayCurrency);
    setActiveBudgetType(initialBudgetType);
    const hasOverrideForActiveMonth = budgets.some(
      (b) =>
        (b.budgetType === 'income' ? 'income' : 'expense') === initialBudgetType &&
        b.targetMonth === activeMonth
    );
    const initialMode: 'default' | 'month' =
      (activeMonth && activeMonth > currentMonthKey) || hasOverrideForActiveMonth
        ? 'month'
        : 'default';
    const initialMonth = activeMonth || currentMonthKey;
    setScopeMode(initialMode);
    setScopeMonth(initialMonth);

    const initialKey = makeScopeKey(initialBudgetType, initialMode, initialMonth);
    setDraftsByScope({
      [initialKey]: buildDraftForScope(
        initialBudgetType,
        initialMode === 'month' ? initialMonth : undefined,
        displayCurrency
      ),
    });
    setDirtyScopes(new Set());
  }, [
    isOpen,
    initialBudgetType,
    displayCurrency,
    activeMonth,
    currentMonthKey,
    budgets,
    buildDraftForScope,
  ]);

  const currentScopeKey = makeScopeKey(activeBudgetType, scopeMode, scopeMonth);

  // Ensure current scope has hydrated draft when switching tab/month inside modal
  useEffect(() => {
    if (!isOpen) return;
    setDraftsByScope((prev) => {
      if (prev[currentScopeKey]) return prev;
      return {
        ...prev,
        [currentScopeKey]: buildDraftForScope(
          activeBudgetType,
          scopeMode === 'month' ? scopeMonth : undefined,
          budgetCurrency
        ),
      };
    });
  }, [
    isOpen,
    currentScopeKey,
    activeBudgetType,
    scopeMode,
    scopeMonth,
    budgetCurrency,
    buildDraftForScope,
  ]);

  const draftRows = draftsByScope[currentScopeKey] || {};

  // Index defaults for showing fallback hints when editing a specific/future month
  const defaultBudgetHintByCat = useMemo(() => {
    const map = new Map<string, CategoryBudget>();
    for (const b of budgets) {
      const bType: TransactionType = b.budgetType === 'income' ? 'income' : 'expense';
      if (bType !== activeBudgetType || b.targetMonth) continue;
      map.set(normalizeCategoryKey(b.category), b);
    }
    return map;
  }, [budgets, activeBudgetType]);

  // Index actual transactions by (monthKey, normalizedCategory) for live cycle hints
  const actualByMonthAndCat = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const fallbackCat = activeBudgetType === 'income' ? 'Pemasukan' : 'Lainnya';
    for (const tx of transactions) {
      if (tx.txType !== activeBudgetType) continue;
      const catKey = normalizeCategoryKey(tx.category || fallbackCat);
      const val = convertCurrency(tx.amount, tx.currency, budgetCurrency, rateInput);
      let bucket = map.get(tx.monthKey);
      if (!bucket) {
        bucket = new Map();
        map.set(tx.monthKey, bucket);
      }
      bucket.set(catKey, (bucket.get(catKey) || 0) + val);
    }
    return map;
  }, [transactions, activeBudgetType, budgetCurrency, rateInput]);

  const handleCurrencyChange = (nextCurr: DisplayCurrency) => {
    if (nextCurr === budgetCurrency) return;
    setDraftsByScope((prev) => {
      const nextAll: Record<string, Record<string, DraftBudgetRow>> = {};
      for (const [sKey, rows] of Object.entries(prev)) {
        const convertedRows: Record<string, DraftBudgetRow> = {};
        for (const [cat, row] of Object.entries(rows)) {
          const raw = row.limitText.trim();
          const num = Number(raw);
          if (!raw || !Number.isFinite(num) || num <= 0) {
            convertedRows[cat] = { ...row, limitText: '' };
          } else {
            const conv = convertCurrency(num, budgetCurrency, nextCurr, rateInput);
            const rounded =
              nextCurr === 'IDR' ? Math.round(conv) : Math.round(conv * 100) / 100;
            convertedRows[cat] = { ...row, limitText: String(rounded) };
          }
        }
        nextAll[sKey] = convertedRows;
      }
      return nextAll;
    });
    setBudgetCurrency(nextCurr);
  };

  const updateRow = (cat: string, patch: Partial<DraftBudgetRow>) => {
    setDraftsByScope((prev) => {
      const scopeDraft = prev[currentScopeKey] || {};
      const current = scopeDraft[cat] || {
        limitText: '',
        periodMonths: 1,
        isCustomPeriod: false,
        anchorMonth: defaultAnchorMonth,
      };
      return {
        ...prev,
        [currentScopeKey]: {
          ...scopeDraft,
          [cat]: { ...current, ...patch },
        },
      };
    });
    setDirtyScopes((prev) => {
      if (prev.has(currentScopeKey)) return prev;
      const next = new Set(prev);
      next.add(currentScopeKey);
      return next;
    });
  };

  const handleCopyDefaultsToMonth = () => {
    if (scopeMode !== 'month') return;
    setDraftsByScope((prev) => {
      const currentDraft = { ...(prev[currentScopeKey] || {}) };
      for (const cat of activeCategories) {
        const def = defaultBudgetHintByCat.get(normalizeCategoryKey(cat));
        if (!def || def.monthlyLimit <= 0) continue;
        const conv = convertCurrency(def.monthlyLimit, def.currency, budgetCurrency, rateInput);
        const rounded =
          budgetCurrency === 'IDR' ? Math.round(conv) : Math.round(conv * 100) / 100;
        const period =
          Number.isInteger(def.periodMonths) && def.periodMonths >= 1 ? def.periodMonths : 1;
        const isPreset = (PRESET_PERIOD_OPTIONS as readonly number[]).includes(period);
        currentDraft[cat] = {
          limitText: String(rounded),
          periodMonths: period,
          isCustomPeriod: !isPreset,
          anchorMonth: def.anchorMonth || defaultAnchorMonth,
        };
      }
      return {
        ...prev,
        [currentScopeKey]: currentDraft,
      };
    });
    setDirtyScopes((prev) => {
      const next = new Set(prev);
      next.add(currentScopeKey);
      return next;
    });
  };

  const totalDraftSummary = useMemo(() => {
    let monthlyEquivalentTotal = 0;
    let activeCount = 0;
    let multiMonthCount = 0;
    for (const cat of activeCategories) {
      const row = draftRows[cat];
      if (!row) continue;
      const val = Number(row.limitText);
      const period = Math.max(1, Math.min(36, Math.round(row.periodMonths || 1)));
      if (Number.isFinite(val) && val > 0) {
        monthlyEquivalentTotal += val / period;
        activeCount += 1;
        if (period > 1) multiMonthCount += 1;
      }
    }
    return { monthlyEquivalentTotal, activeCount, multiMonthCount };
  }, [activeCategories, draftRows]);

  if (!isOpen) return null;

  const isFutureTargetMonth = scopeMode === 'month' && scopeMonth > currentMonthKey;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setError(null);
    setSaving(true);
    try {
      const scopesToPersist = new Set<string>(dirtyScopes);
      if (scopesToPersist.size === 0) {
        scopesToPersist.add(currentScopeKey);
      }

      const entries: BudgetSaveEntry[] = [];
      for (const sKey of scopesToPersist) {
        const [rawType, rawTargetMonth] = sKey.split('::');
        const bType: TransactionType = rawType === 'income' ? 'income' : 'expense';
        const targetMonth = rawTargetMonth && /^\d{4}-\d{2}$/.test(rawTargetMonth) ? rawTargetMonth : undefined;
        const cats = getCategoriesForType(bType);
        const rows = draftsByScope[sKey] || {};

        for (const cat of cats) {
          const row = rows[cat];
          const raw = (row?.limitText || '').trim();
          const parsed = Number(raw);
          const period = Math.max(1, Math.min(36, Math.round(row?.periodMonths || 1)));
          const anchor =
            period > 1 && row?.anchorMonth && /^\d{4}-\d{2}$/.test(row.anchorMonth)
              ? row.anchorMonth
              : undefined;

          const entry: BudgetSaveEntry = {
            category: cat,
            monthlyLimit: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
            currency: budgetCurrency as SupportedCurrency,
            periodMonths: period,
            ...(anchor ? { anchorMonth: anchor } : {}),
            ...(bType === 'income' ? { budgetType: 'income' as const } : {}),
            ...(targetMonth ? { targetMonth } : {}),
          };
          entries.push(entry);
        }
      }

      await onSaveBudgets(entries);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan batas budget.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-modal-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                activeBudgetType === 'income'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-teal-50 dark:bg-emerald-500/10 text-teal-700 dark:text-emerald-400'
              }`}
            >
              {activeBudgetType === 'income' ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <Wallet className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="budget-modal-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white truncate"
              >
                {activeBudgetType === 'income'
                  ? tr('Atur Budget Pemasukan per Kategori', 'Manage Income Budgets by Category')
                  : tr('Atur Budget Pengeluaran per Kategori', 'Manage Spending Budgets by Category')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {activeBudgetType === 'income'
                  ? tr(
                      'Tetapkan target pemasukan bulanan atau berkala untuk bulan saat ini maupun mendatang',
                      'Set monthly or periodic income targets for current and upcoming months'
                    )
                  : tr(
                      'Dapat diatur bulanan atau per beberapa bulan (mis. per 4 bulan untuk sekolah & apartemen)',
                      'Configure monthly or multi-month limits (e.g., every 4 months for school & apartment)'
                    )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup modal budget', 'Close budget modal')}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 flex flex-col min-h-0">
          {/* Type Switcher + Scope (Default vs Specific/Future Month) + Currency */}
          <div className="px-6 py-3 bg-slate-50/80 dark:bg-[#0B111C] border-b border-slate-200 dark:border-slate-800/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Budget Type Tabs */}
              <div
                role="tablist"
                aria-label={tr('Jenis budget', 'Budget type')}
                className="inline-flex items-center p-0.5 rounded-xl bg-slate-200/70 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeBudgetType === 'expense'}
                  onClick={() => setActiveBudgetType('expense')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    activeBudgetType === 'expense'
                      ? 'bg-white dark:bg-[#0E1523] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Budget Pengeluaran', 'Spending Budgets')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeBudgetType === 'income'}
                  onClick={() => setActiveBudgetType('income')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    activeBudgetType === 'income'
                      ? 'bg-white dark:bg-[#0E1523] text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr('Budget Pemasukan', 'Income Budgets')}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="budget-currency-select"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  {tr('Mata Uang:', 'Currency:')}
                </label>
                <select
                  id="budget-currency-select"
                  value={budgetCurrency}
                  onChange={(e) => handleCurrencyChange(e.target.value as DisplayCurrency)}
                  className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1523] text-slate-900 dark:text-white"
                >
                  <option value="AED">AED</option>
                  <option value="IDR">IDR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            {/* Scope Row: Recurring Default vs Specific/Future Month */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <CalendarClock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{tr('Berlaku untuk:', 'Applies to:')}</span>
                </span>
                <select
                  aria-label={tr('Cakupan bulan budget', 'Budget month scope')}
                  value={scopeMode}
                  onChange={(e) =>
                    setScopeMode(e.target.value === 'month' ? 'month' : 'default')
                  }
                  className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1523] text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <option value="default">
                    {tr('Semua Bulan (Default Berulang)', 'All Months (Recurring Default)')}
                  </option>
                  <option value="month">
                    {tr('Khusus Bulan Tertentu / Mendatang', 'Specific / Future Month Override')}
                  </option>
                </select>

                {scopeMode === 'month' && (
                  <select
                    aria-label={tr('Pilih bulan target budget', 'Select target budget month')}
                    value={scopeMonth}
                    onChange={(e) => setScopeMonth(e.target.value)}
                    className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 cursor-pointer"
                  >
                    {selectableMonths.map((m) => (
                      <option key={m} value={m} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                        {formatMonthLabel(m)}
                        {m > currentMonthKey ? ` (${tr('Mendatang', 'Future')})` : ''}
                      </option>
                    ))}
                  </select>
                )}

                {isFutureTargetMonth && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-semibold">
                    {tr('Perencanaan Mendatang', 'Future Planning')}
                  </span>
                )}
              </div>

              {scopeMode === 'month' && defaultBudgetHintByCat.size > 0 && !readOnly && (
                <button
                  type="button"
                  onClick={handleCopyDefaultsToMonth}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E1523] text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{tr('Salin dari Default', 'Copy from Default')}</span>
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {scopeMode === 'month'
                ? tr(
                    `Khusus bulan ${formatMonthLabel(scopeMonth)}. Kosongkan untuk mengikuti budget default (jika ada).`,
                    `Specific to ${formatMonthLabel(scopeMonth)}. Leave blank to follow recurring default (if set).`
                  )
                : tr(
                    `Periode aktif: ${formatMonthLabel(activeMonth)} · Kosongkan jika tanpa batas.`,
                    `Active period: ${formatMonthLabel(activeMonth)} · Leave blank for no limit.`
                  )}
            </p>
          </div>

          {error && (
            <div className="mx-6 mt-4 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-slate-100 dark:divide-slate-800/80">
            {activeCategories.map((cat) => {
              const row = draftRows[cat] || {
                limitText: '',
                periodMonths: 1,
                isCustomPeriod: false,
                anchorMonth: defaultAnchorMonth,
              };
              const periodMonths = Math.max(1, Math.min(36, Math.round(row.periodMonths || 1)));
              const cycle = getBudgetCycleWindow(effectiveMonthForHints, periodMonths, row.anchorMonth);
              const catKey = normalizeCategoryKey(cat);

              let actualInCycle = 0;
              for (const mKey of cycle.monthKeys) {
                actualInCycle += actualByMonthAndCat.get(mKey)?.get(catKey) || 0;
              }

              const rawVal = row.limitText;
              const numVal = Number(rawVal);
              const hasLimit = rawVal.trim() !== '' && Number.isFinite(numVal) && numVal > 0;
              const isOverOrReached =
                activeBudgetType === 'expense'
                  ? hasLimit && actualInCycle > numVal
                  : hasLimit && actualInCycle >= numVal;

              const defaultFallback = scopeMode === 'month' ? defaultBudgetHintByCat.get(catKey) : undefined;
              const fallbackConverted = defaultFallback
                ? convertCurrency(
                    defaultFallback.monthlyLimit,
                    defaultFallback.currency,
                    budgetCurrency,
                    rateInput
                  )
                : null;

              const selectValue = row.isCustomPeriod
                ? 'custom'
                : (PRESET_PERIOD_OPTIONS as readonly number[]).includes(periodMonths)
                  ? String(periodMonths)
                  : 'custom';

              return (
                <div key={`${currentScopeKey}-${cat}`} className="py-3.5 space-y-2.5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <CategoryBadgeIcon
                        categoryName={cat}
                        customCategories={customCategories}
                        txType={activeBudgetType}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {cat}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {activeBudgetType === 'income'
                            ? tr('Tercatat', 'Recorded')
                            : tr('Terpakai', 'Spent')}{' '}
                          {periodMonths > 1
                            ? `${tr('siklus', 'cycle')} (${cycle.label})`
                            : formatMonthLabel(effectiveMonthForHints)}
                          : {formatMoney(actualInCycle, budgetCurrency)}
                          {isOverOrReached && (
                            <span
                              className={`font-semibold ${
                                activeBudgetType === 'income'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {' '}
                              ·{' '}
                              {activeBudgetType === 'income'
                                ? tr('Target tercapai', 'Target reached')
                                : tr('Melebihi batas', 'Over limit')}
                            </span>
                          )}
                        </p>
                        {fallbackConverted !== null && !hasLimit && (
                          <p className="text-[10.5px] text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                            {tr('Mengikuti default:', 'Following default:')}{' '}
                            {formatMoney(fallbackConverted, budgetCurrency)}
                            {defaultFallback && defaultFallback.periodMonths > 1
                              ? ` / ${defaultFallback.periodMonths} ${tr('bln', 'mo')}`
                              : `/${tr('bln', 'mo')}`}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {/* Period Preset Selector */}
                      <select
                        aria-label={`Periode budget ${cat}`}
                        disabled={readOnly}
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'custom') {
                            updateRow(cat, {
                              isCustomPeriod: true,
                              periodMonths: periodMonths > 1 ? periodMonths : 4,
                            });
                          } else {
                            updateRow(cat, {
                              isCustomPeriod: false,
                              periodMonths: Number(val),
                            });
                          }
                        }}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B111C] text-slate-800 dark:text-slate-200 cursor-pointer disabled:opacity-60"
                      >
                        <option value="1">Per 1 Bulan</option>
                        <option value="2">Per 2 Bulan</option>
                        <option value="3">Per 3 Bulan</option>
                        <option value="4">Per 4 Bulan</option>
                        <option value="6">Per 6 Bulan</option>
                        <option value="12">Per 12 Bulan</option>
                        <option value="custom">Kustom (N Bulan)</option>
                      </select>

                      {row.isCustomPeriod && (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={36}
                            disabled={readOnly}
                            aria-label={`Jumlah bulan kustom ${cat}`}
                            value={row.periodMonths}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              updateRow(cat, {
                                periodMonths: Number.isFinite(n)
                                  ? Math.max(1, Math.min(36, Math.round(n)))
                                  : 1,
                              });
                            }}
                            className="w-14 px-2 py-1.5 text-center text-xs font-mono font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B111C] text-slate-900 dark:text-white disabled:opacity-60"
                          />
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">bln</span>
                        </div>
                      )}

                      {/* Budget Limit / Target Input */}
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-[11px] font-mono text-slate-400 pointer-events-none">
                          {budgetCurrency}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          disabled={readOnly}
                          aria-label={
                            activeBudgetType === 'income'
                              ? `Target pemasukan ${cat}`
                              : `Batas budget ${cat}`
                          }
                          placeholder={
                            scopeMode === 'month' && fallbackConverted !== null
                              ? tr('Ikuti default', 'Follow default')
                              : activeBudgetType === 'income'
                                ? tr('Tanpa target', 'No target')
                                : tr('Tanpa batas', 'No limit')
                          }
                          value={rawVal}
                          onChange={(e) => updateRow(cat, { limitText: e.target.value })}
                          className="w-36 pl-11 pr-3 py-1.5 text-right text-xs font-mono font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B111C] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 disabled:opacity-60"
                        />
                      </div>

                      {hasLimit && !readOnly && (
                        <button
                          type="button"
                          onClick={() => updateRow(cat, { limitText: '' })}
                          aria-label={`Hapus batas ${cat}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Multi-Month Cycle Anchor & Monthly Equivalent Row */}
                  {periodMonths > 1 && (
                    <div className="pl-11 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`anchor-${cat}`}
                          className="text-slate-500 dark:text-slate-400"
                        >
                          Mulai siklus:
                        </label>
                        <input
                          id={`anchor-${cat}`}
                          type="month"
                          disabled={readOnly}
                          aria-label={`Mulai siklus ${cat}`}
                          value={row.anchorMonth}
                          onChange={(e) =>
                            updateRow(cat, { anchorMonth: e.target.value || defaultAnchorMonth })
                          }
                          className="px-2 py-0.5 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B111C] text-slate-700 dark:text-slate-200 disabled:opacity-60"
                        />
                        <span>
                          · {formatBudgetPeriodLabel(periodMonths)} ({cycle.label})
                        </span>
                      </div>
                      {hasLimit && (
                        <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-medium">
                          Setara {formatMoney(numVal / periodMonths, budgetCurrency)}/bln
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#0B111C] flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {activeBudgetType === 'income'
                ? totalDraftSummary.multiMonthCount > 0
                  ? tr('Target Pemasukan Setara Bulanan:', 'Monthly Equivalent Income Target:')
                  : tr('Total Target Pemasukan Bulanan:', 'Total Monthly Income Target:')
                : totalDraftSummary.multiMonthCount > 0
                  ? 'Rata-rata Setara Bulanan:'
                  : 'Total Budget Bulanan:'}{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {formatMoney(totalDraftSummary.monthlyEquivalentTotal, budgetCurrency)}
              </span>{' '}
              ({totalDraftSummary.activeCount} kategori
              {totalDraftSummary.multiMonthCount > 0
                ? ` · ${totalDraftSummary.multiMonthCount} multi-bulan`
                : ''}
              )
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {tr('Batal', 'Cancel')}
              </button>
              {!readOnly && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {saving ? tr('Menyimpan...', 'Saving...') : tr('Simpan Budget', 'Save Budgets')}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
