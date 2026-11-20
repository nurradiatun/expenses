import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BudgetManagerModal } from '../components/BudgetManagerModal';
import { BudgetsView } from '../components/BudgetsView';
import { DashboardView } from '../components/DashboardView';
import { computeMonthlyBudgetProgress, getBudgetCycleWindow } from '../lib/budgetUtils';
import type {
  CategoryBudget,
  CustomCategory,
  FinancialAccount,
  FinancialTransaction,
} from '../types';

const accounts: FinancialAccount[] = [
  {
    id: 'acc-adcb',
    ownerId: 'u1',
    provider: 'ADCB',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'ADCB Savings',
    accountNumberMasked: '****1234',
    balance: 25000,
    institution: 'ADCB',
    notes: '',
  },
];

const customCategories: CustomCategory[] = [
  {
    id: 'cat-food',
    ownerId: 'u1',
    name: 'Makan & Minum',
    categoryType: 'expense',
    icon: 'Coffee',
    color: '#EA580C',
  },
  {
    id: 'cat-school',
    ownerId: 'u1',
    name: 'Sekolah',
    categoryType: 'expense',
    icon: 'GraduationCap',
    color: '#2563EB',
  },
];

const transactions: FinancialTransaction[] = [
  {
    id: 'tx-1',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'pdf',
    date: '2026-11-10',
    description: 'IKEA Home',
    merchant: 'IKEA',
    amount: 1200,
    currency: 'AED',
    category: 'Barang Rumah Tangga',
    reference: '',
    notes: '',
  },
  {
    id: 'tx-2',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'manual',
    date: '2026-11-12',
    description: 'Lunch & Coffee',
    merchant: 'Starbucks',
    amount: 450,
    currency: 'AED',
    category: 'Makan & Minum',
    reference: '',
    notes: '',
  },
  {
    id: 'tx-3',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'manual',
    date: '2026-11-14',
    description: 'Uber Ride',
    merchant: 'Uber',
    amount: 150,
    currency: 'AED',
    category: 'Transportasi',
    reference: '',
    notes: '',
  },
  // Paid in Sep 2026 — inside the Sep–Des 2026 4-month cycle when viewing Nov 2026!
  {
    id: 'tx-4',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-09',
    txType: 'expense',
    source: 'pdf',
    date: '2026-09-05',
    description: 'Term 1 Tuition Fee',
    merchant: 'International School',
    amount: 8000,
    currency: 'AED',
    category: 'Sekolah',
    reference: 'SCH-09',
    notes: '',
  },
  // Paid in May 2026 — previous 4-month cycle, should NOT be counted in Sep–Des 2026 cycle
  {
    id: 'tx-5',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-05',
    txType: 'expense',
    source: 'pdf',
    date: '2026-05-05',
    description: 'Previous Term Tuition',
    merchant: 'International School',
    amount: 8000,
    currency: 'AED',
    category: 'Sekolah',
    reference: 'SCH-05',
    notes: '',
  },
];

const monthlyBudgets: CategoryBudget[] = [
  {
    id: 'bdg-1',
    ownerId: 'u1',
    category: 'Barang Rumah Tangga',
    monthlyLimit: 1000, // 1200/1000 = 120% -> exceeded
    currency: 'AED',
    periodMonths: 1,
  },
  {
    id: 'bdg-2',
    ownerId: 'u1',
    category: 'Makan & Minum',
    monthlyLimit: 500, // 450/500 = 90% -> warning
    currency: 'AED',
    periodMonths: 1,
  },
  {
    id: 'bdg-3',
    ownerId: 'u1',
    category: 'Transportasi',
    monthlyLimit: 500, // 150/500 = 30% -> safe
    currency: 'AED',
    periodMonths: 1,
  },
];

describe('Monthly & Multi-Month Category Budgeting', () => {
  it('computes safe, warning, exceeded statuses accurately for monthly budgets', () => {
    const summary = computeMonthlyBudgetProgress({
      budgets: monthlyBudgets,
      transactions,
      customCategories,
      monthKey: '2026-11',
      displayCurrency: 'AED',
      rateInput: 4350,
    });

    expect(summary.hasMultiMonthBudgets).toBe(false);
    expect(summary.totalLimit).toBe(2000);
    expect(summary.totalSpent).toBe(1800);
    expect(summary.totalRemaining).toBe(200);
    expect(summary.overallPercent).toBeCloseTo(90, 1);
    expect(summary.overallStatus).toBe('warning');
    expect(summary.exceededCount).toBe(1);
    expect(summary.warningCount).toBe(1);
  });

  it('computes 4-month cycle windows accurately (e.g., Sekolah & Apartemen) and monthly equivalents', () => {
    const cycle = getBudgetCycleWindow('2026-11', 4, '2026-01');
    expect(cycle.startMonth).toBe('2026-09');
    expect(cycle.endMonth).toBe('2026-12');
    expect(cycle.monthKeys).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);

    const mixedBudgets: CategoryBudget[] = [
      ...monthlyBudgets,
      {
        id: 'bdg-school',
        ownerId: 'u1',
        category: 'Sekolah',
        monthlyLimit: 10000, // AED 10,000 per 4 months (2,500/bln)
        currency: 'AED',
        periodMonths: 4,
        anchorMonth: '2026-01',
      },
    ];

    const summary = computeMonthlyBudgetProgress({
      budgets: mixedBudgets,
      transactions,
      customCategories,
      monthKey: '2026-11',
      displayCurrency: 'AED',
      rateInput: 4350,
    });

    expect(summary.hasMultiMonthBudgets).toBe(true);
    const schoolItem = summary.items.find((i) => i.category === 'Sekolah');
    expect(schoolItem).toBeDefined();
    // Only Sep 2026 (8,000) falls in Sep–Des 2026 cycle; May 2026 (8,000) is excluded!
    expect(schoolItem?.spent).toBe(8000);
    expect(schoolItem?.limit).toBe(10000);
    expect(schoolItem?.percent).toBeCloseTo(80, 1);
    expect(schoolItem?.status).toBe('warning');
    expect(schoolItem?.monthlyEquivalentLimit).toBe(2500);
    expect(schoolItem?.monthlyEquivalentSpent).toBe(2000);
  });

  it('shows compact Budget Pengeluaran button on DashboardView without inline progress bars and navigates to budgets page', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const mixedBudgets: CategoryBudget[] = [
      ...monthlyBudgets,
      {
        id: 'bdg-school',
        ownerId: 'u1',
        category: 'Sekolah',
        monthlyLimit: 10000,
        currency: 'AED',
        periodMonths: 4,
        anchorMonth: '2026-01',
      },
    ];

    render(
      <DashboardView
        accounts={accounts}
        transactions={transactions}
        customCategories={customCategories}
        budgets={mixedBudgets}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onOpenNewTx={vi.fn()}
        onNavigate={onNavigate}
        onOpenPdfImport={vi.fn()}
      />
    );

    const budgetBtn = screen.getByRole('button', { name: /Budget Pengeluaran/i });
    expect(budgetBtn).toBeInTheDocument();
    // Progress bars should NOT clutter DashboardView anymore
    expect(screen.queryByRole('progressbar', { name: 'Budget Sekolah' })).not.toBeInTheDocument();

    await user.click(budgetBtn);
    expect(onNavigate).toHaveBeenCalledWith('budgets');
  });

  it('renders monthly and 4-month budget progress bars on BudgetsView with Multi-Bulan filter', async () => {
    const user = userEvent.setup();
    const onOpenBudgetManager = vi.fn();
    const onNavigate = vi.fn();
    const mixedBudgets: CategoryBudget[] = [
      ...monthlyBudgets,
      {
        id: 'bdg-school',
        ownerId: 'u1',
        category: 'Sekolah',
        monthlyLimit: 10000,
        currency: 'AED',
        periodMonths: 4,
        anchorMonth: '2026-01',
      },
    ];

    render(
      <BudgetsView
        transactions={transactions}
        customCategories={customCategories}
        budgets={mixedBudgets}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onNavigate={onNavigate}
        onOpenBudgetManager={onOpenBudgetManager}
      />
    );

    expect(screen.getByText('Budget Pengeluaran')).toBeInTheDocument();
    expect(screen.getByText(/Beban Budget Setara Bulanan/i)).toBeInTheDocument();

    const schoolBar = screen.getByRole('progressbar', { name: 'Budget Sekolah' });
    expect(schoolBar).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByText(/Per 4 Bulan/i)).toBeInTheDocument();
    expect(screen.getByText(/Setara AED 2,500\.00\/bln/i)).toBeInTheDocument();

    // Filter to Multi-Bulan only
    await user.click(screen.getByRole('button', { name: 'Multi-Bulan' }));
    expect(screen.getByRole('progressbar', { name: 'Budget Sekolah' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Budget Transportasi' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Atur Budget/i }));
    expect(onOpenBudgetManager).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Kembali ke Ringkasan/i }));
    expect(onNavigate).toHaveBeenCalledWith('dashboard');
  });

  it('allows setting per-4-month budget and anchor month in BudgetManagerModal', async () => {
    const user = userEvent.setup();
    const onSaveBudgets = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <BudgetManagerModal
        isOpen={true}
        onClose={onClose}
        budgets={monthlyBudgets}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        rateInput={4350}
        activeMonth="2026-11"
        onSaveBudgets={onSaveBudgets}
      />
    );

    expect(screen.getByText('Atur Budget Pengeluaran per Kategori')).toBeInTheDocument();

    // Configure Sekolah as Per 4 Bulan with limit 12000
    const schoolPeriod = screen.getByLabelText('Periode budget Sekolah');
    await user.selectOptions(schoolPeriod, '4');

    const schoolInput = screen.getByLabelText('Batas budget Sekolah');
    await user.clear(schoolInput);
    await user.type(schoolInput, '12000');

    expect(screen.getByText(/Setara AED 3,000\.00\/bln/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Simpan Budget/i }));

    expect(onSaveBudgets).toHaveBeenCalledTimes(1);
    const savedEntries = onSaveBudgets.mock.calls[0][0] as Array<{
      category: string;
      monthlyLimit: number;
      currency: string;
      periodMonths?: number;
      anchorMonth?: string;
    }>;
    const schoolEntry = savedEntries.find((e) => e.category === 'Sekolah');
    expect(schoolEntry).toEqual({
      category: 'Sekolah',
      monthlyLimit: 12000,
      currency: 'AED',
      periodMonths: 4,
      anchorMonth: '2026-01',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('computes income budgets accurately with achieved, warning, and behind statuses without mixing expense budgets', () => {
    const incomeTxs: FinancialTransaction[] = [
      ...transactions,
      {
        id: 'tx-inc-1',
        ownerId: 'u1',
        accountId: 'acc-adcb',
        monthKey: '2026-11',
        txType: 'income',
        source: 'pdf',
        date: '2026-11-01',
        description: 'Monthly Salary',
        merchant: 'Employer',
        amount: 10000,
        currency: 'AED',
        category: 'Gaji',
        reference: 'SAL-11',
        notes: '',
      },
      {
        id: 'tx-inc-2',
        ownerId: 'u1',
        accountId: 'acc-adcb',
        monthKey: '2026-11',
        txType: 'income',
        source: 'manual',
        date: '2026-11-10',
        description: 'Freelance Design',
        merchant: 'Client A',
        amount: 700,
        currency: 'AED',
        category: 'Usaha & Freelance',
        reference: '',
        notes: '',
      },
    ];

    const mixedTypeBudgets: CategoryBudget[] = [
      ...monthlyBudgets,
      {
        id: 'bdg-inc-gaji',
        ownerId: 'u1',
        category: 'Gaji',
        monthlyLimit: 10000, // 10000 / 10000 = 100% -> safe (Target Tercapai)
        currency: 'AED',
        periodMonths: 1,
        budgetType: 'income',
      },
      {
        id: 'bdg-inc-freelance',
        ownerId: 'u1',
        category: 'Usaha & Freelance',
        monthlyLimit: 1000, // 700 / 1000 = 70% -> warning (Mendekati Target)
        currency: 'AED',
        periodMonths: 1,
        budgetType: 'income',
      },
      {
        id: 'bdg-inc-bonus',
        ownerId: 'u1',
        category: 'Bonus & Tunjangan',
        monthlyLimit: 2000, // 0 / 2000 = 0% -> behind (Belum Tercapai)
        currency: 'AED',
        periodMonths: 1,
        budgetType: 'income',
      },
    ];

    const incomeSummary = computeMonthlyBudgetProgress({
      budgets: mixedTypeBudgets,
      transactions: incomeTxs,
      customCategories,
      monthKey: '2026-11',
      displayCurrency: 'AED',
      rateInput: 4350,
      budgetType: 'income',
    });

    expect(incomeSummary.budgetType).toBe('income');
    expect(incomeSummary.items).toHaveLength(3);
    expect(incomeSummary.totalLimit).toBe(13000);
    expect(incomeSummary.totalSpent).toBe(10700);
    expect(incomeSummary.achievedCount).toBe(1);
    expect(incomeSummary.warningCount).toBe(1);
    expect(incomeSummary.behindCount).toBe(1);
    expect(incomeSummary.exceededCount).toBe(0);

    // Expense summary ignores income budgets
    const expenseSummary = computeMonthlyBudgetProgress({
      budgets: mixedTypeBudgets,
      transactions: incomeTxs,
      customCategories,
      monthKey: '2026-11',
      displayCurrency: 'AED',
      rateInput: 4350,
      budgetType: 'expense',
    });
    expect(expenseSummary.items).toHaveLength(3);
  });

  it('resolves future-month spending budget overrides and allows editor role to edit future budgets', async () => {
    const user = userEvent.setup();
    const onOpenBudgetManager = vi.fn();
    const onSaveBudgets = vi.fn().mockResolvedValue(undefined);

    const budgetsWithFuture: CategoryBudget[] = [
      ...monthlyBudgets,
      {
        id: 'bdg-future-food',
        ownerId: 'owner-1',
        category: 'Makan & Minum',
        monthlyLimit: 900, // Override for 2027-01 instead of recurring default 500
        currency: 'AED',
        periodMonths: 1,
        budgetType: 'expense',
        targetMonth: '2027-01',
      },
    ];

    // Check progress resolution in 2027-01 vs 2026-11
    const novSummary = computeMonthlyBudgetProgress({
      budgets: budgetsWithFuture,
      transactions,
      customCategories,
      monthKey: '2026-11',
      displayCurrency: 'AED',
      rateInput: 4350,
      budgetType: 'expense',
    });
    expect(novSummary.items.find((i) => i.category === 'Makan & Minum')?.limit).toBe(500);
    expect(novSummary.items.find((i) => i.category === 'Makan & Minum')?.isMonthOverride).toBe(false);

    const janSummary = computeMonthlyBudgetProgress({
      budgets: budgetsWithFuture,
      transactions,
      customCategories,
      monthKey: '2027-01',
      displayCurrency: 'AED',
      rateInput: 4350,
      budgetType: 'expense',
    });
    expect(janSummary.items.find((i) => i.category === 'Makan & Minum')?.limit).toBe(900);
    expect(janSummary.items.find((i) => i.category === 'Makan & Minum')?.isMonthOverride).toBe(true);

    // Editor role on shared vault can manage future month budgets
    const { rerender } = render(
      <BudgetsView
        transactions={transactions}
        customCategories={customCategories}
        budgets={budgetsWithFuture}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2027-01"
        onSelectMonth={vi.fn()}
        onNavigate={vi.fn()}
        onOpenBudgetManager={onOpenBudgetManager}
        readOnly={false}
        isSharedVault={true}
        activeRole="editor"
      />
    );

    expect(
      screen.getByText(/Role Editor · Bisa ubah budget saat ini & mendatang/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Perencanaan Bulan Mendatang/i)).toBeInTheDocument();
    expect(screen.getByText(/Khusus Bulan Ini/i)).toBeInTheDocument();

    const manageBtn = screen.getByRole('button', { name: /Atur Budget/i });
    await user.click(manageBtn);
    expect(onOpenBudgetManager).toHaveBeenCalledWith('expense');

    // Viewer role is read-only
    rerender(
      <BudgetsView
        transactions={transactions}
        customCategories={customCategories}
        budgets={budgetsWithFuture}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2027-01"
        onSelectMonth={vi.fn()}
        onNavigate={vi.fn()}
        onOpenBudgetManager={onOpenBudgetManager}
        readOnly={true}
        isSharedVault={true}
        activeRole="viewer"
      />
    );
    expect(screen.getByText(/Role Viewer · Hanya Baca/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atur Budget/i })).not.toBeInTheDocument();

    // BudgetManagerModal opened for future month defaults to month override scope & saves Income/Future entries
    render(
      <BudgetManagerModal
        isOpen={true}
        onClose={vi.fn()}
        budgets={budgetsWithFuture}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        rateInput={4350}
        activeMonth="2027-01"
        readOnly={false}
        onSaveBudgets={onSaveBudgets}
      />
    );

    const transportInput = screen.getByLabelText('Batas budget Transportasi');
    await user.clear(transportInput);
    await user.type(transportInput, '650');

    // Switch to Income Budgets tab inside modal and set Gaji target
    await user.click(screen.getByRole('tab', { name: /Budget Pemasukan/i }));
    expect(screen.getByText('Atur Budget Pemasukan per Kategori')).toBeInTheDocument();
    const gajiInput = screen.getByLabelText('Target pemasukan Gaji');
    await user.clear(gajiInput);
    await user.type(gajiInput, '15000');

    await user.click(screen.getByRole('button', { name: /Simpan Budget/i }));
    expect(onSaveBudgets).toHaveBeenCalledTimes(1);
    const saved = onSaveBudgets.mock.calls[0][0] as Array<{
      category: string;
      monthlyLimit: number;
      budgetType?: string;
      targetMonth?: string;
    }>;

    const futureTransport = saved.find(
      (e) => e.category === 'Transportasi' && e.targetMonth === '2027-01' && !e.budgetType
    );
    expect(futureTransport?.monthlyLimit).toBe(650);

    const futureGaji = saved.find(
      (e) => e.category === 'Gaji' && e.targetMonth === '2027-01' && e.budgetType === 'income'
    );
    expect(futureGaji?.monthlyLimit).toBe(15000);
  });
});
