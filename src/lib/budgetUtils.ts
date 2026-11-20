import {
  normalizeCategoryKey,
  type CategoryBudget,
  type CustomCategory,
  type DisplayCurrency,
  type FinancialTransaction,
  type SupportedCurrency,
  type TransactionType,
} from '../types';
import { convertCurrency, formatShortMonthLabel } from './formatters';
import { resolveCategoryAppearance } from './categoryVisuals';

export type BudgetStatus = 'safe' | 'warning' | 'exceeded' | 'behind';

export interface BudgetCycleWindow {
  periodMonths: number;
  anchorMonth: string;
  startMonth: string;
  endMonth: string;
  monthKeys: string[];
  label: string;
}

export interface CategoryBudgetProgress {
  budgetId: string;
  budgetType: TransactionType;
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  percent: number;
  clampedPercent: number;
  status: BudgetStatus;
  txCount: number;
  originalLimit: number;
  originalCurrency: SupportedCurrency;
  periodMonths: number;
  anchorMonth: string;
  targetMonth?: string;
  isMonthOverride: boolean;
  cycleStartMonth: string;
  cycleEndMonth: string;
  cycleLabel: string;
  monthlyEquivalentLimit: number;
  monthlyEquivalentSpent: number;
  color: string;
  iconKey?: string;
}

export interface MonthlyBudgetSummary {
  monthKey: string;
  budgetType: TransactionType;
  items: CategoryBudgetProgress[];
  totalLimit: number;
  totalSpent: number;
  totalRemaining: number;
  overallPercent: number;
  clampedOverallPercent: number;
  overallStatus: BudgetStatus;
  hasMultiMonthBudgets: boolean;
  exceededCount: number;
  warningCount: number;
  achievedCount: number;
  behindCount: number;
}

function monthKeyToIndex(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  }
  return y * 12 + (m - 1);
}

function indexToMonthKey(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function getBudgetSelectableMonths(
  transactions: Array<Pick<FinancialTransaction, 'monthKey'>> = [],
  budgets: Array<Pick<CategoryBudget, 'targetMonth' | 'anchorMonth'>> = [],
  futureMonthsAhead = 12,
  referenceDate = new Date()
): string[] {
  const set = new Set<string>();
  const baseIdx = referenceDate.getFullYear() * 12 + referenceDate.getMonth();
  for (let offset = 0; offset <= futureMonthsAhead; offset += 1) {
    set.add(indexToMonthKey(baseIdx + offset));
  }
  for (const tx of transactions) {
    if (tx.monthKey && /^\d{4}-\d{2}$/.test(tx.monthKey)) {
      set.add(tx.monthKey);
    }
  }
  for (const b of budgets) {
    if (b.targetMonth && /^\d{4}-\d{2}$/.test(b.targetMonth)) {
      set.add(b.targetMonth);
    }
  }
  return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
}

export function formatBudgetPeriodLabel(periodMonths: number): string {
  if (periodMonths <= 1) return 'Per Bulan';
  if (periodMonths === 3) return 'Per 3 Bulan';
  if (periodMonths === 4) return 'Per 4 Bulan';
  if (periodMonths === 6) return 'Per 6 Bulan';
  if (periodMonths === 12) return 'Per Tahun';
  return `Per ${periodMonths} Bulan`;
}

export function getBudgetCycleWindow(
  activeMonth: string,
  periodMonthsRaw = 1,
  anchorMonthRaw?: string
): BudgetCycleWindow {
  const periodMonths =
    Number.isInteger(periodMonthsRaw) && periodMonthsRaw >= 1 && periodMonthsRaw <= 36
      ? periodMonthsRaw
      : 1;

  const yearPrefix = activeMonth.slice(0, 4) || String(new Date().getFullYear());
  const defaultAnchor = `${yearPrefix}-01`;
  const anchorMonth =
    anchorMonthRaw && /^\d{4}-\d{2}$/.test(anchorMonthRaw) ? anchorMonthRaw : defaultAnchor;

  if (periodMonths === 1) {
    return {
      periodMonths: 1,
      anchorMonth: activeMonth,
      startMonth: activeMonth,
      endMonth: activeMonth,
      monthKeys: [activeMonth],
      label: formatShortMonthLabel(activeMonth),
    };
  }

  const targetIdx = monthKeyToIndex(activeMonth);
  const anchorIdx = monthKeyToIndex(anchorMonth);
  const diff = targetIdx - anchorIdx;
  const cycleNum = Math.floor(diff / periodMonths);
  const startIdx = anchorIdx + cycleNum * periodMonths;
  const endIdx = startIdx + periodMonths - 1;

  const monthKeys: string[] = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    monthKeys.push(indexToMonthKey(i));
  }

  const startMonth = monthKeys[0];
  const endMonth = monthKeys[monthKeys.length - 1];
  const label = `${formatShortMonthLabel(startMonth)} – ${formatShortMonthLabel(endMonth)}`;

  return {
    periodMonths,
    anchorMonth,
    startMonth,
    endMonth,
    monthKeys,
    label,
  };
}

export function resolveEffectiveBudgetsForMonth(
  budgets: CategoryBudget[],
  monthKey: string,
  budgetType: TransactionType = 'expense'
): Array<CategoryBudget & { isMonthOverride: boolean }> {
  const overridesByCat = new Map<string, CategoryBudget>();
  const defaultsByCat = new Map<string, CategoryBudget>();

  for (const b of budgets) {
    if (b.monthlyLimit <= 0) continue;
    const bType: TransactionType = b.budgetType === 'income' ? 'income' : 'expense';
    if (bType !== budgetType) continue;
    const catKey = normalizeCategoryKey(b.category);
    if (!catKey) continue;

    if (b.targetMonth && /^\d{4}-\d{2}$/.test(b.targetMonth)) {
      if (b.targetMonth === monthKey) {
        overridesByCat.set(catKey, b);
      }
    } else {
      defaultsByCat.set(catKey, b);
    }
  }

  const resolved: Array<CategoryBudget & { isMonthOverride: boolean }> = [];
  const seen = new Set<string>();

  for (const [catKey, b] of overridesByCat.entries()) {
    seen.add(catKey);
    resolved.push({ ...b, isMonthOverride: true });
  }
  for (const [catKey, b] of defaultsByCat.entries()) {
    if (!seen.has(catKey)) {
      resolved.push({ ...b, isMonthOverride: false });
    }
  }

  return resolved;
}

export function computeMonthlyBudgetProgress(params: {
  budgets: CategoryBudget[];
  transactions: FinancialTransaction[];
  customCategories?: CustomCategory[];
  monthKey: string;
  displayCurrency: DisplayCurrency;
  rateInput: number | Partial<Record<SupportedCurrency, number>>;
  budgetType?: TransactionType;
}): MonthlyBudgetSummary {
  const {
    budgets,
    transactions,
    customCategories = [],
    monthKey,
    displayCurrency,
    rateInput,
    budgetType = 'expense',
  } = params;

  // Index matching transactions by (monthKey, normalizedCategory) for fast multi-month window summation
  const amountByMonthAndCat = new Map<string, Map<string, { amount: number; txCount: number }>>();
  const fallbackCat = budgetType === 'income' ? 'Pemasukan' : 'Lainnya';

  for (const tx of transactions) {
    if (tx.txType !== budgetType) continue;
    const catKey = normalizeCategoryKey(tx.category || fallbackCat);
    const converted = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);

    let monthBucket = amountByMonthAndCat.get(tx.monthKey);
    if (!monthBucket) {
      monthBucket = new Map();
      amountByMonthAndCat.set(tx.monthKey, monthBucket);
    }

    const prev = monthBucket.get(catKey) || { amount: 0, txCount: 0 };
    prev.amount += converted;
    prev.txCount += 1;
    monthBucket.set(catKey, prev);
  }

  const effectiveBudgets = resolveEffectiveBudgetsForMonth(budgets, monthKey, budgetType);

  let totalEquivalentLimit = 0;
  let totalEquivalentSpent = 0;
  let exceededCount = 0;
  let warningCount = 0;
  let achievedCount = 0;
  let behindCount = 0;
  let hasMultiMonthBudgets = false;

  const items: CategoryBudgetProgress[] = effectiveBudgets
    .map((b) => {
      const periodMonths =
        Number.isInteger(b.periodMonths) && b.periodMonths >= 1 && b.periodMonths <= 36
          ? b.periodMonths
          : 1;
      if (periodMonths > 1) hasMultiMonthBudgets = true;

      const cycle = getBudgetCycleWindow(monthKey, periodMonths, b.anchorMonth);
      const limit = convertCurrency(b.monthlyLimit, b.currency, displayCurrency, rateInput);
      const catKey = normalizeCategoryKey(b.category);

      let spent = 0;
      let txCount = 0;
      for (const mKey of cycle.monthKeys) {
        const stats = amountByMonthAndCat.get(mKey)?.get(catKey);
        if (stats) {
          spent += stats.amount;
          txCount += stats.txCount;
        }
      }

      const remaining = limit - spent;
      const percent = limit > 0 ? (spent / limit) * 100 : 0;
      const clampedPercent = Math.max(0, Math.min(100, percent));

      let status: BudgetStatus;
      if (budgetType === 'income') {
        if (percent >= 100) {
          status = 'safe';
          achievedCount += 1;
        } else if (percent >= 60) {
          status = 'warning';
          warningCount += 1;
        } else {
          status = 'behind';
          behindCount += 1;
        }
      } else {
        if (percent > 100) {
          status = 'exceeded';
          exceededCount += 1;
        } else if (percent >= 80) {
          status = 'warning';
          warningCount += 1;
        } else {
          status = 'safe';
        }
      }

      const monthlyEquivalentLimit = limit / periodMonths;
      const monthlyEquivalentSpent = spent / periodMonths;

      totalEquivalentLimit += monthlyEquivalentLimit;
      totalEquivalentSpent += monthlyEquivalentSpent;

      const appearance = resolveCategoryAppearance(b.category, customCategories, budgetType);

      return {
        budgetId: b.id,
        budgetType,
        category: b.category,
        limit,
        spent,
        remaining,
        percent,
        clampedPercent,
        status,
        txCount,
        originalLimit: b.monthlyLimit,
        originalCurrency: b.currency,
        periodMonths,
        anchorMonth: cycle.anchorMonth,
        ...(b.targetMonth ? { targetMonth: b.targetMonth } : {}),
        isMonthOverride: b.isMonthOverride,
        cycleStartMonth: cycle.startMonth,
        cycleEndMonth: cycle.endMonth,
        cycleLabel: cycle.label,
        monthlyEquivalentLimit,
        monthlyEquivalentSpent,
        color: appearance.color,
        iconKey: appearance.iconKey,
      };
    })
    .sort((a, b) => b.percent - a.percent || b.spent - a.spent);

  const totalRemaining = totalEquivalentLimit - totalEquivalentSpent;
  const overallPercent =
    totalEquivalentLimit > 0 ? (totalEquivalentSpent / totalEquivalentLimit) * 100 : 0;
  const clampedOverallPercent = Math.max(0, Math.min(100, overallPercent));
  const overallStatus: BudgetStatus =
    budgetType === 'income'
      ? overallPercent >= 100
        ? 'safe'
        : overallPercent >= 60
          ? 'warning'
          : 'behind'
      : overallPercent > 100
        ? 'exceeded'
        : overallPercent >= 80
          ? 'warning'
          : 'safe';

  return {
    monthKey,
    budgetType,
    items,
    totalLimit: totalEquivalentLimit,
    totalSpent: totalEquivalentSpent,
    totalRemaining,
    overallPercent,
    clampedOverallPercent,
    overallStatus,
    hasMultiMonthBudgets,
    exceededCount,
    warningCount,
    achievedCount,
    behindCount,
  };
}
