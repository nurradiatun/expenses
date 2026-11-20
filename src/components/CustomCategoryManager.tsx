import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  getPureCustomCategories,
  getResolvedBuiltInCategories,
  getUnlistedTransactionCategories,
  normalizeCategoryKey,
  type CustomCategory,
  type FinancialTransaction,
  type ResolvedBuiltInCategory,
  type TransactionType,
} from '../types';
import {
  CATEGORY_COLOR_PALETTE,
  CATEGORY_ICON_OPTIONS,
  CategoryBadgeIcon,
  getCategoryIconComponent,
  getDefaultCategoryAppearance,
  resolveCategoryAppearance,
  type CategoryAppearance,
} from '../lib/categoryVisuals';
import { useLanguage } from '../lib/i18n';

export interface CustomCategoryManagerProps {
  customCategories: CustomCategory[];
  transactions: FinancialTransaction[];
  expenseCategoryNames: string[];
  incomeCategoryNames: string[];
  onCreateCategory: (
    name: string,
    categoryType: TransactionType,
    appearance?: CategoryAppearance
  ) => Promise<string>;
  onUpdateCategory: (
    category: CustomCategory,
    newName: string,
    appearance?: CategoryAppearance
  ) => Promise<number>;
  onDeleteCategory: (category: CustomCategory, fallbackCategory: string) => Promise<number>;
  onUpdateBuiltInCategory: (
    item: ResolvedBuiltInCategory,
    newName: string,
    appearance?: CategoryAppearance
  ) => Promise<number>;
  onDeleteBuiltInCategory: (
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
  onCategoryRenamed?: (oldName: string, newName: string) => void;
  onCategoryDeleted?: (oldName: string, fallbackCategory: string) => void;
  onBuiltInCategoriesRestored?: () => void;
  compact?: boolean;
}

interface VisualPickerPanelProps {
  selectedIcon: string;
  selectedColor: string;
  onSelectIcon: (iconKey: string) => void;
  onSelectColor: (hex: string) => void;
  previewLabel?: string;
}

export const CategoryVisualPicker: React.FC<VisualPickerPanelProps> = ({
  selectedIcon,
  selectedColor,
  onSelectIcon,
  onSelectColor,
  previewLabel,
}) => {
  return (
    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-950/70 space-y-3">
      {previewLabel && (
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <CategoryBadgeIcon
              categoryName={previewLabel}
              iconOverride={selectedIcon}
              colorOverride={selectedColor}
              size="sm"
            />
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
              {previewLabel}
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase">
            {selectedColor}
          </span>
        </div>
      )}

      <div>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
          Pilih Warna
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_COLOR_PALETTE.map((swatch) => {
            const active = swatch.hex.toLowerCase() === selectedColor.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => onSelectColor(swatch.hex)}
                title={swatch.label}
                aria-label={`Pilih warna ${swatch.label}`}
                aria-pressed={active}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                  active
                    ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900 scale-110'
                    : 'hover:scale-105 opacity-90 hover:opacity-100'
                }`}
                style={{ backgroundColor: swatch.hex }}
              >
                {active && <Check className="w-3 h-3 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
          Pilih Ikon
        </p>
        <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
          {CATEGORY_ICON_OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            const active = opt.key === selectedIcon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onSelectIcon(opt.key)}
                title={opt.label}
                aria-label={`Pilih ikon ${opt.label}`}
                aria-pressed={active}
                className={`h-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                  active
                    ? 'border-slate-900 dark:border-white bg-white dark:bg-slate-900 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600'
                }`}
                style={active ? { color: selectedColor, borderColor: selectedColor } : undefined}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const CustomCategoryManager: React.FC<CustomCategoryManagerProps> = ({
  customCategories,
  transactions,
  expenseCategoryNames,
  incomeCategoryNames,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onUpdateBuiltInCategory,
  onDeleteBuiltInCategory,
  onRenameUnlistedCategory,
  onDeleteUnlistedCategory,
  onRestoreBuiltInCategories,
  onCategoryRenamed,
  onCategoryDeleted,
  onBuiltInCategoriesRestored,
  compact = false,
}) => {
  const [activeType, setActiveType] = useState<TransactionType>('expense');

  const activeAllNames = activeType === 'income' ? incomeCategoryNames : expenseCategoryNames;

  const pureCustomCategories = useMemo(
    () => getPureCustomCategories(customCategories, activeType),
    [customCategories, activeType]
  );
  const { active: activeBuiltIns, hasOverrides } = useMemo(
    () => getResolvedBuiltInCategories(customCategories, activeType),
    [customCategories, activeType]
  );
  const { hasOverrides: hasAnyOverrides } = useMemo(
    () => getResolvedBuiltInCategories(customCategories),
    [customCategories]
  );
  const unlistedCategories = useMemo(
    () => getUnlistedTransactionCategories(customCategories, transactions, activeType),
    [customCategories, transactions, activeType]
  );
  const registeredCategoryNames = useMemo(
    () => [...activeBuiltIns.map((b) => b.name), ...pureCustomCategories.map((c) => c.name)],
    [activeBuiltIns, pureCustomCategories]
  );

  // Create form state
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [newIcon, setNewIcon] = useState<string>('Tag');
  const [newColor, setNewColor] = useState<string>('#0F766E');
  const [showCreatePicker, setShowCreatePicker] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit row state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingIcon, setEditingIcon] = useState('Tag');
  const [editingColor, setEditingColor] = useState('#0F766E');
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [fallbackTarget, setFallbackTarget] = useState<string>('Lainnya');
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const txCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.txType !== activeType) continue;
      const key = normalizeCategoryKey(tx.category);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [transactions, activeType]);

  const switchTab = (nextType: TransactionType) => {
    setActiveType(nextType);
    setEditingKey(null);
    setConfirmDeleteKey(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    setNewIcon(nextType === 'income' ? 'Coins' : 'Tag');
    setNewColor(nextType === 'income' ? '#059669' : '#0F766E');
  };

  const pickDefaultFallback = (excludingName: string): string => {
    const exKey = normalizeCategoryKey(excludingName);
    const remaining = activeAllNames.filter((n) => normalizeCategoryKey(n) !== exKey);
    if (activeType === 'income') {
      const preferred =
        remaining.find((n) => normalizeCategoryKey(n) === 'pemasukan lainnya') ||
        remaining.find((n) => normalizeCategoryKey(n) === 'pemasukan');
      return preferred || remaining[0] || 'Pemasukan';
    }
    const lainnya = remaining.find((n) => normalizeCategoryKey(n) === 'lainnya');
    return lainnya || remaining[0] || 'Lainnya';
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = newCategoryInput.trim();
    if (!trimmed) {
      setErrorMsg('Nama kategori baru tidak boleh kosong.');
      return;
    }
    setCreating(true);
    try {
      const saved = await onCreateCategory(trimmed, activeType, {
        icon: newIcon,
        color: newColor,
      });
      setNewCategoryInput('');
      setShowCreatePicker(false);
      setNewIcon(activeType === 'income' ? 'Coins' : 'Tag');
      setNewColor(activeType === 'income' ? '#059669' : '#0F766E');
      setSuccessMsg(
        `Kategori ${activeType === 'income' ? 'pemasukan' : 'pengeluaran'} "${saved}" berhasil ditambahkan.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menambah kategori.');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (
    key: string,
    currentName: string,
    initialAppearance?: CategoryAppearance
  ) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setConfirmDeleteKey(null);
    setEditingKey(key);
    setEditingName(currentName);

    const resolved = resolveCategoryAppearance(currentName, customCategories, activeType);
    const fallback = getDefaultCategoryAppearance(currentName, activeType);
    setEditingIcon(initialAppearance?.icon || resolved.iconKey || fallback.iconKey);
    setEditingColor(initialAppearance?.color || resolved.color || fallback.color);
  };

  const validateEditName = (oldName: string, allowMergeIntoRegistered = false): string | null => {
    const trimmed = editingName.trim().replace(/\s+/g, ' ').slice(0, 50);
    if (!trimmed) {
      setErrorMsg('Nama kategori tidak boleh kosong.');
      return null;
    }
    if (!allowMergeIntoRegistered && trimmed !== oldName) {
      const conflict = registeredCategoryNames.find(
        (existing) =>
          normalizeCategoryKey(existing) === normalizeCategoryKey(trimmed) &&
          normalizeCategoryKey(existing) !== normalizeCategoryKey(oldName)
      );
      if (conflict) {
        setErrorMsg(`Kategori "${conflict}" sudah ada pada daftar ini.`);
        return null;
      }
    }
    return trimmed;
  };

  const handleSaveCustomEdit = async (e: React.FormEvent, cat: CustomCategory) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = validateEditName(cat.name);
    if (!trimmed) return;

    const currentResolved = resolveCategoryAppearance(cat.name, customCategories, activeType);
    const unchangedName = trimmed === cat.name;
    const unchangedVisual =
      editingIcon === (cat.icon || currentResolved.iconKey) &&
      editingColor.toLowerCase() === (cat.color || currentResolved.color).toLowerCase();

    if (unchangedName && unchangedVisual) {
      setEditingKey(null);
      return;
    }

    setSavingEdit(true);
    try {
      const updatedTxCount = await onUpdateCategory(cat, trimmed, {
        icon: editingIcon,
        color: editingColor,
      });
      if (!unchangedName) {
        onCategoryRenamed?.(cat.name, trimmed);
      }
      setEditingKey(null);
      setSuccessMsg(
        updatedTxCount > 0
          ? `Kategori diperbarui ke "${trimmed}" dan ${updatedTxCount} transaksi ikut disesuaikan.`
          : unchangedName
            ? `Ikon & warna kategori "${trimmed}" berhasil diperbarui.`
            : `Kategori berhasil diperbarui menjadi "${trimmed}".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui kategori.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveBuiltInEdit = async (e: React.FormEvent, item: ResolvedBuiltInCategory) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = validateEditName(item.name);
    if (!trimmed) return;

    const defaults = getDefaultCategoryAppearance(item.systemKey, activeType);
    const currentIcon = item.icon || defaults.iconKey;
    const currentColor = item.color || defaults.color;
    const unchangedName = trimmed === item.name;
    const unchangedVisual =
      editingIcon === currentIcon &&
      editingColor.toLowerCase() === currentColor.toLowerCase();

    if (unchangedName && unchangedVisual) {
      setEditingKey(null);
      return;
    }

    setSavingEdit(true);
    try {
      const updatedTxCount = await onUpdateBuiltInCategory(item, trimmed, {
        icon: editingIcon,
        color: editingColor,
      });
      if (!unchangedName) {
        onCategoryRenamed?.(item.name, trimmed);
      }
      setEditingKey(null);
      setSuccessMsg(
        updatedTxCount > 0
          ? `Kategori diperbarui ke "${trimmed}" dan ${updatedTxCount} transaksi ikut disesuaikan.`
          : unchangedName
            ? `Ikon & warna kategori "${trimmed}" berhasil diperbarui.`
            : `Kategori berhasil diperbarui menjadi "${trimmed}".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui kategori.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveUnlistedEdit = async (e: React.FormEvent, oldName: string) => {
    e.preventDefault();
    if (!onRenameUnlistedCategory) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmed = validateEditName(oldName, true);
    if (!trimmed) return;

    setSavingEdit(true);
    try {
      const updatedTxCount = await onRenameUnlistedCategory(oldName, trimmed, activeType, {
        icon: editingIcon,
        color: editingColor,
      });
      if (trimmed !== oldName) {
        onCategoryRenamed?.(oldName, trimmed);
      }
      setEditingKey(null);
      setSuccessMsg(
        updatedTxCount > 0
          ? `Kategori "${oldName}" diperbarui ke "${trimmed}" dan ${updatedTxCount} transaksi disesuaikan.`
          : `Kategori "${trimmed}" disimpan ke daftar kategori Anda.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui kategori.');
    } finally {
      setSavingEdit(false);
    }
  };

  const startDeleteConfirm = (key: string, currentName: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setEditingKey(null);
    setConfirmDeleteKey(key);
    setFallbackTarget(pickDefaultFallback(currentName));
  };

  const handleConfirmDeleteCustom = async (cat: CustomCategory, key: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeletingKey(key);
    try {
      const reassignedCount = await onDeleteCategory(cat, fallbackTarget);
      onCategoryDeleted?.(cat.name, fallbackTarget);
      setConfirmDeleteKey(null);
      setSuccessMsg(
        reassignedCount > 0
          ? `Kategori "${cat.name}" dihapus dan ${reassignedCount} transaksi dipindahkan ke "${fallbackTarget}".`
          : `Kategori "${cat.name}" berhasil dihapus.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus kategori.');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleConfirmDeleteBuiltIn = async (item: ResolvedBuiltInCategory, key: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeletingKey(key);
    try {
      const reassignedCount = await onDeleteBuiltInCategory(item, fallbackTarget);
      onCategoryDeleted?.(item.name, fallbackTarget);
      setConfirmDeleteKey(null);
      setSuccessMsg(
        reassignedCount > 0
          ? `Kategori "${item.name}" dihapus dan ${reassignedCount} transaksi dipindahkan ke "${fallbackTarget}".`
          : `Kategori "${item.name}" berhasil dihapus dari daftar aktif.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus kategori.');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleConfirmDeleteUnlisted = async (name: string, key: string) => {
    if (!onDeleteUnlistedCategory) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setDeletingKey(key);
    try {
      const reassignedCount = await onDeleteUnlistedCategory(name, fallbackTarget, activeType);
      onCategoryDeleted?.(name, fallbackTarget);
      setConfirmDeleteKey(null);
      setSuccessMsg(
        reassignedCount > 0
          ? `Kategori "${name}" dihapus dan ${reassignedCount} transaksi dipindahkan ke "${fallbackTarget}".`
          : `Kategori "${name}" berhasil dihapus.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus kategori.');
    } finally {
      setDeletingKey(null);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!onRestoreBuiltInCategories) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setRestoring(true);
    try {
      const revertedCount = await onRestoreBuiltInCategories();
      onBuiltInCategoriesRestored?.();
      setEditingKey(null);
      setConfirmDeleteKey(null);
      setSuccessMsg(
        typeof revertedCount === 'number' && revertedCount > 0
          ? `Daftar kategori bawaan dipulihkan dan ${revertedCount} transaksi disesuaikan.`
          : 'Daftar kategori bawaan sistem berhasil dipulihkan ke pengaturan awal.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memulihkan kategori bawaan.');
    } finally {
      setRestoring(false);
    }
  };

  const renderCategoryRow = (params: {
    rowKey: string;
    name: string;
    appearance?: CategoryAppearance;
    usedCount: number;
    isModified?: boolean;
    onSubmitEdit: (e: React.FormEvent) => void;
    onConfirmDelete: () => void;
  }) => {
    const { rowKey, name, appearance, usedCount, isModified, onSubmitEdit, onConfirmDelete } = params;
    const isEditing = editingKey === rowKey;
    const isConfirmingDelete = confirmDeleteKey === rowKey;
    const isBusyDeleting = deletingKey === rowKey;
    const fallbackChoices = activeAllNames.filter(
      (n) => normalizeCategoryKey(n) !== normalizeCategoryKey(name)
    );

    const resolved = resolveCategoryAppearance(name, customCategories, activeType);
    const displayIcon = appearance?.icon || resolved.iconKey;
    const displayColor = appearance?.color || resolved.color;

    return (
      <div key={rowKey} className="px-3.5 py-2.5 text-xs space-y-2.5">
        {isEditing ? (
          <form onSubmit={onSubmitEdit} className="space-y-3">
            <div className="flex items-center gap-2">
              <CategoryBadgeIcon
                categoryName={editingName || name}
                iconOverride={editingIcon}
                colorOverride={editingColor}
                size="md"
              />
              <input
                type="text"
                maxLength={50}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                autoFocus
                className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-teal-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="submit"
                disabled={savingEdit || !editingName.trim()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{savingEdit ? 'Menyimpan...' : 'Simpan'}</span>
              </button>
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
            </div>

            <CategoryVisualPicker
              selectedIcon={editingIcon}
              selectedColor={editingColor}
              onSelectIcon={setEditingIcon}
              onSelectColor={setEditingColor}
            />

            {usedCount > 0 && editingName.trim() !== name && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {usedCount} transaksi dengan kategori ini akan otomatis ikut diperbarui.
              </p>
            )}
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <CategoryBadgeIcon
                categoryName={name}
                iconOverride={displayIcon}
                colorOverride={displayColor}
                size="sm"
              />
              <span className="font-medium text-slate-900 dark:text-white truncate">{name}</span>
              {isModified && (
                <span className="text-[10px] text-teal-700 dark:text-teal-400 shrink-0">
                  · Diubah
                </span>
              )}
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                {usedCount} transaksi
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  startEdit(rowKey, name, {
                    icon: displayIcon,
                    color: displayColor,
                  })
                }
                aria-label={`Edit kategori ${name}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => startDeleteConfirm(rowKey, name)}
                aria-label={`Hapus kategori ${name}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Hapus</span>
              </button>
            </div>
          </div>
        )}

        {isConfirmingDelete && (
          <div className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 space-y-2">
            <p className="text-[11px] font-medium text-red-800 dark:text-red-200">
              {usedCount > 0
                ? `Kategori "${name}" dipakai oleh ${usedCount} transaksi. Pindahkan transaksi tersebut ke:`
                : `Hapus kategori "${name}"?`}
            </p>
            {usedCount > 0 && fallbackChoices.length > 0 && (
              <select
                value={fallbackTarget}
                onChange={(e) => setFallbackTarget(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                {fallbackChoices.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isBusyDeleting}
                onClick={() => setConfirmDeleteKey(null)}
                className="px-2.5 py-1 rounded text-[11px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isBusyDeleting}
                onClick={onConfirmDelete}
                className="px-3 py-1 rounded text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
              >
                {isBusyDeleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const typeLabel = activeType === 'income' ? 'Pemasukan' : 'Pengeluaran';
  const NewPreviewIcon = getCategoryIconComponent(newIcon);

  return (
    <div className="space-y-4">
      {/* Segmented Switch: Expense vs Income Categories */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => switchTab('expense')}
          className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeType === 'expense'
              ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Kategori Pengeluaran ({expenseCategoryNames.length})
        </button>
        <button
          type="button"
          onClick={() => switchTab('income')}
          className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            activeType === 'income'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Kategori Pemasukan ({incomeCategoryNames.length})
        </button>
      </div>

      {/* Create Form + Visual Icon/Color Picker */}
      <form onSubmit={handleCreateSubmit} className="space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => setShowCreatePicker((v) => !v)}
              title="Pilih ikon & warna kategori"
              aria-label="Pilih ikon dan warna kategori baru"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer shrink-0"
            >
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center"
                style={{ color: newColor }}
              >
                <NewPreviewIcon className="w-4 h-4" />
              </span>
              <Palette className="w-3.5 h-3.5 text-slate-400" />
            </button>
            <input
              type="text"
              maxLength={50}
              value={newCategoryInput}
              onChange={(e) => setNewCategoryInput(e.target.value)}
              placeholder={
                activeType === 'income'
                  ? 'Tambah kategori pemasukan (contoh: Dividen, Sewa Properti)'
                  : 'Tambah kategori pengeluaran (contoh: Pendidikan Anak, Zakat, Hobi)'
              }
              className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newCategoryInput.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{creating ? 'Menyimpan...' : `Tambah (${typeLabel})`}</span>
          </button>
        </div>

        {showCreatePicker && (
          <CategoryVisualPicker
            selectedIcon={newIcon}
            selectedColor={newColor}
            onSelectIcon={setNewIcon}
            onSelectColor={setNewColor}
            previewLabel={newCategoryInput.trim() || `Pratinjau Kategori ${typeLabel}`}
          />
        )}
      </form>

      {errorMsg && (
        <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className={`grid grid-cols-1 ${compact ? '' : 'lg:grid-cols-2'} gap-5 pt-1`}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Kategori Kustom {typeLabel} ({pureCustomCategories.length})
            </h3>
          </div>

          {pureCustomCategories.length === 0 ? (
            <div className="p-4 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              Belum ada kategori kustom {typeLabel.toLowerCase()}. Tambahkan di atas atau edit ikon & warna kategori bawaan di bawah.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
              {pureCustomCategories.map((cat) => {
                const rowKey = `custom:${cat.id}`;
                const usedCount = txCountByCategory.get(normalizeCategoryKey(cat.name)) || 0;
                return renderCategoryRow({
                  rowKey,
                  name: cat.name,
                  appearance: { icon: cat.icon, color: cat.color },
                  usedCount,
                  onSubmitEdit: (e) => void handleSaveCustomEdit(e, cat),
                  onConfirmDelete: () => void handleConfirmDeleteCustom(cat, rowKey),
                });
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Kategori Bawaan {typeLabel} ({activeBuiltIns.length})
            </h3>
            {(hasOverrides || hasAnyOverrides) && onRestoreBuiltInCategories && (
              <button
                type="button"
                disabled={restoring}
                onClick={() => void handleRestoreDefaults()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{restoring ? 'Memulihkan...' : 'Pulihkan Bawaan'}</span>
              </button>
            )}
          </div>

          {activeBuiltIns.length === 0 ? (
            <div className="p-4 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              Semua kategori bawaan {typeLabel.toLowerCase()} telah dihapus. Klik "Pulihkan Bawaan" jika ingin mengembalikannya.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
              {activeBuiltIns.map((item) => {
                const rowKey = `builtin:${item.systemKey}`;
                const usedCount = txCountByCategory.get(normalizeCategoryKey(item.name)) || 0;
                const defaults = getDefaultCategoryAppearance(item.systemKey, activeType);
                return renderCategoryRow({
                  rowKey,
                  name: item.name,
                  appearance: {
                    icon: item.icon || defaults.iconKey,
                    color: item.color || defaults.color,
                  },
                  usedCount,
                  isModified: item.isModified,
                  onSubmitEdit: (e) => void handleSaveBuiltInEdit(e, item),
                  onConfirmDelete: () => void handleConfirmDeleteBuiltIn(item, rowKey),
                });
              })}
            </div>
          )}
        </div>

        {unlistedCategories.length > 0 && onRenameUnlistedCategory && onDeleteUnlistedCategory && (
          <div className={compact ? '' : 'lg:col-span-2'}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Kategori dari Riwayat {typeLabel} ({unlistedCategories.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
              {unlistedCategories.map((catName) => {
                const rowKey = `unlisted:${activeType}:${normalizeCategoryKey(catName)}`;
                const usedCount = txCountByCategory.get(normalizeCategoryKey(catName)) || 0;
                return renderCategoryRow({
                  rowKey,
                  name: catName,
                  usedCount,
                  onSubmitEdit: (e) => void handleSaveUnlistedEdit(e, catName),
                  onConfirmDelete: () => void handleConfirmDeleteUnlisted(catName, rowKey),
                });
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface CategoryManagerModalProps extends CustomCategoryManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({
  isOpen,
  onClose,
  ...managerProps
}) => {
  const { tr } = useLanguage();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <Tag className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {tr('Setting Kategori', 'Category Settings')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup setting kategori', 'Close category settings')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <CustomCategoryManager {...managerProps} compact />
        </div>
      </div>
    </div>
  );
};
