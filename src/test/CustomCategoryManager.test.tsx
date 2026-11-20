import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CustomCategoryManager } from '../components/CustomCategoryManager';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type CustomCategory,
  type FinancialTransaction,
} from '../types';

const sampleCustomCategories: CustomCategory[] = [
  {
    id: 'cat-1',
    ownerId: 'u1',
    name: 'Hobi Fotografi',
    categoryType: 'expense',
    icon: 'Gamepad2',
    color: '#7C3AED',
  },
  {
    id: 'cat-2',
    ownerId: 'u1',
    name: 'Dividen',
    categoryType: 'income',
    icon: 'TrendingUp',
    color: '#059669',
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
    date: '2026-11-10',
    description: 'Lensa kamera',
    merchant: 'Toko Kamera',
    amount: 500,
    currency: 'AED',
    category: 'Hobi Fotografi',
    reference: '',
    notes: '',
  },
];

describe('CustomCategoryManager UI & Flows', () => {
  it('separates expense and income category tabs and creates a category with chosen icon and color', async () => {
    const user = userEvent.setup();
    const onCreateCategory = vi.fn().mockResolvedValue('Pendidikan Anak');

    render(
      <CustomCategoryManager
        customCategories={sampleCustomCategories}
        transactions={sampleTransactions}
        expenseCategoryNames={[...EXPENSE_CATEGORIES, 'Hobi Fotografi']}
        incomeCategoryNames={[...INCOME_CATEGORIES, 'Dividen']}
        onCreateCategory={onCreateCategory}
        onUpdateCategory={vi.fn().mockResolvedValue(0)}
        onDeleteCategory={vi.fn().mockResolvedValue(0)}
        onUpdateBuiltInCategory={vi.fn().mockResolvedValue(0)}
        onDeleteBuiltInCategory={vi.fn().mockResolvedValue(0)}
      />
    );

    // Expense tab is active initially
    expect(screen.getByText('Hobi Fotografi')).toBeInTheDocument();
    expect(screen.queryByText('Dividen')).not.toBeInTheDocument();

    // Open visual picker & choose color + icon
    await user.click(screen.getByRole('button', { name: /Pilih ikon dan warna kategori baru/i }));
    await user.click(screen.getByRole('button', { name: /Pilih warna Indigo/i }));
    await user.click(screen.getByRole('button', { name: /Pilih ikon Pendidikan/i }));

    const input = screen.getByPlaceholderText(/Tambah kategori pengeluaran/i);
    await user.type(input, 'Pendidikan Anak');
    await user.click(screen.getByRole('button', { name: /Tambah \(Pengeluaran\)/i }));

    expect(onCreateCategory).toHaveBeenCalledWith('Pendidikan Anak', 'expense', {
      icon: 'GraduationCap',
      color: '#4F46E5',
    });

    // Switch to Income tab
    await user.click(screen.getByRole('button', { name: /Kategori Pemasukan/i }));
    expect(screen.getByText('Dividen')).toBeInTheDocument();
    expect(screen.queryByText('Hobi Fotografi')).not.toBeInTheDocument();
  });

  it('allows updating icon and color on an existing category without renaming it', async () => {
    const user = userEvent.setup();
    const onUpdateCategory = vi.fn().mockResolvedValue(0);

    render(
      <CustomCategoryManager
        customCategories={sampleCustomCategories}
        transactions={sampleTransactions}
        expenseCategoryNames={[...EXPENSE_CATEGORIES, 'Hobi Fotografi']}
        incomeCategoryNames={[...INCOME_CATEGORIES, 'Dividen']}
        onCreateCategory={vi.fn().mockResolvedValue('')}
        onUpdateCategory={onUpdateCategory}
        onDeleteCategory={vi.fn().mockResolvedValue(0)}
        onUpdateBuiltInCategory={vi.fn().mockResolvedValue(0)}
        onDeleteBuiltInCategory={vi.fn().mockResolvedValue(0)}
      />
    );

    await user.click(screen.getByRole('button', { name: /Edit kategori Hobi Fotografi/i }));
    await user.click(screen.getByRole('button', { name: /Pilih warna Amber/i }));
    await user.click(screen.getByRole('button', { name: /Pilih ikon Belanja/i }));
    await user.click(screen.getByRole('button', { name: /^Simpan$/i }));

    expect(onUpdateCategory).toHaveBeenCalledWith(sampleCustomCategories[0], 'Hobi Fotografi', {
      icon: 'ShoppingBag',
      color: '#D97706',
    });
  });

  it('confirms deletion and passes selected fallback category', async () => {
    const user = userEvent.setup();
    const onDeleteCategory = vi.fn().mockResolvedValue(1);

    render(
      <CustomCategoryManager
        customCategories={sampleCustomCategories}
        transactions={sampleTransactions}
        expenseCategoryNames={[...EXPENSE_CATEGORIES, 'Hobi Fotografi']}
        incomeCategoryNames={[...INCOME_CATEGORIES, 'Dividen']}
        onCreateCategory={vi.fn().mockResolvedValue('')}
        onUpdateCategory={vi.fn().mockResolvedValue(0)}
        onDeleteCategory={onDeleteCategory}
        onUpdateBuiltInCategory={vi.fn().mockResolvedValue(0)}
        onDeleteBuiltInCategory={vi.fn().mockResolvedValue(0)}
      />
    );

    await user.click(screen.getByRole('button', { name: /Hapus kategori Hobi Fotografi/i }));
    expect(screen.getByText(/dipakai oleh 1 transaksi/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ya, Hapus/i }));
    expect(onDeleteCategory).toHaveBeenCalledWith(sampleCustomCategories[0], 'Lainnya');
  });
});
