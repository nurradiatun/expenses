import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileUp,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  compareTransactionsByDateAsc,
  compareTransactionsByDateDesc,
  EXPENSE_CATEGORIES,
  formatAccountProviderLabel,
  INCOME_CATEGORIES,
  normalizeCategoryKey,
  TRANSACTION_CATEGORIES,
  type CustomCategory,
  type DisplayCurrency,
  type FinancialAccount,
  type FinancialTransaction,
  type ResolvedBuiltInCategory,
  type SupportedCurrency,
  type SyncLogEntry,
  type TransactionType,
} from '../types';
import {
  convertCurrency,
  formatMoney,
  formatMonthLabel,
  formatRelativeTimestamp,
  formatShortDate,
} from '../lib/formatters';
import { exportReportToPdf, exportTransactionsToCsv } from '../lib/exporters';
import { useLanguage } from '../lib/i18n';
import { CategoryBadgeIcon, type CategoryAppearance } from '../lib/categoryVisuals';
import { buildAccountColorMap } from '../lib/accountColors';
import { CategoryManagerModal } from './CustomCategoryManager';
import { ExportFormatModal } from './ExportFormatModal';

interface TransactionsViewProps {
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  syncLogs?: SyncLogEntry[];
  categories?: string[];
  expenseCategories?: string[];
  incomeCategories?: string[];
  customCategories?: CustomCategory[];
  displayCurrency: DisplayCurrency;
  aedToIdrRate: number;
  fxRates?: Partial<Record<SupportedCurrency, number>>;
  userName: string;
  onOpenNewTx: () => void;
  onEditTx: (tx: FinancialTransaction) => void;
  onDeleteTx: (txId: string) => Promise<void>;
  onBulkDeleteTx: (txIds: string[]) => Promise<number>;
  onBulkUpdateCategory?: (txIds: string[], newCategory: string) => Promise<number>;
  onCreateCategory?: (
    name: string,
    categoryType: TransactionType,
    appearance?: CategoryAppearance
  ) => Promise<string>;
  onUpdateCategory?: (
    category: CustomCategory,
    newName: string,
    appearance?: CategoryAppearance
  ) => Promise<number>;
  onDeleteCategory?: (category: CustomCategory, fallbackCategory: string) => Promise<number>;
  onUpdateBuiltInCategory?: (
    item: ResolvedBuiltInCategory,
    newName: string,
    appearance?: CategoryAppearance
  ) => Promise<number>;
  onDeleteBuiltInCategory?: (
    item: ResolvedBuiltInCategory,
    fallbackCategory: string
  ) => Promise<number>;
  onRenameUnlistedCategory?: (
    oldName: string,
    newName: string,
    categoryType: TransactionType,
    appearance?: CategoryAppearance
  ) => Promise<number>;
  onDeleteUnlistedCategory?: (
    categoryName: string,
    fallbackCategory: string,
    categoryType: TransactionType
  ) => Promise<number>;
  onRestoreBuiltInCategories?: () => Promise<number | void>;
  onOpenImportModal: () => void;
  manualCreatedTick?: number;
  readOnly?: boolean;
}

type ColumnFilterKey = 'date' | 'merchant' | 'account' | 'category' | 'amount';
type SortOption =
  | 'date_desc'
  | 'date_asc'
  | 'merchant_asc'
  | 'merchant_desc'
  | 'amount_desc'
  | 'amount_asc';

const PAGE_SIZE = 20;
const SYNC_LOGS_PAGE_SIZE = 10;

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  accounts,
  transactions,
  syncLogs = [],
  categories,
  expenseCategories,
  incomeCategories,
  customCategories = [],
  displayCurrency,
  aedToIdrRate,
  fxRates,
  userName,
  onOpenNewTx,
  onEditTx,
  onDeleteTx,
  onBulkDeleteTx,
  onBulkUpdateCategory,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onUpdateBuiltInCategory,
  onDeleteBuiltInCategory,
  onRenameUnlistedCategory,
  onDeleteUnlistedCategory,
  onRestoreBuiltInCategories,
  onOpenImportModal,
  manualCreatedTick = 0,
  readOnly = false,
}) => {
  const { lang, tr } = useLanguage();
  const rateInput = fxRates ?? aedToIdrRate;
  const expenseCategoryOptions = useMemo(
    () =>
      expenseCategories && expenseCategories.length > 0
        ? expenseCategories
        : [...EXPENSE_CATEGORIES],
    [expenseCategories]
  );
  const incomeCategoryOptions = useMemo(
    () =>
      incomeCategories && incomeCategories.length > 0
        ? incomeCategories
        : [...INCOME_CATEGORIES],
    [incomeCategories]
  );
  const categoryOptions =
    categories && categories.length > 0 ? categories : [...TRANSACTION_CATEGORIES];

  // Global quick search & column filters
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [categorySearch, setCategorySearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'income' | 'expense'>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | SupportedCurrency>('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date_desc');

  // Column filter popover state
  const [openColFilter, setOpenColFilter] = useState<ColumnFilterKey | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Pagination, selection, detail & modals
  const [currentPage, setCurrentPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState<string>(
    () => expenseCategoryOptions[0] || categoryOptions[0] || 'Lainnya'
  );
  const [bulkUpdatingCategory, setBulkUpdatingCategory] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [detailTxId, setDetailTxId] = useState<string | null>(null);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  useEffect(() => {
    const allChoices = [...expenseCategoryOptions, ...incomeCategoryOptions, ...categoryOptions];
    if (allChoices.length === 0) return;
    const stillExists = allChoices.some(
      (c) => normalizeCategoryKey(c) === normalizeCategoryKey(bulkCategoryTarget)
    );
    if (!stillExists) {
      setBulkCategoryTarget(allChoices[0]);
    }
  }, [expenseCategoryOptions, incomeCategoryOptions, categoryOptions, bulkCategoryTarget]);

  // Close column filter popover on click-outside or Escape
  useEffect(() => {
    if (!openColFilter) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-col-filter-trigger]')) return;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setOpenColFilter(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenColFilter(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openColFilter]);

  const toggleColumnFilter = (key: ColumnFilterKey, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openColFilter === key) {
      setOpenColFilter(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverWidth = 280;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 16));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 360);
    setPopoverPos({ top, left });
    setOpenColFilter(key);
  };

  // Keep selectedIds pruned to existing transactions
  useEffect(() => {
    const validIds = new Set(transactions.map((t) => t.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [transactions]);

  const accountMap = useMemo(
    () => new Map(accounts.map((acc) => [acc.id, acc])),
    [accounts]
  );

  const accountColorMap = useMemo(
    () => buildAccountColorMap(accounts, transactions),
    [accounts, transactions]
  );

  const accountFilterOptions = useMemo(
    () => Array.from(accountColorMap.values()),
    [accountColorMap]
  );

  const totalLogPages = Math.max(1, Math.ceil(syncLogs.length / SYNC_LOGS_PAGE_SIZE));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const logPageStart = (safeLogPage - 1) * SYNC_LOGS_PAGE_SIZE;

  useEffect(() => {
    if (logPage > totalLogPages) {
      setLogPage(totalLogPages);
    }
  }, [logPage, totalLogPages]);

  const paginatedSyncLogs = useMemo(
    () => syncLogs.slice(logPageStart, logPageStart + SYNC_LOGS_PAGE_SIZE),
    [syncLogs, logPageStart]
  );

  const logPageNumbers = useMemo(() => {
    if (totalLogPages <= 7) {
      return Array.from({ length: totalLogPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [1];
    const start = Math.max(2, safeLogPage - 1);
    const end = Math.min(totalLogPages - 1, safeLogPage + 1);
    if (start > 2) pages.push('ellipsis');
    for (let p = start; p <= end; p += 1) pages.push(p);
    if (end < totalLogPages - 1) pages.push('ellipsis');
    pages.push(totalLogPages);
    return pages;
  }, [totalLogPages, safeLogPage]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => set.add(t.monthKey));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions]);

  const availableCurrencies = useMemo(() => {
    const set = new Set<SupportedCurrency>();
    accounts.forEach((acc) => set.add(acc.currency));
    transactions.forEach((t) => set.add(t.currency));
    return Array.from(set);
  }, [accounts, transactions]);

  const isColActive = {
    date: monthFilter !== 'ALL' || Boolean(dateFrom) || Boolean(dateTo) || sortBy === 'date_asc',
    merchant: Boolean(merchantFilter.trim()) || sortBy === 'merchant_asc' || sortBy === 'merchant_desc',
    account: accountFilter !== 'ALL',
    category: categoryFilter !== 'ALL',
    amount:
      typeFilter !== 'ALL' ||
      currencyFilter !== 'ALL' ||
      minAmount.trim() !== '' ||
      maxAmount.trim() !== '' ||
      sortBy === 'amount_desc' ||
      sortBy === 'amount_asc',
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count += 1;
    if (monthFilter !== 'ALL' || dateFrom || dateTo) count += 1;
    if (merchantFilter.trim()) count += 1;
    if (accountFilter !== 'ALL') count += 1;
    if (categoryFilter !== 'ALL') count += 1;
    if (typeFilter !== 'ALL' || currencyFilter !== 'ALL' || minAmount.trim() !== '' || maxAmount.trim() !== '') {
      count += 1;
    }
    return count;
  }, [
    searchQuery,
    monthFilter,
    dateFrom,
    dateTo,
    merchantFilter,
    accountFilter,
    categoryFilter,
    typeFilter,
    currencyFilter,
    minAmount,
    maxAmount,
  ]);

  const resetAllFilters = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setMonthFilter('ALL');
    setMerchantFilter('');
    setAccountFilter('ALL');
    setCategoryFilter('ALL');
    setCategorySearch('');
    setTypeFilter('ALL');
    setCurrencyFilter('ALL');
    setMinAmount('');
    setMaxAmount('');
    setSortBy('date_desc');
    setOpenColFilter(null);
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const mq = merchantFilter.trim().toLowerCase();
    const minVal = minAmount.trim() !== '' ? Number(minAmount) : null;
    const maxVal = maxAmount.trim() !== '' ? Number(maxAmount) : null;
    const hasMin = minVal !== null && Number.isFinite(minVal);
    const hasMax = maxVal !== null && Number.isFinite(maxVal);

    const list = transactions.filter((tx) => {
      if (monthFilter !== 'ALL' && tx.monthKey !== monthFilter) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;
      if (typeFilter !== 'ALL' && tx.txType !== typeFilter) return false;
      if (accountFilter !== 'ALL' && (tx.accountId || 'unassigned') !== accountFilter) return false;
      if (
        categoryFilter !== 'ALL' &&
        normalizeCategoryKey(tx.category) !== normalizeCategoryKey(categoryFilter)
      ) {
        return false;
      }
      if (currencyFilter !== 'ALL' && tx.currency !== currencyFilter) return false;
      if (hasMin && tx.amount < (minVal as number)) return false;
      if (hasMax && tx.amount > (maxVal as number)) return false;
      if (mq) {
        const mHay = `${tx.merchant} ${tx.description} ${tx.reference} ${tx.notes}`.toLowerCase();
        if (!mHay.includes(mq)) return false;
      }
      if (q) {
        const accName = accountMap.get(tx.accountId)?.name || '';
        const hay = `${tx.date} ${formatShortDate(tx.date)} ${tx.merchant} ${tx.description} ${accName} ${tx.category} ${tx.createdByName || ''} ${tx.createdByEmail || ''} ${tx.reference} ${tx.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'date_asc') {
      return [...list].sort(compareTransactionsByDateAsc);
    }
    if (sortBy === 'merchant_asc') {
      return [...list].sort((a, b) => a.merchant.localeCompare(b.merchant));
    }
    if (sortBy === 'merchant_desc') {
      return [...list].sort((a, b) => b.merchant.localeCompare(a.merchant));
    }
    if (sortBy === 'amount_desc') {
      return [...list].sort(
        (a, b) =>
          convertCurrency(b.amount, b.currency, displayCurrency, rateInput) -
          convertCurrency(a.amount, a.currency, displayCurrency, rateInput)
      );
    }
    if (sortBy === 'amount_asc') {
      return [...list].sort(
        (a, b) =>
          convertCurrency(a.amount, a.currency, displayCurrency, rateInput) -
          convertCurrency(b.amount, b.currency, displayCurrency, rateInput)
      );
    }
    return [...list].sort(compareTransactionsByDateDesc);
  }, [
    transactions,
    accountMap,
    searchQuery,
    dateFrom,
    dateTo,
    monthFilter,
    merchantFilter,
    accountFilter,
    typeFilter,
    categoryFilter,
    currencyFilter,
    minAmount,
    maxAmount,
    sortBy,
    displayCurrency,
    rateInput,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;

  // Reset to page 1 when filters or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    dateFrom,
    dateTo,
    monthFilter,
    merchantFilter,
    accountFilter,
    typeFilter,
    categoryFilter,
    currencyFilter,
    minAmount,
    maxAmount,
    sortBy,
  ]);

  // Clamp currentPage when filtered count shrinks (e.g. after deletions)
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Jump to page 1 when the user records a new manual transaction
  useEffect(() => {
    if (manualCreatedTick > 0) {
      setCurrentPage(1);
    }
  }, [manualCreatedTick]);

  const paginated = useMemo(
    () => filtered.slice(pageStart, pageStart + PAGE_SIZE),
    [filtered, pageStart]
  );

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | 'ellipsis')[] = [1];
    const start = Math.max(2, safePage - 1);
    const end = Math.min(totalPages - 1, safePage + 1);
    if (start > 2) pages.push('ellipsis');
    for (let p = start; p <= end; p += 1) pages.push(p);
    if (end < totalPages - 1) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }, [totalPages, safePage]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of filtered) {
      const val = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      if (tx.txType === 'income') income += val;
      else expense += val;
    }
    return { income, expense };
  }, [filtered, displayCurrency, rateInput]);

  const selectedFilteredCount = useMemo(
    () => filtered.reduce((acc, tx) => (selectedIds.has(tx.id) ? acc + 1 : acc), 0),
    [filtered, selectedIds]
  );

  const selectedPageCount = useMemo(
    () => paginated.reduce((acc, tx) => (selectedIds.has(tx.id) ? acc + 1 : acc), 0),
    [paginated, selectedIds]
  );

  const allFilteredSelected =
    filtered.length > 0 && selectedFilteredCount === filtered.length;

  const allPageSelected =
    paginated.length > 0 && selectedPageCount === paginated.length;

  const toggleSelectRow = (id: string) => {
    setConfirmBulkDelete(false);
    setBulkMessage(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    setConfirmBulkDelete(false);
    setBulkMessage(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const tx of paginated) next.delete(tx.id);
      } else {
        for (const tx of paginated) next.add(tx.id);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setConfirmBulkDelete(false);
    setBulkMessage(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const tx of filtered) next.delete(tx.id);
      } else {
        for (const tx of filtered) next.add(tx.id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setBulkMessage(null);
    try {
      const idsToDelete = Array.from(selectedIds);
      const count = await onBulkDeleteTx(idsToDelete);
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      setBulkMessage(
        tr(
          `${count} transaksi berhasil dihapus dari brankas.`,
          `${count} transactions deleted from the vault.`
        )
      );
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkUpdateCategory = async () => {
    if (!onBulkUpdateCategory || selectedIds.size === 0 || !bulkCategoryTarget) return;
    setBulkUpdatingCategory(true);
    setConfirmBulkDelete(false);
    setBulkMessage(null);
    try {
      const idsToUpdate = Array.from(selectedIds);
      const count = await onBulkUpdateCategory(idsToUpdate, bulkCategoryTarget);
      setSelectedIds(new Set());
      setBulkMessage(
        tr(
          `${count} transaksi berhasil diubah ke kategori "${bulkCategoryTarget}".`,
          `${count} transactions updated to category "${bulkCategoryTarget}".`
        )
      );
    } finally {
      setBulkUpdatingCategory(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteTx(id);
      if (detailTxId === id) setDetailTxId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCsvExport = () => {
    const suffix = monthFilter === 'ALL' ? (lang === 'en' ? 'all-periods' : 'semua-periode') : monthFilter;
    exportTransactionsToCsv(filtered, accounts, `my-expenses-transaksi-${suffix}.csv`);
  };

  const handlePdfExport = () => {
    const suffix = monthFilter === 'ALL' ? (lang === 'en' ? 'all-periods' : 'semua-periode') : monthFilter;
    exportReportToPdf({
      transactions: filtered,
      accounts,
      monthFilter,
      displayCurrency,
      aedToIdrRate,
      fxRates,
      userName,
      lang,
      fileName: `my-expenses-laporan-${suffix}.pdf`,
    });
  };

  const filteredExpenseCategoryChoices = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return expenseCategoryOptions;
    return expenseCategoryOptions.filter((c) => c.toLowerCase().includes(q));
  }, [expenseCategoryOptions, categorySearch]);

  const filteredIncomeCategoryChoices = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return incomeCategoryOptions;
    return incomeCategoryOptions.filter((c) => c.toLowerCase().includes(q));
  }, [incomeCategoryOptions, categorySearch]);

  const filteredOtherCategoryChoices = useMemo(() => {
    const known = new Set(
      [...expenseCategoryOptions, ...incomeCategoryOptions].map((c) => normalizeCategoryKey(c))
    );
    const q = categorySearch.trim().toLowerCase();
    return categoryOptions.filter((c) => {
      if (known.has(normalizeCategoryKey(c))) return false;
      return !q || c.toLowerCase().includes(q);
    });
  }, [categoryOptions, expenseCategoryOptions, incomeCategoryOptions, categorySearch]);

  const detailTx = useMemo(
    () => (detailTxId ? transactions.find((t) => t.id === detailTxId) || null : null),
    [detailTxId, transactions]
  );

  const detailAccount = detailTx ? accountMap.get(detailTx.accountId) : undefined;

  return (
    <div className="space-y-5">
      {/* Compact Action & Search Toolbar (no filter bar above table) */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex-1 max-w-md space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr(
                  'Cari merchant, keterangan, referensi, atau tanggal (YYYY-MM-DD)...',
                  'Search merchant, description, reference, or date (YYYY-MM-DD)...'
                )}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {filtered.length} {tr('entri', 'entries')}
                {activeFilterCount > 0 && transactions.length !== filtered.length
                  ? ` ${tr('dari', 'of')} ${transactions.length}`
                  : ''}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                +{formatMoney(totals.income, displayCurrency)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-red-600 dark:text-red-400">
                -{formatMoney(totals.expense, displayCurrency)}
              </span>
              {(activeFilterCount > 0 || sortBy !== 'date_desc') && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-medium hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>
                    {tr('Reset Filter', 'Reset Filters')}
                    {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!readOnly &&
              onCreateCategory &&
              onUpdateCategory &&
              onDeleteCategory &&
              onUpdateBuiltInCategory &&
              onDeleteBuiltInCategory && (
              <button
                type="button"
                onClick={() => setCatManagerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Tag className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                <span>{tr('Setting Kategori', 'Category Settings')}</span>
              </button>
            )}

            {!readOnly && (
              <button
                type="button"
                onClick={onOpenImportModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileUp className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                <span>{tr('Import File', 'Import File')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{tr('Ekspor', 'Export')}</span>
            </button>

            {!readOnly && (
              <button
                type="button"
                onClick={onOpenNewTx}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{tr('Catat Transaksi', 'Add Transaction')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {bulkMessage && (
        <div className="px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{bulkMessage}</span>
          <button
            type="button"
            onClick={() => setBulkMessage(null)}
            className="text-xs font-semibold hover:underline cursor-pointer"
          >
            {tr('Tutup', 'Close')}
          </button>
        </div>
      )}

      {/* Bulk Action Bar (Bulk Edit Category & Bulk Delete) */}
      {!readOnly && selectedIds.size > 0 && (
        <div
          className={`px-4 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-colors ${
            confirmBulkDelete
              ? 'border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30'
              : 'border-teal-200 dark:border-teal-900/60 bg-teal-50/70 dark:bg-teal-950/30'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
              {selectedIds.size} {tr('transaksi dipilih', 'transactions selected')}
            </span>
            {!allFilteredSelected && filtered.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                {tr(
                  `Pilih semua hasil filter (${filtered.length})`,
                  `Select all filtered (${filtered.length})`
                )}
              </button>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="font-medium text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
            >
              {tr('Batalkan pilihan', 'Clear selection')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {confirmBulkDelete ? (
              <>
                <span className="text-xs font-medium text-red-800 dark:text-red-200">
                  {tr(
                    `Hapus permanen ${selectedIds.size} transaksi?`,
                    `Permanently delete ${selectedIds.size} transactions?`
                  )}
                </span>
                <button
                  type="button"
                  disabled={bulkDeleting || bulkUpdatingCategory}
                  onClick={() => setConfirmBulkDelete(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="button"
                  disabled={bulkDeleting || bulkUpdatingCategory}
                  onClick={() => void handleConfirmBulkDelete()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {bulkDeleting
                      ? tr('Menghapus...', 'Deleting...')
                      : tr(`Ya, Hapus (${selectedIds.size})`, `Yes, Delete (${selectedIds.size})`)}
                  </span>
                </button>
              </>
            ) : (
              <>
                {onBulkUpdateCategory && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={bulkCategoryTarget}
                      onChange={(e) => setBulkCategoryTarget(e.target.value)}
                      disabled={bulkUpdatingCategory || bulkDeleting}
                      aria-label={tr('Pilih kategori massal', 'Select bulk category')}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      <optgroup label={tr('Pengeluaran', 'Expense')}>
                        {expenseCategoryOptions.map((cat) => (
                          <option key={`bulk-exp-${cat}`} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={tr('Pemasukan', 'Income')}>
                        {incomeCategoryOptions.map((cat) => (
                          <option key={`bulk-inc-${cat}`} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </optgroup>
                      {filteredOtherCategoryChoices.length > 0 && (
                        <optgroup label={tr('Lainnya', 'Other')}>
                          {filteredOtherCategoryChoices.map((cat) => (
                            <option key={`bulk-oth-${cat}`} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      type="button"
                      disabled={bulkUpdatingCategory || bulkDeleting || !bulkCategoryTarget}
                      onClick={() => void handleBulkUpdateCategory()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer whitespace-nowrap"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      <span>
                        {bulkUpdatingCategory
                          ? tr('Menyimpan...', 'Updating...')
                          : tr('Ubah Kategori', 'Update Category')}
                      </span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={bulkUpdatingCategory || bulkDeleting}
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{tr(`Hapus Terpilih (${selectedIds.size})`, `Delete Selected (${selectedIds.size})`)}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* High-density Table with per-column filter buttons */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {!readOnly && (
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAllPage}
                      aria-label="Pilih semua transaksi di halaman ini"
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                    />
                  </th>
                )}

                <th className="py-3 px-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <span>{tr('Tanggal', 'Date')}</span>
                    <button
                      type="button"
                      data-col-filter-trigger
                      onClick={(e) => toggleColumnFilter('date', e)}
                      aria-label={tr('Filter kolom tanggal', 'Filter date column')}
                      title={tr('Filter kolom tanggal', 'Filter date column')}
                      className={`relative p-1 rounded border transition-colors cursor-pointer ${
                        isColActive.date || openColFilter === 'date'
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                          : 'border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      {isColActive.date && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-teal-600" />
                      )}
                    </button>
                  </div>
                </th>

                <th className="py-3 px-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <span>{tr('Merchant & Keterangan', 'Merchant & Description')}</span>
                    <button
                      type="button"
                      data-col-filter-trigger
                      onClick={(e) => toggleColumnFilter('merchant', e)}
                      aria-label={tr('Filter kolom merchant dan keterangan', 'Filter merchant and description column')}
                      title={tr('Filter kolom merchant & keterangan', 'Filter merchant & description column')}
                      className={`relative p-1 rounded border transition-colors cursor-pointer ${
                        isColActive.merchant || openColFilter === 'merchant'
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                          : 'border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      {isColActive.merchant && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-teal-600" />
                      )}
                    </button>
                  </div>
                </th>

                <th className="py-3 px-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <span>{tr('Sumber Dana', 'Funding Source')}</span>
                    <button
                      type="button"
                      data-col-filter-trigger
                      onClick={(e) => toggleColumnFilter('account', e)}
                      aria-label={tr('Filter kolom sumber dana', 'Filter funding source column')}
                      title={tr('Filter kolom sumber dana', 'Filter funding source column')}
                      className={`relative p-1 rounded border transition-colors cursor-pointer ${
                        isColActive.account || openColFilter === 'account'
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                          : 'border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      {isColActive.account && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-teal-600" />
                      )}
                    </button>
                  </div>
                </th>

                <th className="py-3 px-4 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <span>{tr('Kategori', 'Category')}</span>
                    <button
                      type="button"
                      data-col-filter-trigger
                      onClick={(e) => toggleColumnFilter('category', e)}
                      aria-label={tr('Filter kolom kategori', 'Filter category column')}
                      title={tr('Filter kolom kategori', 'Filter category column')}
                      className={`relative p-1 rounded border transition-colors cursor-pointer ${
                        isColActive.category || openColFilter === 'category'
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                          : 'border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      {isColActive.category && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-teal-600" />
                      )}
                    </button>
                  </div>
                </th>

                <th className="py-3 px-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <span>{tr('Nominal', 'Amount')}</span>
                    <button
                      type="button"
                      data-col-filter-trigger
                      onClick={(e) => toggleColumnFilter('amount', e)}
                      aria-label={tr('Filter kolom nominal', 'Filter amount column')}
                      title={tr('Filter kolom nominal', 'Filter amount column')}
                      className={`relative p-1 rounded border transition-colors cursor-pointer ${
                        isColActive.amount || openColFilter === 'amount'
                          ? 'border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400'
                          : 'border-transparent hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      <Filter className="w-3 h-3" />
                      {isColActive.amount && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-teal-600" />
                      )}
                    </button>
                  </div>
                </th>

                <th className="py-3 px-4 text-right whitespace-nowrap">{tr('Aksi', 'Actions')}</th>
              </tr>
            </thead>

            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={readOnly ? 6 : 7} className="py-14 px-6 text-center">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {tr('Tidak ada transaksi yang cocok', 'No matching transactions')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {tr(
                        'Catat transaksi manual baru, sesuaikan filter kolom, atau unggah file PDF/JPG/PNG.',
                        'Add a manual transaction, adjust column filters, or upload a PDF/JPG/PNG file.'
                      )}
                    </p>
                    <div className="mt-4 flex flex-wrap items-start justify-center gap-3">
                      {activeFilterCount > 0 && (
                        <button
                          type="button"
                          onClick={resetAllFilters}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{tr('Reset Filter', 'Reset Filters')}</span>
                        </button>
                      )}
                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            onClick={onOpenNewTx}
                            className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                          >
                            {tr('Catat Transaksi', 'Add Transaction')}
                          </button>
                          <button
                            type="button"
                            onClick={onOpenImportModal}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <FileUp className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                            <span>Import File</span>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {paginated.map((tx) => {
                  const isChecked = selectedIds.has(tx.id);
                  const accColor = accountColorMap.get(tx.accountId || 'unassigned');
                  const accDisplayName =
                    accColor?.accountName || accountMap.get(tx.accountId)?.name || 'Sumber Dana';
                  return (
                    <tr
                      key={tx.id}
                      className={`transition-colors ${
                        isChecked
                          ? 'bg-teal-50/60 dark:bg-teal-950/30'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      {!readOnly && (
                        <td className="py-2.5 px-4">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectRow(tx.id)}
                            aria-label={`Pilih transaksi ${tx.merchant}`}
                            className="rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                        {formatShortDate(tx.date)}
                      </td>
                      <td className="py-2.5 px-4 max-w-xs">
                        <button
                          type="button"
                          onClick={() => setDetailTxId(tx.id)}
                          className="text-left w-full group cursor-pointer"
                        >
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate group-hover:text-teal-700 dark:group-hover:text-teal-400">
                            {tx.merchant}
                          </p>
                          {tx.description !== tx.merchant && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {tx.description}
                            </p>
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {accColor ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium ${accColor.theme.badgeClass}`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: accColor.theme.accentHex }}
                            />
                            <span className="truncate max-w-[130px]">{accDisplayName}</span>
                          </span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-300">
                            {accDisplayName}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <CategoryBadgeIcon
                            categoryName={tx.category}
                            customCategories={customCategories}
                            txType={tx.txType}
                            size="xs"
                          />
                          <span>{tx.category}</span>
                        </div>
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono font-semibold whitespace-nowrap tabular-nums ${
                          tx.txType === 'income'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {tx.txType === 'income' ? '+' : '-'}
                        {formatMoney(tx.amount, tx.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailTxId(tx.id)}
                            aria-label="Lihat detail transaksi"
                            title="Detail transaksi"
                            className="p-1.5 rounded text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {!readOnly && (
                            <>
                              <button
                                type="button"
                                onClick={() => onEditTx(tx)}
                                aria-label="Ubah transaksi"
                                title="Ubah transaksi"
                                className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(tx.id)}
                                disabled={deletingId === tx.id}
                                aria-label="Hapus transaksi"
                                title="Hapus transaksi"
                                className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              {tr('Menampilkan', 'Showing')} {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} {tr('dari', 'of')}{' '}
              {filtered.length} {tr('transaksi', 'transactions')} ({PAGE_SIZE} {tr('per halaman', 'per page')})
            </p>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label={tr('Halaman sebelumnya', 'Previous page')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>{tr('Sebelumnya', 'Previous')}</span>
                </button>

                {pageNumbers.map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-1.5 text-xs text-slate-400 select-none"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setCurrentPage(item)}
                      aria-current={item === safePage ? 'page' : undefined}
                      className={`min-w-[30px] h-[30px] px-2 rounded-lg text-xs font-mono tabular-nums font-medium cursor-pointer transition-colors ${
                        item === safePage
                          ? 'bg-teal-700 text-white shadow-sm'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  aria-label={tr('Halaman berikutnya', 'Next page')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>{tr('Berikutnya', 'Next')}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Statement Import Audit History */}
      <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            {tr('Riwayat Impor Mutasi', 'Statement Import History')}
          </h3>
        </div>

        {syncLogs.length === 0 ? (
          <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
            {tr('Belum ada riwayat impor mutasi tercatat.', 'No statement import history recorded yet.')}
          </p>
        ) : (
          <>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {paginatedSyncLogs.map((log) => (
                <div key={log.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {log.syncType === 'pdf_import'
                        ? tr('Impor Mutasi PDF / Gambar', 'PDF / Image Statement Import')
                        : tr('Aktivitas Sumber Dana Terdahulu', 'Previous Funding Source Activity')}
                    </span>
                    <span className="text-slate-400 mx-1.5">·</span>
                    <span className="text-slate-600 dark:text-slate-400">{log.summary}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>+{log.recordsCount} {tr('entri', 'entries')}</span>
                    <span>·</span>
                    <span>{formatRelativeTimestamp(log.createdAtIso)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {tr('Menampilkan', 'Showing')} {logPageStart + 1}–{Math.min(logPageStart + SYNC_LOGS_PAGE_SIZE, syncLogs.length)} {tr('dari', 'of')}{' '}
                {syncLogs.length} {tr('riwayat', 'records')} ({SYNC_LOGS_PAGE_SIZE} {tr('per halaman', 'per page')})
              </p>

              {totalLogPages > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                    disabled={safeLogPage === 1}
                    aria-label={tr('Halaman riwayat sebelumnya', 'Previous history page')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>{tr('Sebelumnya', 'Previous')}</span>
                  </button>

                  {logPageNumbers.map((item, idx) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`log-ellipsis-${idx}`}
                        className="px-1.5 text-xs text-slate-400 select-none"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setLogPage(item)}
                        aria-current={item === safeLogPage ? 'page' : undefined}
                        className={`min-w-[30px] h-[30px] px-2 rounded-lg text-xs font-mono tabular-nums font-medium cursor-pointer transition-colors ${
                          item === safeLogPage
                            ? 'bg-teal-700 text-white shadow-sm'
                            : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                    disabled={safeLogPage === totalLogPages}
                    aria-label={tr('Halaman riwayat berikutnya', 'Next history page')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>{tr('Berikutnya', 'Next')}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Floating Column Filter Popover */}
      {openColFilter && (
        <div
          ref={popoverRef}
          style={{ top: popoverPos.top, left: popoverPos.left }}
          className="fixed z-50 w-[280px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3.5 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-semibold text-slate-900 dark:text-white">
              {openColFilter === 'date' && 'Filter Tanggal'}
              {openColFilter === 'merchant' && 'Filter Merchant & Keterangan'}
              {openColFilter === 'account' && 'Filter Sumber Dana'}
              {openColFilter === 'category' && 'Filter Kategori'}
              {openColFilter === 'amount' && 'Filter Nominal & Tipe'}
            </span>
            <button
              type="button"
              onClick={() => setOpenColFilter(null)}
              aria-label="Tutup filter kolom"
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {openColFilter === 'date' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Periode Bulan
                </label>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                >
                  <option value="ALL">Semua Periode</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Rentang Tanggal
                </label>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    aria-label="Dari tanggal"
                    className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div className="flex items-center gap-1.5 pl-5">
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    aria-label="Sampai tanggal"
                    className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Urutkan Tanggal
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSortBy('date_desc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'date_desc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Terbaru
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('date_asc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'date_asc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Terlama
                  </button>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMonthFilter('ALL');
                    setDateFrom('');
                    setDateTo('');
                    if (sortBy === 'date_asc') setSortBy('date_desc');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Reset kolom
                </button>
                <button
                  type="button"
                  onClick={() => setOpenColFilter(null)}
                  className="px-2.5 py-1 rounded bg-teal-700 text-white text-[11px] font-semibold cursor-pointer"
                >
                  Terapkan
                </button>
              </div>
            </div>
          )}

          {openColFilter === 'merchant' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Kata Kunci Merchant / Keterangan
                </label>
                <input
                  type="text"
                  value={merchantFilter}
                  onChange={(e) => setMerchantFilter(e.target.value)}
                  placeholder="Contoh: IKEA, Carrefour, Transfer..."
                  autoFocus
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Urutkan Nama
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSortBy('merchant_asc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'merchant_asc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    A → Z
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('merchant_desc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'merchant_desc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Z → A
                  </button>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMerchantFilter('');
                    if (sortBy === 'merchant_asc' || sortBy === 'merchant_desc') setSortBy('date_desc');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Reset kolom
                </button>
                <button
                  type="button"
                  onClick={() => setOpenColFilter(null)}
                  className="px-2.5 py-1 rounded bg-teal-700 text-white text-[11px] font-semibold cursor-pointer"
                >
                  Terapkan
                </button>
              </div>
            </div>
          )}

          {openColFilter === 'category' && (
            <div className="space-y-2">
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Cari kategori..."
                autoFocus
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <div className="max-h-52 overflow-y-auto space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('ALL');
                    setCategorySearch('');
                    setOpenColFilter(null);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                    categoryFilter === 'ALL'
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Semua Kategori
                </button>
                {filteredExpenseCategoryChoices.length > 0 && (
                  <>
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Pengeluaran
                    </p>
                    {filteredExpenseCategoryChoices.map((cat) => (
                      <button
                        key={`exp-${cat}`}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(cat);
                          setCategorySearch('');
                          setOpenColFilter(null);
                        }}
                        className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                          categoryFilter === cat
                            ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <CategoryBadgeIcon
                          categoryName={cat}
                          customCategories={customCategories}
                          txType="expense"
                          size="xs"
                        />
                        <span className="truncate">{cat}</span>
                      </button>
                    ))}
                  </>
                )}

                {filteredIncomeCategoryChoices.length > 0 && (
                  <>
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Pemasukan
                    </p>
                    {filteredIncomeCategoryChoices.map((cat) => (
                      <button
                        key={`inc-${cat}`}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(cat);
                          setCategorySearch('');
                          setOpenColFilter(null);
                        }}
                        className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                          categoryFilter === cat
                            ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <CategoryBadgeIcon
                          categoryName={cat}
                          customCategories={customCategories}
                          txType="income"
                          size="xs"
                        />
                        <span className="truncate">{cat}</span>
                      </button>
                    ))}
                  </>
                )}

                {filteredOtherCategoryChoices.map((cat) => (
                  <button
                    key={`oth-${cat}`}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(cat);
                      setCategorySearch('');
                      setOpenColFilter(null);
                    }}
                    className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                      categoryFilter === cat
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <CategoryBadgeIcon
                      categoryName={cat}
                      customCategories={customCategories}
                      size="xs"
                    />
                    <span className="truncate">{cat}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('ALL');
                    setCategorySearch('');
                    setOpenColFilter(null);
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Reset kolom
                </button>
              </div>
            </div>
          )}

          {openColFilter === 'amount' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Tipe Transaksi
                </label>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {(['ALL', 'expense', 'income'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      className={`py-1 text-[11px] font-medium rounded cursor-pointer ${
                        typeFilter === t
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {t === 'ALL' ? 'Semua' : t === 'expense' ? 'Keluar' : 'Masuk'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Mata Uang
                </label>
                <select
                  value={currencyFilter}
                  onChange={(e) => setCurrencyFilter(e.target.value as 'ALL' | SupportedCurrency)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                >
                  <option value="ALL">Semua Mata Uang</option>
                  {availableCurrencies.map((curr) => (
                    <option key={curr} value={curr}>
                      {curr}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Rentang Nominal
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    placeholder="Min"
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    placeholder="Maks"
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Urutkan Nominal
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSortBy('amount_desc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'amount_desc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Terbesar
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('amount_asc')}
                    className={`px-2 py-1.5 rounded-md border text-[11px] font-medium cursor-pointer ${
                      sortBy === 'amount_asc'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Terkecil
                  </button>
                </div>
              </div>

              <div className="flex justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setTypeFilter('ALL');
                    setCurrencyFilter('ALL');
                    setMinAmount('');
                    setMaxAmount('');
                    if (sortBy === 'amount_desc' || sortBy === 'amount_asc') setSortBy('date_desc');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Reset kolom
                </button>
                <button
                  type="button"
                  onClick={() => setOpenColFilter(null)}
                  className="px-2.5 py-1 rounded bg-teal-700 text-white text-[11px] font-semibold cursor-pointer"
                >
                  Terapkan
                </button>
              </div>
            </div>
          )}
          {openColFilter === 'account' && (
            <div className="space-y-2">
              <div className="max-h-52 overflow-y-auto space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setAccountFilter('ALL');
                    setOpenColFilter(null);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                    accountFilter === 'ALL'
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Semua Sumber Dana
                </button>
                {accountFilterOptions.map((accOpt) => (
                  <button
                    key={accOpt.accountId}
                    type="button"
                    onClick={() => {
                      setAccountFilter(accOpt.accountId);
                      setOpenColFilter(null);
                    }}
                    className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-xs cursor-pointer ${
                      accountFilter === accOpt.accountId
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: accOpt.theme.accentHex }}
                    />
                    <span className="truncate">{accOpt.accountName}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setAccountFilter('ALL');
                    setOpenColFilter(null);
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Reset kolom
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* Transaction Detail Modal */}
      {detailTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setDetailTxId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {tr('Detail Transaksi', 'Transaction Details')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'Rincian lengkap catatan transaksi terenkripsi',
                    'Complete details of the encrypted transaction record'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTxId(null)}
                aria-label={tr('Tutup detail transaksi', 'Close transaction details')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex items-center justify-between gap-4">
                <div>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                      detailTx.txType === 'income'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {detailTx.txType === 'income'
                      ? tr('Pemasukan', 'Income')
                      : tr('Pengeluaran', 'Expense')}
                  </span>
                  <p className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {detailTx.txType === 'income' ? '+' : '-'}
                    {formatMoney(detailTx.amount, detailTx.currency)}
                  </p>
                  {detailTx.currency !== displayCurrency && (
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      ≈{' '}
                      {formatMoney(
                        convertCurrency(detailTx.amount, detailTx.currency, displayCurrency, rateInput),
                        displayCurrency
                      )}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{tr('Tanggal', 'Date')}</p>
                  <p className="text-xs font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
                    {formatShortDate(detailTx.date)}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400">{detailTx.date}</p>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Merchant / Pihak', 'Merchant / Counterparty')}
                  </dt>
                  <dd className="font-semibold text-slate-900 dark:text-white mt-0.5 break-words">
                    {detailTx.merchant}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Kategori', 'Category')}
                  </dt>
                  <dd className="font-medium text-slate-900 dark:text-white mt-0.5 inline-flex items-center gap-2">
                    <CategoryBadgeIcon
                      categoryName={detailTx.category}
                      customCategories={customCategories}
                      txType={detailTx.txType}
                      size="xs"
                    />
                    <span>{detailTx.category}</span>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Keterangan', 'Description')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200 mt-0.5 break-words">
                    {detailTx.description || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Sumber Dana', 'Funding Source')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200 mt-0.5">
                    {detailAccount
                      ? `${detailAccount.name} (${formatAccountProviderLabel(detailAccount.provider)} · ${detailAccount.currency})`
                      : tr('Sumber Dana', 'Funding Source')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Referensi', 'Reference')}
                  </dt>
                  <dd className="font-mono text-slate-800 dark:text-slate-200 mt-0.5 break-all">
                    {detailTx.reference || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Dicatat Oleh', 'Recorded By')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200 mt-0.5">
                    {detailTx.createdByName ? (
                      <div className="space-y-0.5">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {detailTx.createdByName}
                        </p>
                        {detailTx.createdByEmail && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {detailTx.createdByEmail}
                          </p>
                        )}
                        {detailTx.createdAtIso && (
                          <p className="text-[11px] font-mono text-slate-400">
                            {formatRelativeTimestamp(detailTx.createdAtIso)}
                          </p>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {(detailTx.updatedByName || detailTx.updatedAtIso) && (
                  <div>
                    <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                      {tr('Diperbarui Oleh', 'Updated By')}
                    </dt>
                    <dd className="text-slate-800 dark:text-slate-200 mt-0.5">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {detailTx.updatedByName || '—'}
                      </p>
                      {detailTx.updatedByEmail && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {detailTx.updatedByEmail}
                        </p>
                      )}
                      {detailTx.updatedAtIso && (
                        <p className="text-[11px] font-mono text-slate-400">
                          {formatRelativeTimestamp(detailTx.updatedAtIso)}
                        </p>
                      )}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                    {tr('Catatan', 'Notes')}
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap break-words">
                    {detailTx.notes || '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-end gap-2.5">
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    const tx = detailTx;
                    setDetailTxId(null);
                    onEditTx(tx);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>{tr('Ubah Transaksi', 'Edit Transaction')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailTxId(null)}
                className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
              >
                {tr('Tutup', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {onCreateCategory &&
        onUpdateCategory &&
        onDeleteCategory &&
        onUpdateBuiltInCategory &&
        onDeleteBuiltInCategory && (
        <CategoryManagerModal
          isOpen={catManagerOpen}
          onClose={() => setCatManagerOpen(false)}
          customCategories={customCategories}
          transactions={transactions}
          expenseCategoryNames={expenseCategoryOptions}
          incomeCategoryNames={incomeCategoryOptions}
          onCreateCategory={onCreateCategory}
          onUpdateCategory={onUpdateCategory}
          onDeleteCategory={onDeleteCategory}
          onUpdateBuiltInCategory={onUpdateBuiltInCategory}
          onDeleteBuiltInCategory={onDeleteBuiltInCategory}
          onRenameUnlistedCategory={onRenameUnlistedCategory}
          onDeleteUnlistedCategory={onDeleteUnlistedCategory}
          onRestoreBuiltInCategories={onRestoreBuiltInCategories}
          onCategoryRenamed={(oldName, newName) => {
            if (
              categoryFilter !== 'ALL' &&
              normalizeCategoryKey(categoryFilter) === normalizeCategoryKey(oldName)
            ) {
              setCategoryFilter(newName);
            }
          }}
          onCategoryDeleted={(oldName, fallback) => {
            if (
              categoryFilter !== 'ALL' &&
              normalizeCategoryKey(categoryFilter) === normalizeCategoryKey(oldName)
            ) {
              setCategoryFilter(fallback);
            }
          }}
          onBuiltInCategoriesRestored={() => setCategoryFilter('ALL')}
        />
      )}
      <ExportFormatModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        recordCount={filtered.length}
        currencyLabel={displayCurrency}
        onExportPdf={handlePdfExport}
        onExportCsv={handleCsvExport}
      />
    </div>
  );
};
