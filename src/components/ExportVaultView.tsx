import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type {
  DisplayCurrency,
  ExchangeRatesInfo,
  FinancialAccount,
  FinancialTransaction,
  UserProfile,
  VaultShareRole,
} from '../types';
import { formatMoney, formatMonthLabel, formatRelativeTimestamp } from '../lib/formatters';
import { exportReportToPdf, exportTransactionsToCsv } from '../lib/exporters';
import { useLanguage, type AppLanguage } from '../lib/i18n';
import { ExportFormatModal } from './ExportFormatModal';

interface ExportVaultViewProps {
  profile: UserProfile;
  exchangeRates: ExchangeRatesInfo;
  refreshingRates?: boolean;
  onRefreshExchangeRates?: () => Promise<void>;
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  syncLogsCount?: number;
  onSavePreferences: (prefs: {
    preferredCurrency: DisplayCurrency;
    aedToIdrRate: number;
    displayName: string;
  }) => Promise<void>;
  onRotatePassphrase: (currentPass: string, newPass: string) => Promise<void>;
  onDeleteAllData: (options: {
    includeAccounts: boolean;
    includeCategories: boolean;
  }) => Promise<{ transactions: number; syncLogs: number; accounts: number; categories: number }>;
  onLockVault: () => void;
  isSharedVaultView?: boolean;
  activeVaultOwnerLabel?: string;
  activeVaultRole?: VaultShareRole;
  ownedSharesCount?: number;
  pendingIncomingCount?: number;
  onOpenSharingModal?: () => void;
}

export const ExportVaultView: React.FC<ExportVaultViewProps> = ({
  profile,
  exchangeRates,
  refreshingRates = false,
  onRefreshExchangeRates,
  accounts,
  transactions,
  syncLogsCount = 0,
  onSavePreferences,
  onRotatePassphrase,
  onDeleteAllData,
  onLockVault,
  isSharedVaultView = false,
  activeVaultOwnerLabel,
  activeVaultRole = 'editor',
  ownedSharesCount = 0,
  pendingIncomingCount = 0,
  onOpenSharingModal,
}) => {
  const { lang, setLang, tr } = useLanguage();
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [accountFilter, setAccountFilter] = useState('ALL');
  const [prefCurrency, setPrefCurrency] = useState<DisplayCurrency>(profile.preferredCurrency);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefSuccess, setPrefSuccess] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  useEffect(() => {
    setPrefCurrency(profile.preferredCurrency);
  }, [profile.preferredCurrency]);

  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmNewPass, setConfirmNewPass] = useState('');
  const [rotatingPass, setRotatingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [passSuccess, setPassSuccess] = useState<string | null>(null);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [deleteIncludeAccounts, setDeleteIncludeAccounts] = useState(true);
  const [deleteIncludeCategories, setDeleteIncludeCategories] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAllData, setDeletingAllData] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => set.add(t.monthKey));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [transactions]);

  const exportSubset = useMemo(
    () =>
      transactions.filter((tx) => {
        if (monthFilter !== 'ALL' && tx.monthKey !== monthFilter) return false;
        if (accountFilter !== 'ALL' && tx.accountId !== accountFilter) return false;
        return true;
      }),
    [transactions, monthFilter, accountFilter]
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefSuccess(null);
    setSavingPrefs(true);
    try {
      await onSavePreferences({
        preferredCurrency: prefCurrency,
        aedToIdrRate: exchangeRates.ratesToIdr.AED,
        displayName: displayName.trim() || profile.displayName,
      });
      setPrefSuccess(
        tr('Preferensi laporan berhasil disimpan.', 'Report preferences saved.')
      );
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleRotatePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);
    setPassSuccess(null);

    if (newPass.length < 8) {
      setPassError(
        tr('Frasa sandi baru minimal 8 karakter.', 'New passphrase must be at least 8 characters.')
      );
      return;
    }
    if (newPass !== confirmNewPass) {
      setPassError(
        tr('Konfirmasi frasa sandi baru tidak cocok.', 'New passphrase confirmation does not match.')
      );
      return;
    }

    setRotatingPass(true);
    try {
      await onRotatePassphrase(currentPass, newPass);
      setCurrentPass('');
      setNewPass('');
      setConfirmNewPass('');
      setPassSuccess(
        tr(
          'Frasa sandi brankas diperbarui. Seluruh sumber dana dan transaksi telah dienkripsi ulang.',
          'Vault passphrase updated. All funding sources and transactions have been re-encrypted.'
        )
      );
    } catch (err) {
      setPassError(
        err instanceof Error
          ? err.message
          : tr('Gagal memperbarui frasa sandi.', 'Failed to update passphrase.')
      );
    } finally {
      setRotatingPass(false);
    }
  };

  const handleConfirmDeleteAllData = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(null);
    setDeleteSuccess(null);

    if (deleteConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setDeleteError(
        tr(
          'Ketik kata HAPUS untuk mengonfirmasi penghapusan data permanen.',
          'Type HAPUS to confirm permanent data deletion.'
        )
      );
      return;
    }

    setDeletingAllData(true);
    try {
      const deleted = await onDeleteAllData({
        includeAccounts: deleteIncludeAccounts,
        includeCategories: deleteIncludeCategories,
      });
      setConfirmResetOpen(false);
      setDeleteConfirmText('');
      const parts = [
        `${deleted.transactions} ${tr('transaksi', 'transactions')}`,
        `${deleted.syncLogs} ${tr('riwayat impor', 'import logs')}`,
      ];
      if (deleteIncludeAccounts) {
        parts.push(`${deleted.accounts} ${tr('sumber dana', 'funding sources')}`);
      }
      if (deleteIncludeCategories) {
        parts.push(`${deleted.categories} ${tr('kategori kustom', 'custom categories')}`);
      }
      setDeleteSuccess(
        tr(
          `Berhasil menghapus ${parts.join(', ')} dari brankas.`,
          `Successfully deleted ${parts.join(', ')} from the vault.`
        )
      );
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : tr('Gagal menghapus data dari brankas.', 'Failed to delete vault data.')
      );
    } finally {
      setDeletingAllData(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner: Family & Multi-Account Sharing */}
      {onOpenSharingModal && (
        <section className="rounded-2xl border border-teal-200 dark:border-emerald-900/70 bg-gradient-to-r from-teal-50/90 via-white to-white dark:from-emerald-950/35 dark:via-slate-900 dark:to-slate-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-emerald-100/80 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {tr('Berbagi Data Keluarga & Multi-Akun', 'Family Sharing & Multi-Account')}
                </h2>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full border border-emerald-300/80 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/70 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 tabular-nums">
                  {isSharedVaultView
                    ? activeVaultRole === 'editor'
                      ? 'Editor'
                      : 'Viewer'
                    : tr(
                        `${ownedSharesCount} Akun Terhubung`,
                        `${ownedSharesCount} Connected Accounts`
                      )}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                {isSharedVaultView
                  ? tr(
                      `Anda sedang membuka Brankas Bersama milik ${activeVaultOwnerLabel || 'Pasangan'} (${activeVaultRole === 'editor' ? 'Editor · Lihat & Catat' : 'Viewer · Hanya Lihat'}).`,
                      `You are viewing a Shared Vault owned by ${activeVaultOwnerLabel || 'Partner'} (${activeVaultRole === 'editor' ? 'Editor · View & Record' : 'Viewer · Read-Only'}).`
                    )
                  : ownedSharesCount > 0
                    ? tr(
                        `${ownedSharesCount} anggota keluarga/pasangan terhubung ke brankas pribadi Anda.`,
                        `${ownedSharesCount} family member(s)/partner(s) connected to your personal vault.`
                      )
                    : tr(
                        'Undang akun Google pasangan (suami/istri) agar dapat melihat dan mencatat transaksi di dashboard yang sama.',
                        'Invite your partner’s Google account to view and record transactions in the same dashboard.'
                      )}
              </p>
              {pendingIncomingCount > 0 && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {tr(
                    `Ada ${pendingIncomingCount} undangan brankas masuk menunggu konfirmasi Anda.`,
                    `${pendingIncomingCount} incoming vault invitation(s) waiting for your confirmation.`
                  )}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSharingModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white dark:text-slate-950 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{tr('Kelola Berbagi Brankas', 'Manage Vault Sharing')}</span>
          </button>
        </section>
      )}

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Export Center & App Preferences */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-900/70 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            </div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {tr('Ekspor Laporan Keuangan (CSV & PDF)', 'Export Financial Report (CSV & PDF)')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {tr('Periode Laporan', 'Report Period')}
              </label>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">{tr('Semua Periode', 'All Periods')}</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {tr('Filter Sumber Dana', 'Filter Funding Source')}
              </label>
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="ALL">{tr('Semua Sumber Dana', 'All Funding Sources')}</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.currency})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span>
              {tr('Total entri siap diekspor:', 'Entries ready to export:')}{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                {exportSubset.length}
              </span>{' '}
              {tr('transaksi', 'transactions')}
            </span>
            <span className="font-mono font-semibold text-teal-700 dark:text-teal-400">
              {profile.preferredCurrency}
            </span>
          </div>

          <button
            type="button"
            disabled={exportSubset.length === 0}
            onClick={() => setExportModalOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white dark:text-slate-950 text-sm font-semibold disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>{tr('Ekspor Laporan', 'Export Report')}</span>
          </button>

          <form
            onSubmit={handleSavePrefs}
            className="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-4"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                {tr('Preferensi Aplikasi & Kurs Konversi', 'App Preferences & Exchange Rates')}
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  {tr('Nama Pemilik', 'Owner Name')}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  {tr('Mata Uang Utama', 'Primary Currency')}
                </label>
                <select
                  value={prefCurrency}
                  onChange={(e) => setPrefCurrency(e.target.value as DisplayCurrency)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value="AED">AED</option>
                  <option value="IDR">IDR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  {tr('Bahasa Aplikasi', 'App Language')}
                </label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as AppLanguage)}
                  aria-label={tr('Pilih bahasa aplikasi', 'Select app language')}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  <option value="id">Bahasa Indonesia</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {tr('Kurs Konversi Otomatis (Terkini)', 'Live Automatic Exchange Rates')}
                </p>
                {onRefreshExchangeRates && (
                  <button
                    type="button"
                    disabled={refreshingRates}
                    onClick={() => void onRefreshExchangeRates()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshingRates ? 'animate-spin' : ''}`} />
                    <span>
                      {refreshingRates
                        ? tr('Memuat...', 'Loading...')
                        : tr('Perbarui', 'Refresh')}
                    </span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['AED', 'USD', 'SGD', 'EUR'] as const).map((code) => (
                  <div
                    key={code}
                    className="px-2.5 py-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900"
                  >
                    <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      1 {code}
                    </p>
                    <p className="text-xs font-mono font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">
                      {formatMoney(exchangeRates.ratesToIdr[code], 'IDR')}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {tr('Sumber:', 'Source:')} {exchangeRates.source} ·{' '}
                {tr('Terakhir diperbarui:', 'Last updated:')}{' '}
                {formatRelativeTimestamp(exchangeRates.updatedAtIso)}
              </p>
            </div>

            {prefSuccess && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{prefSuccess}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={savingPrefs}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {savingPrefs
                ? tr('Menyimpan...', 'Saving...')
                : tr('Simpan Preferensi', 'Save Preferences')}
            </button>
          </form>
        </section>

        {/* Right: Vault Encryption & Passphrase Rotation */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-900/70 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  {tr('Brankas Enkripsi Ujung-ke-Ujung', 'End-to-End Encrypted Vault')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'AES-GCM 256-bit · PBKDF2-SHA256 (310.000 iterasi) · Kunci hanya ada di memori sesi',
                    'AES-GCM 256-bit · PBKDF2-SHA256 (310,000 iterations) · Key stays in session memory'
                  )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onLockVault}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{tr('Kunci Brankas', 'Lock Vault')}</span>
            </button>
          </div>

          {isSharedVaultView ? (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {tr(
                `Penggantian frasa sandi enkripsi hanya dapat dilakukan oleh pemilik asli brankas (${activeVaultOwnerLabel || 'Pemilik'}).`,
                `Vault passphrase rotation can only be performed by the vault owner (${activeVaultOwnerLabel || 'Owner'}).`
              )}
            </div>
          ) : (
            <form onSubmit={handleRotatePassphrase} className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <KeyRound className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>
                  {tr(
                    'Ganti Frasa Sandi & Enkripsi Ulang Semua Data',
                    'Change Passphrase & Re-Encrypt All Data'
                  )}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {tr('Frasa Sandi Saat Ini', 'Current Passphrase')}
                </label>
                <input
                  type="password"
                  value={currentPass}
                  onChange={(e) => setCurrentPass(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Frasa Sandi Baru', 'New Passphrase')}
                  </label>
                  <input
                    type="password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder={tr('Minimal 8 karakter', 'Minimum 8 characters')}
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Konfirmasi Frasa Sandi Baru', 'Confirm New Passphrase')}
                  </label>
                  <input
                    type="password"
                    value={confirmNewPass}
                    onChange={(e) => setConfirmNewPass(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              {passError && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                  {passError}
                </div>
              )}

              {passSuccess && (
                <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{passSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={rotatingPass}
                className="px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {rotatingPass
                  ? tr('Mengenkripsi Ulang Data...', 'Re-encrypting Data...')
                  : tr('Perbarui Frasa Sandi Brankas', 'Update Vault Passphrase')}
              </button>
            </form>
          )}
        </section>
      </div>

      {/* Delete All Uploaded Data / Reset Vault Data */}
      {!isSharedVaultView && (
        <section className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/60 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {tr('Hapus Semua Data Tersimpan', 'Delete All Saved Data')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'Bersihkan transaksi hasil impor/upload, riwayat impor, maupun seluruh daftar sumber dana dari akun Anda.',
                    'Clear imported/uploaded transactions, import history, or all funding sources from your account.'
                  )}
                </p>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                  {tr('Data saat ini:', 'Current data:')} {transactions.length}{' '}
                  {tr('transaksi', 'transactions')} · {accounts.length}{' '}
                  {tr('sumber dana', 'funding sources')} · {syncLogsCount}{' '}
                  {tr('riwayat impor', 'import logs')}
                </p>
              </div>
            </div>

            {!confirmResetOpen && (
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteSuccess(null);
                  setDeleteConfirmText('');
                  setConfirmResetOpen(true);
                }}
                disabled={transactions.length === 0 && accounts.length === 0 && syncLogsCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{tr('Hapus Semua Data...', 'Delete All Data...')}</span>
              </button>
            )}
          </div>

          {deleteSuccess && (
            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{deleteSuccess}</span>
            </div>
          )}

          {confirmResetOpen && (
            <form
              onSubmit={handleConfirmDeleteAllData}
              className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 space-y-3.5"
            >
              <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-semibold text-red-800 dark:text-red-300">
                  {tr(
                    'Pilih cakupan data yang ingin dihapus permanen:',
                    'Select data scope to permanently delete:'
                  )}
                </p>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <input type="checkbox" checked disabled className="rounded border-slate-300 text-red-600" />
                  <span>
                    {tr(
                      `Seluruh transaksi (${transactions.length}) & riwayat impor (${syncLogsCount})`,
                      `All transactions (${transactions.length}) & import logs (${syncLogsCount})`
                    )}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteIncludeAccounts}
                    onChange={(e) => setDeleteIncludeAccounts(e.target.checked)}
                    className="rounded border-slate-300 text-red-600"
                  />
                  <span>
                    {tr(
                      `Sekaligus hapus seluruh sumber dana (${accounts.length})`,
                      `Also delete all funding sources (${accounts.length})`
                    )}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteIncludeCategories}
                    onChange={(e) => setDeleteIncludeCategories(e.target.checked)}
                    className="rounded border-slate-300 text-red-600"
                  />
                  <span>
                    {tr(
                      'Sekaligus reset kategori kustom & ubahan nama kategori',
                      'Also reset custom categories & renamed categories'
                    )}
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {tr('Ketik', 'Type')}{' '}
                  <span className="font-mono font-bold text-red-700 dark:text-red-400">HAPUS</span>{' '}
                  {tr('untuk konfirmasi:', 'to confirm:')}
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="HAPUS"
                  required
                  className="w-full sm:max-w-xs px-3 py-2 text-xs font-mono rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              {deleteError && (
                <div className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={deletingAllData || deleteConfirmText.trim().toUpperCase() !== 'HAPUS'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {deletingAllData
                      ? tr('Menghapus...', 'Deleting...')
                      : tr('Konfirmasi Hapus Permanen', 'Confirm Permanent Delete')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmResetOpen(false);
                    setDeleteConfirmText('');
                    setDeleteError(null);
                  }}
                  disabled={deletingAllData}
                  className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <ExportFormatModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        recordCount={exportSubset.length}
        currencyLabel={profile.preferredCurrency}
        onExportPdf={() =>
          exportReportToPdf({
            transactions: exportSubset,
            accounts,
            monthFilter,
            displayCurrency: profile.preferredCurrency,
            aedToIdrRate: exchangeRates.ratesToIdr.AED,
            fxRates: exchangeRates.ratesToIdr,
            userName: profile.displayName,
            fileName: `my-expenses-laporan-${monthFilter === 'ALL' ? 'semua' : monthFilter}.pdf`,
            lang,
          })
        }
        onExportCsv={() =>
          exportTransactionsToCsv(
            exportSubset,
            accounts,
            `my-expenses-mutasi-${monthFilter === 'ALL' ? 'semua' : monthFilter}.csv`
          )
        }
      />
    </div>
  );
};
