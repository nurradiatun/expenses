import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardView } from '../components/DashboardView';
import { buildAccountColorMap } from '../lib/accountColors';
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
    name: 'ADCB Savings',
    accountNumberMasked: '****1234',
    balance: 10000,
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
    name: 'Dompet Cash',
    accountNumberMasked: 'CASH',
    balance: 500,
    institution: 'Cash',
    notes: '',
  },
];

const customCategories: CustomCategory[] = [
  {
    id: 'cat-custom-1',
    ownerId: 'u1',
    name: 'Makan & Minum',
    categoryType: 'expense',
    icon: 'Coffee',
    color: '#EA580C',
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
    date: '2026-11-12',
    description: 'IKEA Abu Dhabi',
    merchant: 'IKEA',
    amount: 600,
    currency: 'AED',
    category: 'Barang Rumah Tangga',
    reference: 'REF-1',
    notes: '',
  },
  {
    id: 'tx-2',
    ownerId: 'u1',
    accountId: 'acc-cash',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'manual',
    date: '2026-11-12',
    description: 'Kopi pagi',
    merchant: 'Starbucks',
    amount: 200,
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
    txType: 'income',
    source: 'pdf',
    date: '2026-11-05',
    description: 'Monthly Payroll',
    merchant: 'Employer Co',
    amount: 5000,
    currency: 'AED',
    category: 'Gaji',
    reference: 'SAL-11',
    notes: '',
  },
];

describe('DashboardView (KPI Strip, Modern Pie Chart & Daily Calendar)', () => {
  it('renders KPI strip, Pengeluaran per Kategori breakdown, and toggles between Keluar & Masuk', async () => {
    const user = userEvent.setup();

    render(
      <DashboardView
        accounts={accounts}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onOpenNewTx={vi.fn()}
        onNavigate={vi.fn()}
        onOpenPdfImport={vi.fn()}
      />
    );

    // KPI values
    expect(screen.getByText('Total Saldo Bersih')).toBeInTheDocument();
    expect(screen.getByText(/10,500\.00/)).toBeInTheDocument();
    expect(screen.getByText('Pengeluaran per Kategori')).toBeInTheDocument();

    // Expense breakdown: Barang Rumah Tangga (600 / 800 = 75.0%), Makan & Minum (200 / 800 = 25.0%)
    expect(screen.getAllByText('Barang Rumah Tangga').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Makan & Minum').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText(/Terbesar:/i)).toBeInTheDocument();

    // Switch pie toggle to Masuk (Income)
    await user.click(screen.getByRole('button', { name: /^Masuk$/i }));
    expect(screen.getByText('Pemasukan per Kategori')).toBeInTheDocument();
    expect(screen.getAllByText('Gaji').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('displays daily transaction counts on calendar and updates day breakdown on date click', async () => {
    const user = userEvent.setup();

    render(
      <DashboardView
        accounts={accounts}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onOpenNewTx={vi.fn()}
        onNavigate={vi.fn()}
        onOpenPdfImport={vi.fn()}
      />
    );

    const calendarHeading = screen.getByText('Kalender Transaksi Harian');
    const calendarSection = calendarHeading.closest('section') as HTMLElement;
    expect(calendarSection).toBeInTheDocument();

    // Day 12 has 2x transactions; initial selectedCalDate is latest transaction date (2026-11-12)
    expect(within(calendarSection).getByText('2 transaksi')).toBeInTheDocument();
    expect(within(calendarSection).getByText('IKEA')).toBeInTheDocument();
    expect(within(calendarSection).getByText('Starbucks')).toBeInTheDocument();

    // Click day 5 (which has salary transaction)
    const day5Btn = within(calendarSection).getByRole('button', { name: /05 Nov 2026/i });
    await user.click(day5Btn);

    expect(within(calendarSection).getByText('05 Nov 2026')).toBeInTheDocument();
    expect(within(calendarSection).getByText('1 transaksi')).toBeInTheDocument();
    expect(within(calendarSection).getByText('Employer Co')).toBeInTheDocument();

    // Clicking a category row pins it in the center donut readout
    const categoryButtons = screen.getAllByRole('button', { name: /Barang Rumah Tangga/i });
    await user.click(categoryButtons[0]);
    expect(screen.getByText('75.0% · 1x')).toBeInTheDocument();
  });

  it('renders Insight Keuangan and Budget Pemasukan buttons in Ringkasan and navigates on click', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenBudgets = vi.fn();

    render(
      <DashboardView
        accounts={accounts}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onOpenNewTx={vi.fn()}
        onNavigate={onNavigate}
        onOpenBudgets={onOpenBudgets}
        onOpenPdfImport={vi.fn()}
      />
    );

    const incomeBudgetBtn = screen.getByRole('button', { name: /Budget Pemasukan/i });
    expect(incomeBudgetBtn).toBeInTheDocument();
    await user.click(incomeBudgetBtn);
    expect(onOpenBudgets).toHaveBeenCalledWith('income');

    const insightBtn = screen.getByRole('button', { name: /Insight Keuangan/i });
    expect(insightBtn).toBeInTheDocument();
    await user.click(insightBtn);
    expect(onNavigate).toHaveBeenCalledWith('insights');
  });

  it('assigns distinct colors per account in calendar legend, day cells, and transaction badges', async () => {
    const user = userEvent.setup();

    const colorMap = buildAccountColorMap(accounts, transactions);
    const adcbTheme = colorMap.get('acc-adcb')!.theme;
    const cashTheme = colorMap.get('acc-cash')!.theme;
    expect(adcbTheme.accentHex).not.toBe(cashTheme.accentHex);
    expect(adcbTheme.textClass).not.toBe(cashTheme.textClass);

    render(
      <DashboardView
        accounts={accounts}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency="AED"
        aedToIdrRate={4350}
        selectedMonth="2026-11"
        onSelectMonth={vi.fn()}
        onOpenNewTx={vi.fn()}
        onNavigate={vi.fn()}
        onOpenPdfImport={vi.fn()}
      />
    );

    const calendarHeading = screen.getByText('Kalender Transaksi Harian');
    const calendarSection = calendarHeading.closest('section') as HTMLElement;

    // Account legend buttons & selected day transaction badges both render account names
    const adcbFilterBtn = within(calendarSection).getByRole('button', { name: /ADCB Savings/i });
    const cashFilterBtn = within(calendarSection).getByRole('button', { name: /Dompet Cash/i });
    expect(adcbFilterBtn).toBeInTheDocument();
    expect(cashFilterBtn).toBeInTheDocument();

    // Day 12 cell shows both ADCB (-600) and Cash (-200) amounts with their distinct account colors
    const day12Btn = within(calendarSection).getByRole('button', { name: /12 Nov 2026/i });
    const adcbDayAmt = within(day12Btn).getByText('-600');
    const cashDayAmt = within(day12Btn).getByText('-200');
    expect(adcbDayAmt.className).toContain(adcbTheme.textClass);
    expect(cashDayAmt.className).toContain(cashTheme.textClass);

    // Clicking ADCB Savings filters the calendar to only ADCB transactions
    await user.click(adcbFilterBtn);
    expect(within(calendarSection).getByText('1 transaksi')).toBeInTheDocument();
    expect(within(calendarSection).getByText('IKEA')).toBeInTheDocument();
    expect(within(calendarSection).queryByText('Starbucks')).not.toBeInTheDocument();

    // Clicking Semua restores both accounts
    await user.click(within(calendarSection).getByRole('button', { name: /^Semua$/i }));
    expect(within(calendarSection).getByText('2 transaksi')).toBeInTheDocument();
    expect(within(calendarSection).getByText('Starbucks')).toBeInTheDocument();
  });
});
