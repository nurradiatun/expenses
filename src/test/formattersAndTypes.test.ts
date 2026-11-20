import { describe, expect, it } from 'vitest';
import { convertCurrency, formatMoney, formatMonthLabel, formatShortDate } from '../lib/formatters';
import {
  EXPENSE_CATEGORIES,
  formatAccountProviderLabel,
  getBuiltInCategoryType,
  getPureCustomCategories,
  getResolvedBuiltInCategories,
  getUnlistedTransactionCategories,
  INCOME_CATEGORIES,
  inferCategoryFromMerchant,
  isHouseholdGoodsMerchant,
  mergeCategoryListsByType,
  resolveBuiltInCategoryName,
  type CustomCategory,
  type FinancialTransaction,
} from '../types';

describe('Currency Conversion & Formatters', () => {
  it('converts between AED, IDR, and USD accurately using rate map', () => {
    const rates = { AED: 4350, IDR: 1, USD: 15950 };
    expect(convertCurrency(100, 'AED', 'AED', rates)).toBe(100);
    expect(convertCurrency(100, 'AED', 'IDR', rates)).toBe(435000);
    expect(convertCurrency(435000, 'IDR', 'AED', rates)).toBe(100);
    expect(convertCurrency(10, 'USD', 'IDR', rates)).toBe(159500);
  });

  it('formats money, short dates, and month labels cleanly', () => {
    expect(formatMoney(150000, 'IDR')).toContain('150.000');
    expect(formatMoney(250.5, 'AED')).toContain('250.50');
    expect(formatShortDate('2026-11-05')).toMatch(/05.*Nov.*2026/i);
    expect(formatMonthLabel('2026-11')).toMatch(/November.*2026/i);
  });
});

describe('Funding Source Labels & Category Separation', () => {
  it('formats ADCB and MANUAL (Cash) labels cleanly', () => {
    expect(formatAccountProviderLabel('ADCB')).toBe('ADCB');
    expect(formatAccountProviderLabel('MANUAL')).toBe('Cash');
  });

  it('separates expense and income built-in categories', () => {
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThan(0);
    expect(INCOME_CATEGORIES.length).toBeGreaterThan(0);
    expect(getBuiltInCategoryType('Makan & Minum')).toBe('expense');
    expect(getBuiltInCategoryType('Gaji')).toBe('income');
    expect(getBuiltInCategoryType('Investasi & Bunga')).toBe('income');
  });

  it('infers categories separately for expense, income, and household merchants', () => {
    expect(isHouseholdGoodsMerchant('IKEA Yas Island')).toBe(true);
    expect(inferCategoryFromMerchant('IKEA Abu Dhabi', false)).toBe('Barang Rumah Tangga');
    expect(inferCategoryFromMerchant('ADNOC Station 412', false)).toBe('Transportasi');
    expect(inferCategoryFromMerchant('Monthly Salary Payroll', true)).toBe('Gaji');
    expect(inferCategoryFromMerchant('ADCB Cashback Reward', true)).toBe('Cashback & Refund');
  });

  it('resolves built-in overrides (rename, delete, icon/color) and pure custom categories by type', () => {
    const customDocs: CustomCategory[] = [
      {
        id: 'ov-1',
        ownerId: 'u1',
        systemKey: 'Makan & Minum',
        name: 'Kuliner & Kopi',
        categoryType: 'expense',
        icon: 'Coffee',
        color: '#EA580C',
      },
      {
        id: 'ov-2',
        ownerId: 'u1',
        systemKey: 'Biaya Bank',
        name: 'Biaya Bank',
        categoryType: 'expense',
        deleted: true,
      },
      {
        id: 'cust-1',
        ownerId: 'u1',
        name: 'Zakat & Sedekah',
        categoryType: 'expense',
        icon: 'ShieldCheck',
        color: '#0F766E',
      },
      {
        id: 'cust-2',
        ownerId: 'u1',
        name: 'Dividen Saham',
        categoryType: 'income',
        icon: 'TrendingUp',
        color: '#7C3AED',
      },
    ];

    const expenseResolved = getResolvedBuiltInCategories(customDocs, 'expense');
    expect(expenseResolved.hasOverrides).toBe(true);
    expect(expenseResolved.deletedSystemKeys).toContain('Biaya Bank');
    const renamed = expenseResolved.active.find((item) => item.systemKey === 'Makan & Minum');
    expect(renamed?.name).toBe('Kuliner & Kopi');
    expect(renamed?.icon).toBe('Coffee');
    expect(renamed?.isModified).toBe(true);

    expect(resolveBuiltInCategoryName('Makan & Minum', customDocs, 'expense')).toBe('Kuliner & Kopi');
    expect(resolveBuiltInCategoryName('Biaya Bank', customDocs, 'expense')).toBe('Lainnya');

    const pureExpense = getPureCustomCategories(customDocs, 'expense');
    const pureIncome = getPureCustomCategories(customDocs, 'income');
    expect(pureExpense.map((c) => c.name)).toEqual(['Zakat & Sedekah']);
    expect(pureIncome.map((c) => c.name)).toEqual(['Dividen Saham']);

    const txs: FinancialTransaction[] = [
      {
        id: 'tx-1',
        ownerId: 'u1',
        accountId: 'acc-1',
        monthKey: '2026-11',
        txType: 'expense',
        source: 'manual',
        date: '2026-11-10',
        description: 'Kursus',
        merchant: 'Akademi',
        amount: 500,
        currency: 'AED',
        category: 'Pendidikan Khusus',
        reference: '',
        notes: '',
      },
    ];

    const mergedExpense = mergeCategoryListsByType(customDocs, txs, 'expense');
    expect(mergedExpense).toContain('Kuliner & Kopi');
    expect(mergedExpense).toContain('Zakat & Sedekah');
    expect(mergedExpense).toContain('Pendidikan Khusus');
    expect(mergedExpense).not.toContain('Dividen Saham');

    const unlisted = getUnlistedTransactionCategories(customDocs, txs, 'expense');
    expect(unlisted).toEqual(['Pendidikan Khusus']);
  });
});
