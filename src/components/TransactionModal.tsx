import React, { useEffect, useMemo, useState } from 'react';
import { Palette, Plus, X } from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  formatAccountProviderLabel,
  INCOME_CATEGORIES,
  inferCategoryFromMerchant,
  isHouseholdGoodsMerchant,
  resolveBuiltInCategoryName,
  type CustomCategory,
  type FinancialAccount,
  type FinancialTransaction,
  type TransactionType,
} from '../types';
import {
  CategoryBadgeIcon,
  type CategoryAppearance,
} from '../lib/categoryVisuals';
import { CategoryVisualPicker } from './CustomCategoryManager';

interface TransactionModalProps {
  isOpen: boolean;
  accounts: FinancialAccount[];
  expenseCategories?: string[];
  incomeCategories?: string[];
  categories?: string[];
  customCategories?: CustomCategory[];
  editingTx: FinancialTransaction | null;
  onCreateCategory?: (
    name: string,
    categoryType: TransactionType,
    appearance?: CategoryAppearance
  ) => Promise<string>;
  onClose: () => void;
  onSubmit: (data: {
    txId?: string;
    accountId: string;
    date: string;
    txType: TransactionType;
    amount: number;
    merchant: string;
    description: string;
    category: string;
    reference: string;
    notes: string;
  }) => Promise<void>;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  accounts,
  expenseCategories,
  incomeCategories,
  categories,
  customCategories = [],
  editingTx,
  onCreateCategory,
  onClose,
  onSubmit,
}) => {
  const expenseOptions = useMemo(
    () =>
      expenseCategories && expenseCategories.length > 0
        ? expenseCategories
        : categories && categories.length > 0
          ? categories
          : [...EXPENSE_CATEGORIES],
    [expenseCategories, categories]
  );

  const incomeOptions = useMemo(
    () =>
      incomeCategories && incomeCategories.length > 0
        ? incomeCategories
        : [...INCOME_CATEGORIES],
    [incomeCategories]
  );

  const resolvedDefaultExpense = resolveBuiltInCategoryName(
    'Makan & Minum',
    customCategories,
    'expense'
  );
  const resolvedDefaultIncome = resolveBuiltInCategoryName(
    'Gaji',
    customCategories,
    'income'
  );

  const defaultExpenseCategory = expenseOptions.includes(resolvedDefaultExpense)
    ? resolvedDefaultExpense
    : expenseOptions[0] || resolveBuiltInCategoryName('Lainnya', customCategories, 'expense');

  const defaultIncomeCategory = incomeOptions.includes(resolvedDefaultIncome)
    ? resolvedDefaultIncome
    : incomeOptions[0] || resolveBuiltInCategoryName('Pemasukan', customCategories, 'income');

  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(defaultExpenseCategory);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('Tag');
  const [newCatColor, setNewCatColor] = useState('#0F766E');
  const [showInlinePicker, setShowInlinePicker] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCategoryOptions = txType === 'income' ? incomeOptions : expenseOptions;

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setAddingCategory(false);
    setShowInlinePicker(false);
    setNewCategoryName('');
    setNewCatIcon('Tag');
    setNewCatColor('#0F766E');
    if (editingTx) {
      setAccountId(editingTx.accountId);
      setDate(editingTx.date);
      setTxType(editingTx.txType);
      setAmount(String(editingTx.amount));
      setMerchant(editingTx.merchant);
      setDescription(editingTx.description);
      setCategory(editingTx.category);
      setCategoryTouched(true);
      setReference(editingTx.reference);
      setNotes(editingTx.notes);
    } else {
      setAccountId(accounts[0]?.id || '');
      setDate(new Date().toISOString().slice(0, 10));
      setTxType('expense');
      setAmount('');
      setMerchant('');
      setDescription('');
      setCategory(defaultExpenseCategory);
      setCategoryTouched(false);
      setReference('');
      setNotes('');
    }
  }, [isOpen, editingTx, accounts, defaultExpenseCategory]);

  const handleAddCustomCategory = async () => {
    if (!onCreateCategory) return;
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setError('Masukkan nama kategori baru.');
      return;
    }
    setError(null);
    setSavingCategory(true);
    try {
      const savedName = await onCreateCategory(trimmed, txType, {
        icon: newCatIcon,
        color: newCatColor,
      });
      setCategory(savedName);
      setCategoryTouched(true);
      setNewCategoryName('');
      setAddingCategory(false);
      setShowInlinePicker(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah kategori kustom.');
    } finally {
      setSavingCategory(false);
    }
  };

  if (!isOpen) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);

  const handleSwitchType = (nextType: TransactionType) => {
    if (nextType === txType) return;
    setTxType(nextType);
    setNewCatIcon(nextType === 'income' ? 'Coins' : 'Tag');
    setNewCatColor(nextType === 'income' ? '#059669' : '#0F766E');
    const targetOptions = nextType === 'income' ? incomeOptions : expenseOptions;
    if (!targetOptions.includes(category)) {
      const combined = `${merchant} ${description}`.trim();
      if (combined) {
        const inferred = inferCategoryFromMerchant(combined, nextType === 'income');
        const resolved = resolveBuiltInCategoryName(inferred, customCategories, nextType);
        setCategory(
          targetOptions.includes(resolved)
            ? resolved
            : nextType === 'income'
              ? defaultIncomeCategory
              : defaultExpenseCategory
        );
      } else {
        setCategory(nextType === 'income' ? defaultIncomeCategory : defaultExpenseCategory);
      }
      setCategoryTouched(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountId) {
      setError('Pilih sumber dana terlebih dahulu.');
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Nominal harus lebih besar dari 0.');
      return;
    }
    if (!merchant.trim()) {
      setError('Nama merchant atau pihak transaksi wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        txId: editingTx?.id,
        accountId,
        date,
        txType,
        amount: parsedAmount,
        merchant: merchant.trim(),
        description: description.trim() || merchant.trim(),
        category,
        reference: reference.trim(),
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan transaksi terenkripsi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {editingTx ? 'Ubah Transaksi' : 'Catat Transaksi Baru'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Data dienkripsi AES-256-GCM sebelum dikirim ke cloud
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => handleSwitchType('expense')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                txType === 'expense'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => handleSwitchType('income')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                txType === 'income'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Pemasukan
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Sumber Dana
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={Boolean(editingTx)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white disabled:opacity-60"
              >
                {accounts.length === 0 && <option value="">Belum ada sumber dana</option>}
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({formatAccountProviderLabel(acc.provider)} · {acc.currency})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Tanggal
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Nominal ({selectedAccount?.currency || 'AED'})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Kategori ({txType === 'income' ? 'Pemasukan' : 'Pengeluaran'})
                </label>
                {onCreateCategory && (
                  <button
                    type="button"
                    onClick={() => setAddingCategory((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{addingCategory ? 'Batal' : 'Kategori Baru'}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <CategoryBadgeIcon
                  categoryName={category}
                  customCategories={customCategories}
                  txType={txType}
                  size="md"
                />
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCategoryTouched(true);
                  }}
                  className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                >
                  {category && !activeCategoryOptions.includes(category) && (
                    <option value={category}>{category}</option>
                  )}
                  {activeCategoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {addingCategory && onCreateCategory && (
            <div className="p-3 rounded-lg border border-teal-200 dark:border-teal-900/60 bg-slate-50 dark:bg-slate-950/60 space-y-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInlinePicker((v) => !v)}
                  title="Pilih ikon & warna kategori"
                  aria-label="Pilih ikon dan warna kategori baru"
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer shrink-0"
                >
                  <CategoryBadgeIcon
                    categoryName={newCategoryName || 'Baru'}
                    iconOverride={newCatIcon}
                    colorOverride={newCatColor}
                    size="xs"
                  />
                  <Palette className="w-3 h-3 text-slate-400" />
                </button>
                <input
                  type="text"
                  maxLength={50}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddCustomCategory();
                    }
                  }}
                  placeholder={
                    txType === 'income'
                      ? 'Kategori pemasukan baru (misal: Dividen, Sewa Properti)'
                      : 'Kategori pengeluaran baru (misal: Pendidikan, Zakat, Hobi)'
                  }
                  className="flex-1 px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="button"
                  disabled={savingCategory || !newCategoryName.trim()}
                  onClick={() => void handleAddCustomCategory()}
                  className="px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {savingCategory ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
              {showInlinePicker && (
                <CategoryVisualPicker
                  selectedIcon={newCatIcon}
                  selectedColor={newCatColor}
                  onSelectIcon={setNewCatIcon}
                  onSelectColor={setNewCatColor}
                />
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Merchant / Pihak Terkait
            </label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => {
                const nextMerchant = e.target.value;
                setMerchant(nextMerchant);
                if (!categoryTouched) {
                  const combined = `${nextMerchant} ${description}`;
                  if (txType === 'expense' && isHouseholdGoodsMerchant(combined)) {
                    setCategory(
                      resolveBuiltInCategoryName('Barang Rumah Tangga', customCategories, 'expense')
                    );
                  } else {
                    const inferred = inferCategoryFromMerchant(
                      combined,
                      txType === 'income',
                      category
                    );
                    setCategory(
                      resolveBuiltInCategoryName(inferred, customCategories, txType)
                    );
                  }
                }
              }}
              placeholder={
                txType === 'income'
                  ? 'Contoh: PT Maju Jaya, Payroll, Klien Retainer'
                  : 'Contoh: IKEA, Homecentre, Carrefour UAE, ADNOC'
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Keterangan Mutasi
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => {
                const nextDesc = e.target.value;
                setDescription(nextDesc);
                if (!categoryTouched) {
                  const combined = `${merchant} ${nextDesc}`;
                  if (txType === 'expense' && isHouseholdGoodsMerchant(combined)) {
                    setCategory(
                      resolveBuiltInCategoryName('Barang Rumah Tangga', customCategories, 'expense')
                    );
                  } else {
                    const inferred = inferCategoryFromMerchant(
                      combined,
                      txType === 'income',
                      category
                    );
                    setCategory(
                      resolveBuiltInCategoryName(inferred, customCategories, txType)
                    );
                  }
                }
              }}
              placeholder="Catatan singkat transaksi"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || accounts.length === 0}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Mengenkripsi...' : editingTx ? 'Simpan Perubahan' : 'Simpan Transaksi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
