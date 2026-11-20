import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../lib/i18n';
import { ExportVaultView } from '../components/ExportVaultView';
import { CategoryManagerModal } from '../components/CustomCategoryManager';
import { AdcbAccountsView } from '../components/AdcbAccountsView';
import { exportReportToPdf } from '../lib/exporters';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type ExchangeRatesInfo,
  type FinancialAccount,
  type FinancialTransaction,
  type UserProfile,
} from '../types';

const autoTableMock = vi.fn();
const saveMock = vi.fn();

vi.mock('jspdf', () => ({
  default: class MockJsPDF {
    lastAutoTable = { finalY: 90 };
    setFont = vi.fn();
    setFontSize = vi.fn();
    setTextColor = vi.fn();
    setDrawColor = vi.fn();
    text = vi.fn();
    line = vi.fn();
    save = saveMock;
  },
}));

vi.mock('jspdf-autotable', () => ({
  default: (...args: unknown[]) => autoTableMock(...args),
}));

const sampleAccounts: FinancialAccount[] = [
  {
    id: 'acc-1',
    ownerId: 'u1',
    provider: 'ADCB',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'Kartu Harian Keluarga',
    accountNumberMasked: '****9988',
    balance: 12500,
    institution: 'ADCB Bank PJSC',
    notes: '',
  },
  {
    id: 'acc-2',
    ownerId: 'u1',
    provider: 'MANUAL',
    currency: 'IDR',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'Dompet Tunai Rumah',
    accountNumberMasked: 'CASH',
    balance: 2500000,
    institution: 'Tunai',
    notes: '',
  },
];

const sampleTransactions: FinancialTransaction[] = [
  {
    id: 'tx-1',
    ownerId: 'u1',
    accountId: 'acc-1',
    monthKey: '2026-11',
    txType: 'expense',
    source: 'manual',
    date: '2026-11-12',
    description: 'Belanja mingguan',
    merchant: 'Carrefour',
    amount: 320,
    currency: 'AED',
    category: 'Belanja',
    reference: '',
    notes: '',
  },
  {
    id: 'tx-2',
    ownerId: 'u1',
    accountId: 'acc-2',
    monthKey: '2026-11',
    txType: 'income',
    source: 'manual',
    date: '2026-11-14',
    description: 'Bonus proyek',
    merchant: 'Klien',
    amount: 1500000,
    currency: 'IDR',
    category: 'Gaji',
    reference: '',
    notes: '',
  },
];

const sampleProfile: UserProfile = {
  uid: 'u1',
  email: 'user@example.com',
  displayName: 'Radiatun',
  preferredCurrency: 'AED',
  aedToIdrRate: 4350,
};

const sampleRates: ExchangeRatesInfo = {
  ratesToIdr: { AED: 4350, IDR: 1, USD: 15975, SGD: 11885, EUR: 17330 },
  source: 'live',
  updatedAtIso: '2026-11-15T10:00:00.000Z',
  isLive: true,
};

describe('PDF Export, ExportVaultView, CategoryManagerModal & AdcbAccountsView Redesign', () => {
  beforeEach(() => {
    autoTableMock.mockClear();
    saveMock.mockClear();
    localStorage.clear();
  });

  it('exportReportToPdf uses funding source name (acc.name) in the Sumber Dana column', () => {
    exportReportToPdf({
      transactions: sampleTransactions,
      accounts: sampleAccounts,
      monthFilter: '2026-11',
      displayCurrency: 'AED',
      aedToIdrRate: 4350,
      userName: 'Radiatun',
      fileName: 'laporan-nov-2026.pdf',
      lang: 'id',
    });

    expect(saveMock).toHaveBeenCalledWith('laporan-nov-2026.pdf');
    // The 3rd autoTable call is the ledger table
    const ledgerCall = autoTableMock.mock.calls[2][1] as {
      head: string[][];
      body: string[][];
    };
    expect(ledgerCall.head[0]).toEqual([
      'Tanggal',
      'Sumber Dana',
      'Merchant / Keterangan',
      'Kategori',
      'Nominal',
    ]);
    expect(ledgerCall.body[0][1]).toBe('Kartu Harian Keluarga');
    expect(ledgerCall.body[1][1]).toBe('Dompet Tunai Rumah');
  });

  it('ExportVaultView omits removed descriptions, renders sharing hero, and toggles ID/EN language', async () => {
    const user = userEvent.setup();

    render(
      <LanguageProvider>
        <ExportVaultView
          profile={sampleProfile}
          exchangeRates={sampleRates}
          accounts={sampleAccounts}
          transactions={sampleTransactions}
          ownedSharesCount={1}
          onSavePreferences={vi.fn().mockResolvedValue(undefined)}
          onRotatePassphrase={vi.fn().mockResolvedValue(undefined)}
          onDeleteAllData={vi.fn().mockResolvedValue({
            transactions: 0,
            syncLogs: 0,
            accounts: 0,
            categories: 0,
          })}
          onLockVault={vi.fn()}
          onOpenSharingModal={vi.fn()}
        />
      </LanguageProvider>
    );

    // Deleted strings must not exist
    expect(
      screen.queryByText(/Dokumen dibuat langsung di browser setelah data didekripsi secara lokal/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Mengikuti kurs terupdate secara otomatis, tidak perlu diubah manual/i)
    ).not.toBeInTheDocument();

    // Redesigned Sharing hero & action button
    expect(screen.getByText('Berbagi Data Keluarga & Multi-Akun')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kelola Berbagi Brankas/i })).toBeInTheDocument();
    expect(screen.getByText('1 Akun Terhubung')).toBeInTheDocument();

    // Switch language to English via Language selector
    const langSelect = screen.getByLabelText('Pilih bahasa aplikasi');
    await user.selectOptions(langSelect, 'en');

    expect(screen.getByText('Family Sharing & Multi-Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Vault Sharing/i })).toBeInTheDocument();
  });

  it('CategoryManagerModal displays Setting Kategori title without the removed subtitle', () => {
    render(
      <LanguageProvider>
        <CategoryManagerModal
          isOpen
          onClose={vi.fn()}
          customCategories={[]}
          transactions={sampleTransactions}
          expenseCategoryNames={[...EXPENSE_CATEGORIES]}
          incomeCategoryNames={[...INCOME_CATEGORIES]}
          onCreateCategory={vi.fn().mockResolvedValue('Baru')}
          onUpdateCategory={vi.fn().mockResolvedValue(0)}
          onDeleteCategory={vi.fn().mockResolvedValue(0)}
          onUpdateBuiltInCategory={vi.fn().mockResolvedValue(0)}
          onDeleteBuiltInCategory={vi.fn().mockResolvedValue(0)}
        />
      </LanguageProvider>
    );

    expect(screen.getByText('Setting Kategori')).toBeInTheDocument();
    expect(screen.queryByText(/Kelola Kategori, Ikon & Warna/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Pisahkan, tambah, ubah nama, pilih ikon dan warna kategori pengeluaran maupun pemasukan secara terenkripsi/i)
    ).not.toBeInTheDocument();
  });

  it('AdcbAccountsView Tambah Sumber Dana modal renders Live Card Preview and updates dynamically', async () => {
    const user = userEvent.setup();

    render(
      <LanguageProvider>
        <AdcbAccountsView
          accounts={sampleAccounts}
          transactions={sampleTransactions}
          onUpdateAccount={vi.fn().mockResolvedValue(0)}
          onCreateManualAccount={vi.fn().mockResolvedValue(undefined)}
          onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
        />
      </LanguageProvider>
    );

    await user.click(screen.getByRole('button', { name: /Tambah Sumber Dana/i }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText(/LIVE CARD PREVIEW/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Hubungkan rekening bank, kartu, atau dompet tunai baru/i)
    ).toBeInTheDocument();

    const nameInput = within(dialog).getByPlaceholderText(/Contoh: ADCB TouchPoints/i);
    await user.type(nameInput, 'Dompet Travel');
    expect(within(dialog).getByText('Dompet Travel')).toBeInTheDocument();

    // Switch provider to Cash
    await user.click(within(dialog).getByRole('button', { name: /Dompet Tunai/i }));
    expect(within(dialog).getByText('Referensi Tunai')).toBeInTheDocument();
    expect(within(dialog).getAllByText('CASH').length).toBeGreaterThanOrEqual(2);
  });
});
