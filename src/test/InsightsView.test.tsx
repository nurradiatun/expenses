import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InsightsView } from '../components/InsightsView';
import { computeFinancialInsights } from '../lib/financialInsights';
import type { CustomCategory, FinancialAccount, FinancialTransaction } from '../types';

const accounts: FinancialAccount[] = [
  {
    id: 'acc-adcb',
    ownerId: 'u1',
    provider: 'ADCB',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'ADCB TouchPoints',
    accountNumberMasked: '****1234',
    balance: 15000,
    institution: 'ADCB',
    notes: '',
  },
  {
    id: 'acc-cash',
    ownerId: 'u1',
    provider: 'MANUAL',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'Dompet Tunai',
    accountNumberMasked: 'CASH',
    balance: 400,
    institution: 'Cash',
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
];

const sampleTransactions: FinancialTransaction[] = [
  // Current month: 2026-11
  {
    id: 'tx-nov-sal',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-11',
    txType: 'income',
    source: 'pdf',
    date: '2026-11-01',
    description: 'Salary Nov',
    merchant: 'Employer Co',
    amount: 10000,
    currency: 'AED',
    category: 'Gaji',
    reference: 'SAL-11',
    notes: '',
  },
  {
    id: 'tx-nov-ikea',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'pdf',
    date: '2026-11-07', // Saturday
    description: 'IKEA Abu Dhabi',
    merchant: 'IKEA',
    amount: 1800,
    currency: 'AED',
    category: 'Barang Rumah Tangga',
    reference: 'IK-1',
    notes: '',
  },
  {
    id: 'tx-nov-sbx',
    ownerId: 'u1',
    accountId: 'acc-cash',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'manual',
    date: '2026-11-10', // Tuesday
    description: 'Starbucks Coffee',
    merchant: 'Starbucks',
    amount: 200,
    currency: 'AED',
    category: 'Makan & Minum',
    reference: '',
    notes: '',
  },
  // Previous month: 2026-10
  {
    id: 'tx-oct-ikea',
    ownerId: 'u1',
    accountId: 'acc-adcb',
    monthKey: '2026-10',
    txType: 'expense',
    source: 'pdf',
    date: '2026-10-14',
    description: 'IKEA Small Purchase',
    merchant: 'IKEA',
    amount: 900,
    currency: 'AED',
    category: 'Barang Rumah Tangga',
    reference: 'IK-0',
    notes: '',
  },
  {
    id: 'tx-oct-sbx',
    ownerId: 'u1',
    accountId: 'acc-cash',
    monthKey: '2026-10',
    txType: 'expense',
    source: 'manual',
    date: '2026-10-20',
    description: 'Starbucks October',
    merchant: 'Starbucks',
    amount: 100,
    currency: 'AED',
    category: 'Makan & Minum',
    reference: '',
    notes: '',
  },
];

describe('financialInsights & InsightsView', () => {
  it('computes savings rate, MoM expense jump, recurring merchants, and ADCB vs Cash split', () => {
    const report = computeFinancialInsights({
      transactions: sampleTransactions,
      accounts,
      customCategories,
      displayCurrency: 'AED',
      rateInput: 4350,
      selectedMonth: '2026-11',
      scope: 'month',
    });

    expect(report.totalIncome).toBe(10000);
    expect(report.totalExpense).toBe(2000);
    expect(report.netCashFlow).toBe(8000);
    expect(report.savingsRatePct).toBeCloseTo(80, 1);

    // Previous month expense was 900 + 100 = 1000 -> +100.0% jump
    expect(report.previousExpense).toBe(1000);
    expect(report.expenseDeltaPct).toBeCloseTo(100, 1);

    // Largest expense
    expect(report.largestExpenseTx?.merchant).toBe('IKEA');
    expect(report.largestExpenseTx?.convertedAmount).toBe(1800);

    // Recurring merchants across Oct & Nov
    const recurringNames = report.recurringCandidates.map((r) => r.merchantName);
    expect(recurringNames).toContain('IKEA');
    expect(recurringNames).toContain('Starbucks');

    // Funding source split (ADCB 1800 vs Cash 200)
    expect(report.fundingSourceSplits[0].providerLabel).toBe('ADCB');
    expect(report.fundingSourceSplits[0].expenseTotal).toBe(1800);
    expect(report.fundingSourceSplits[1].providerLabel).toBe('Cash');
    expect(report.fundingSourceSplits[1].expenseTotal).toBe(200);

    // Notices generated
    expect(report.notices.some((n) => n.id === 'cashflow-surplus')).toBe(true);
    expect(report.notices.some((n) => n.id === 'mom-spike')).toBe(true);
  });

  it('renders empty state CTAs and back-to-dashboard button when no transactions exist', async () => {
    const user = userEvent.setup();
    const onOpenNewTx = vi.fn();
    const onOpenPdfImport = vi.fn();
    const onNavigate = vi.fn();

    render(
      <InsightsView
        accounts={accounts}
        transactions={[]}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onNavigate={onNavigate}
        onOpenNewTx={onOpenNewTx}
        onOpenPdfImport={onOpenPdfImport}
      />
    );

    expect(screen.getByText('Belum ada data untuk dianalisis')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Kembali ke Ringkasan/i }));
    expect(onNavigate).toHaveBeenCalledWith('dashboard');

    await user.click(screen.getByRole('button', { name: /Catat Transaksi Pertama/i }));
    expect(onOpenNewTx).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Import File Mutasi/i }));
    expect(onOpenPdfImport).toHaveBeenCalledTimes(1);
  });

  it('renders populated insights, interactive notice filters, detail tabs, and MoM category table', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <InsightsView
        accounts={accounts}
        transactions={sampleTransactions}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onNavigate={onNavigate}
        onOpenNewTx={vi.fn()}
        onOpenPdfImport={vi.fn()}
      />
    );

    expect(screen.getByText('Insight Keuangan')).toBeInTheDocument();
    expect(screen.getByText('Rasio Tabungan')).toBeInTheDocument();
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('Sorotan & Temuan Otomatis')).toBeInTheDocument();
    expect(screen.getByText('Pola Pengeluaran per Hari')).toBeInTheDocument();
    expect(screen.getByText('Perbandingan Pengeluaran per Kategori')).toBeInTheDocument();

    // Filter notices by Perhatian (warnings)
    await user.click(screen.getByRole('button', { name: /Perhatian \(/i }));
    expect(screen.getByText(/Pengeluaran naik \+100\.0%/i)).toBeInTheDocument();

    // Switch detail tabs: Berulang & Sumber Dana
    await user.click(screen.getByRole('button', { name: /Berulang \(/i }));
    expect(screen.getAllByText(/2 bulan · 2x transaksi/i).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: /Sumber Dana/i }));
    expect(screen.getByText('ADCB TouchPoints')).toBeInTheDocument();
    expect(screen.getByText('Dompet Tunai')).toBeInTheDocument();

    // Navigate back to Ringkasan and to Buku Kas
    await user.click(screen.getByRole('button', { name: /Kembali ke Ringkasan/i }));
    expect(onNavigate).toHaveBeenCalledWith('dashboard');

    await user.click(screen.getByRole('button', { name: /Buka Buku Kas/i }));
    expect(onNavigate).toHaveBeenCalledWith('transactions');
  });
});
