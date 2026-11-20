import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsView } from '../components/TransactionsView';
import type { FinancialAccount, FinancialTransaction, SyncLogEntry } from '../types';

const accounts: FinancialAccount[] = [
  {
    id: 'acc-1',
    ownerId: 'u1',
    provider: 'ADCB',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'ADCB Utama',
    accountNumberMasked: '****4321',
    balance: 5000,
    institution: 'ADCB',
    notes: '',
  },
];

function makeTransactions(count: number): FinancialTransaction[] {
  return Array.from({ length: count }, (_, idx) => {
    const day = String(25 - (idx % 20)).padStart(2, '0');
    const isSpouse = idx % 2 === 1;
    return {
      id: `tx-${idx + 1}`,
      ownerId: 'u1',
      accountId: 'acc-1',
      monthKey: '2026-11',
      txType: idx === 0 ? 'income' : 'expense',
      source: 'manual',
      date: `2026-11-${day}`,
      description: `Keterangan ${idx + 1}`,
      merchant: idx === 0 ? 'Payroll Khusus' : `Merchant ${idx + 1}`,
      amount: 100 + idx,
      currency: 'AED',
      category: idx === 0 ? 'Gaji' : 'Makan & Minum',
      reference: `REF-${idx + 1}`,
      notes: '',
      createdByUid: isSpouse ? 'u2' : 'u1',
      createdByName: isSpouse ? 'Siti Pasangan' : 'Radiatun',
      createdByEmail: isSpouse ? 'siti@example.com' : 'radiatun@example.com',
      createdAtIso: '2026-11-20T08:00:00.000Z',
      ...(idx === 0
        ? {
            updatedByUid: 'u2',
            updatedByName: 'Siti Pasangan',
            updatedByEmail: 'siti@example.com',
            updatedAtIso: '2026-11-21T09:30:00.000Z',
          }
        : {}),
    };
  });
}

const sampleSyncLogs: SyncLogEntry[] = [
  {
    id: 'log-1',
    ownerId: 'u1',
    accountId: 'acc-1',
    syncType: 'pdf_import',
    status: 'success',
    recordsCount: 12,
    summary: 'Impor mutasi ADCB Nov 2026',
    createdAtIso: '2026-11-20T09:00:00.000Z',
  },
];

describe('TransactionsView (Sumber Dana, Detail History, Import Logs, Pagination & Bulk Delete)', () => {
  it('renders Sumber Dana column (without Dicatat Oleh column in table), Riwayat Impor Mutasi below list, and recorder history inside Detail Modal', async () => {
    const user = userEvent.setup();
    const txs = makeTransactions(25);

    render(
      <TransactionsView
        accounts={accounts}
        transactions={txs}
        syncLogs={sampleSyncLogs}
        displayCurrency="AED"
        aedToIdrRate={4350}
        userName="Radiatun"
        onOpenNewTx={vi.fn()}
        onEditTx={vi.fn()}
        onDeleteTx={vi.fn()}
        onBulkDeleteTx={vi.fn().mockResolvedValue(1)}
        onOpenImportModal={vi.fn()}
      />
    );

    // Table headers MUST include Sumber Dana column, and MUST NOT show Dicatat Oleh column in main table
    expect(screen.getByRole('columnheader', { name: /Sumber Dana/i })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Dicatat Oleh/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('ADCB Utama').length).toBeGreaterThan(0);

    // Riwayat Impor Mutasi is rendered below the transaction table without removed subtitle
    expect(screen.getByText('Riwayat Impor Mutasi')).toBeInTheDocument();
    expect(
      screen.queryByText(/Catatan aktivitas impor dokumen mutasi terenkripsi/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText('Impor mutasi ADCB Nov 2026')).toBeInTheDocument();
    expect(screen.getByText('+12 entri')).toBeInTheDocument();

    expect(screen.getByText(/Menampilkan 1–20 dari 25 transaksi \(20 per halaman\)/i)).toBeInTheDocument();

    // Navigate to page 2
    await user.click(screen.getByRole('button', { name: /Halaman berikutnya/i }));
    expect(screen.getByText(/Menampilkan 21–25 dari 25 transaksi \(20 per halaman\)/i)).toBeInTheDocument();

    // Go back to page 1 and open Detail Modal for Payroll Khusus
    await user.click(screen.getByRole('button', { name: /Halaman sebelumnya/i }));
    await user.click(screen.getByText('Payroll Khusus'));

    expect(screen.getByText('Detail Transaksi')).toBeInTheDocument();
    expect(screen.getByText(/ADCB Utama \(ADCB · AED\)/i)).toBeInTheDocument();
    expect(screen.getByText('Dicatat Oleh')).toBeInTheDocument();
    expect(screen.getByText('Radiatun')).toBeInTheDocument();
    expect(screen.getByText('radiatun@example.com')).toBeInTheDocument();
    expect(screen.getByText('Diperbarui Oleh')).toBeInTheDocument();
    expect(screen.getByText('siti@example.com')).toBeInTheDocument();
  });

  it('supports Sumber Dana column filter, quick search, bulk edit category, and bulk delete confirmation', async () => {
    const user = userEvent.setup();
    const txs = makeTransactions(5);
    const onBulkDeleteTx = vi.fn().mockResolvedValue(1);
    const onBulkUpdateCategory = vi.fn().mockResolvedValue(1);

    render(
      <TransactionsView
        accounts={[
          ...accounts,
          {
            id: 'acc-2',
            ownerId: 'u1',
            provider: 'MANUAL',
            currency: 'IDR',
            autoSyncDaily: false,
            syncHour: 6,
            lastSyncedAtIso: '',
            name: 'Dompet Cash',
            accountNumberMasked: 'CASH',
            balance: 1000000,
            institution: 'Tunai',
            notes: '',
          },
        ]}
        transactions={txs}
        displayCurrency="AED"
        aedToIdrRate={4350}
        userName="Radiatun"
        onOpenNewTx={vi.fn()}
        onEditTx={vi.fn()}
        onDeleteTx={vi.fn()}
        onBulkDeleteTx={onBulkDeleteTx}
        onBulkUpdateCategory={onBulkUpdateCategory}
        onOpenImportModal={vi.fn()}
        onCreateCategory={vi.fn().mockResolvedValue('Baru')}
        onUpdateCategory={vi.fn().mockResolvedValue(0)}
        onDeleteCategory={vi.fn().mockResolvedValue(0)}
        onUpdateBuiltInCategory={vi.fn().mockResolvedValue(0)}
        onDeleteBuiltInCategory={vi.fn().mockResolvedValue(0)}
      />
    );

    // Setting Kategori button is present
    expect(screen.getByRole('button', { name: /Setting Kategori/i })).toBeInTheDocument();

    // Filter by Sumber Dana ("Dompet Cash" has 0 entries)
    await user.click(screen.getByRole('button', { name: 'Filter kolom sumber dana' }));
    await user.click(screen.getByRole('button', { name: 'Dompet Cash' }));
    expect(screen.getByText('Tidak ada transaksi yang cocok')).toBeInTheDocument();

    // Reset all filters
    await user.click(screen.getAllByRole('button', { name: /Reset Filter/i })[0]);
    expect(screen.getByText('5 entri')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Cari merchant, keterangan/i);
    await user.type(searchInput, 'Payroll Khusus');
    expect(screen.getByText('1 entri dari 5')).toBeInTheDocument();

    // Clear search and select first checkbox
    await user.clear(searchInput);
    const rowCheckbox = screen.getByRole('checkbox', { name: /Pilih transaksi Payroll Khusus/i });
    await user.click(rowCheckbox);

    // Bulk edit category
    const bulkSelect = screen.getByLabelText(/Pilih kategori massal/i);
    await user.selectOptions(bulkSelect, 'Transportasi');
    await user.click(screen.getByRole('button', { name: /Ubah Kategori/i }));
    expect(onBulkUpdateCategory).toHaveBeenCalledWith(['tx-1'], 'Transportasi');

    // Re-select and test bulk delete
    await user.click(screen.getByRole('checkbox', { name: /Pilih transaksi Payroll Khusus/i }));
    await user.click(screen.getByRole('button', { name: /Hapus Terpilih \(1\)/i }));
    await user.click(screen.getByRole('button', { name: /Ya, Hapus \(1\)/i }));

    expect(onBulkDeleteTx).toHaveBeenCalledWith(['tx-1']);
  });

  it('places newly added same-date manual transactions at the top of page 1 and jumps back to page 1 when manualCreatedTick increments', async () => {
    const user = userEvent.setup();
    const olderSameDateTxs: FinancialTransaction[] = Array.from({ length: 22 }, (_, idx) => ({
      id: `tx-same-${idx + 1}`,
      ownerId: 'u1',
      accountId: 'acc-1',
      monthKey: '2026-11',
      txType: 'expense',
      source: 'manual',
      date: '2026-11-25',
      description: `Transaksi Lama ${idx + 1}`,
      merchant: `Merchant Lama ${idx + 1}`,
      amount: 50 + idx,
      currency: 'AED',
      category: 'Makan & Minum',
      reference: '',
      notes: '',
      createdAtIso: `2026-11-25T08:${String(idx).padStart(2, '0')}:00.000Z`,
    }));

    const { rerender } = render(
      <TransactionsView
        accounts={accounts}
        transactions={olderSameDateTxs}
        displayCurrency="AED"
        aedToIdrRate={4350}
        userName="Radiatun"
        onOpenNewTx={vi.fn()}
        onEditTx={vi.fn()}
        onDeleteTx={vi.fn()}
        onBulkDeleteTx={vi.fn().mockResolvedValue(0)}
        onOpenImportModal={vi.fn()}
        manualCreatedTick={0}
      />
    );

    // Move to page 2
    await user.click(screen.getByRole('button', { name: /Halaman berikutnya/i }));
    expect(screen.getByText(/Menampilkan 21–22 dari 22 transaksi/i)).toBeInTheDocument();

    // Simulate adding a new manual transaction for the same date (2026-11-25) with a newer createdAtIso
    const newestManualTx: FinancialTransaction = {
      id: 'tx-aaa-new',
      ownerId: 'u1',
      accountId: 'acc-1',
      monthKey: '2026-11',
      txType: 'expense',
      source: 'manual',
      date: '2026-11-25',
      description: 'Kopi Pagi Baru',
      merchant: 'Kopi Baru Banget',
      amount: 25,
      currency: 'AED',
      category: 'Makan & Minum',
      reference: '',
      notes: '',
      createdAtIso: '2026-11-25T15:30:00.000Z',
    };

    rerender(
      <TransactionsView
        accounts={accounts}
        transactions={[...olderSameDateTxs, newestManualTx]}
        displayCurrency="AED"
        aedToIdrRate={4350}
        userName="Radiatun"
        onOpenNewTx={vi.fn()}
        onEditTx={vi.fn()}
        onDeleteTx={vi.fn()}
        onBulkDeleteTx={vi.fn().mockResolvedValue(0)}
        onOpenImportModal={vi.fn()}
        manualCreatedTick={1}
      />
    );

    // Should immediately reset to page 1 and display the newly added transaction on page 1
    expect(screen.getByText(/Menampilkan 1–20 dari 23 transaksi/i)).toBeInTheDocument();
    expect(screen.getByText('Kopi Baru Banget')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // Row 0 is header, Row 1 is first data row
    expect(rows[1]).toHaveTextContent('Kopi Baru Banget');
  });
});

