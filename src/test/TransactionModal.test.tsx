import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TransactionModal } from '../components/TransactionModal';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type FinancialAccount,
} from '../types';

const accounts: FinancialAccount[] = [
  {
    id: 'acc-cash',
    ownerId: 'u1',
    provider: 'MANUAL',
    currency: 'IDR',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'Dompet Tunai',
    accountNumberMasked: 'CASH',
    balance: 1000000,
    institution: 'Cash',
    notes: '',
  },
];

describe('TransactionModal (Separated Categories, Inference & Inline Create)', () => {
  it('switches category options between Pengeluaran and Pemasukan and infers IKEA as Barang Rumah Tangga', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <TransactionModal
        isOpen
        accounts={accounts}
        expenseCategories={[...EXPENSE_CATEGORIES]}
        incomeCategories={[...INCOME_CATEGORIES]}
        editingTx={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    // Expense options present, Gaji absent
    expect(screen.getByRole('option', { name: 'Barang Rumah Tangga' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Gaji' })).not.toBeInTheDocument();

    // Typing IKEA auto-infers Barang Rumah Tangga
    const merchantInput = screen.getByPlaceholderText(/Contoh: IKEA/i);
    await user.type(merchantInput, 'IKEA Alam Sutera');

    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '350000');

    await user.click(screen.getByRole('button', { name: /Simpan Transaksi/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-cash',
        txType: 'expense',
        amount: 350000,
        merchant: 'IKEA Alam Sutera',
        category: 'Barang Rumah Tangga',
      })
    );
  });

  it('allows creating a new category inline with chosen icon and color and switching to Pemasukan', async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn().mockResolvedValue('Bonus Tahunan');

    render(
      <TransactionModal
        isOpen
        accounts={accounts}
        expenseCategories={[...EXPENSE_CATEGORIES]}
        incomeCategories={[...INCOME_CATEGORIES]}
        editingTx={null}
        onCreateCategory={onCreateCategory}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await user.click(screen.getByRole('button', { name: /^Pemasukan$/i }));
    expect(screen.getByRole('option', { name: 'Gaji' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Barang Rumah Tangga' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Kategori Baru/i }));
    await user.click(screen.getByRole('button', { name: /Pilih ikon dan warna kategori baru/i }));
    await user.click(screen.getByRole('button', { name: /Pilih warna Emerald/i }));
    await user.click(screen.getByRole('button', { name: /Pilih ikon Bonus & Hadiah/i }));

    await user.type(screen.getByPlaceholderText(/Kategori pemasukan baru/i), 'Bonus Tahunan');
    await user.click(screen.getByRole('button', { name: /^Simpan$/i }));

    expect(onCreateCategory).toHaveBeenCalledWith('Bonus Tahunan', 'income', {
      icon: 'Gift',
      color: '#059669',
    });
  });
});
