import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import {
  formatAccountProviderLabel,
  type AccountProvider,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
} from '../types';
import { formatMoney } from '../lib/formatters';
import { useLanguage } from '../lib/i18n';

interface AdcbAccountsViewProps {
  accounts: FinancialAccount[];
  transactions?: FinancialTransaction[];
  onUpdateAccount: (
    account: FinancialAccount,
    params: {
      name: string;
      institution: string;
      provider: AccountProvider;
      currency: SupportedCurrency;
      accountNumberMasked: string;
      balance: number;
      notes: string;
    }
  ) => Promise<number>;
  onCreateManualAccount: (params: {
    name: string;
    institution: string;
    provider: AccountProvider;
    currency: SupportedCurrency;
    accountNumberMasked: string;
    balance: number;
    notes?: string;
  }) => Promise<void>;
  onDeleteAccount: (accountId: string) => Promise<void>;
  readOnly?: boolean;
}

export const AdcbAccountsView: React.FC<AdcbAccountsViewProps> = ({
  accounts,
  transactions = [],
  onUpdateAccount,
  onCreateManualAccount,
  onDeleteAccount,
  readOnly = false,
}) => {
  const { tr } = useLanguage();

  // Add Sumber Dana modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [manName, setManName] = useState('');
  const [manInstitution, setManInstitution] = useState('ADCB Bank');
  const [manProvider, setManProvider] = useState<AccountProvider>('ADCB');
  const [manCurrency, setManCurrency] = useState<SupportedCurrency>('AED');
  const [manMasked, setManMasked] = useState('');
  const [manBalance, setManBalance] = useState('');
  const [manNotes, setManNotes] = useState('');
  const [creatingManual, setCreatingManual] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Inline full funding source edit state
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [balanceMode, setBalanceMode] = useState<'direct' | 'from_opening'>('direct');
  const [balanceInput, setBalanceInput] = useState('');
  const [editNameInput, setEditNameInput] = useState('');
  const [editInstitutionInput, setEditInstitutionInput] = useState('');
  const [editProviderInput, setEditProviderInput] = useState<AccountProvider>('ADCB');
  const [editCurrencyInput, setEditCurrencyInput] = useState<SupportedCurrency>('AED');
  const [editMaskedInput, setEditMaskedInput] = useState('');
  const [editNotesInput, setEditNotesInput] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountEditError, setAccountEditError] = useState<string | null>(null);
  const [accountEditSuccess, setAccountEditSuccess] = useState<string | null>(null);

  const accountNetFlowMap = useMemo(() => {
    const map = new Map<string, { net: number; count: number }>();
    for (const tx of transactions) {
      const prev = map.get(tx.accountId) || { net: 0, count: 0 };
      const delta = tx.txType === 'income' ? tx.amount : -tx.amount;
      map.set(tx.accountId, {
        net: prev.net + delta,
        count: prev.count + 1,
      });
    }
    return map;
  }, [transactions]);

  const openAddModal = () => {
    setCreateError(null);
    setAddModalOpen(true);
  };

  const handleCreateProviderChange = (nextProvider: AccountProvider) => {
    setManProvider(nextProvider);
    if (nextProvider === 'ADCB') {
      setManInstitution('ADCB Bank');
      setManCurrency('AED');
    } else if (nextProvider === 'MANUAL') {
      setManInstitution('Cash');
    } else if (nextProvider === 'BCA') {
      setManInstitution('Bank BCA');
      setManCurrency('IDR');
    } else if (nextProvider === 'MANDIRI') {
      setManInstitution('Bank Mandiri');
      setManCurrency('IDR');
    } else {
      setManInstitution('Sumber Dana Lainnya');
    }
  };

  const openAccountEditor = (acc: FinancialAccount) => {
    setAccountEditError(null);
    setAccountEditSuccess(null);
    setEditingAccountId(acc.id);
    setBalanceMode('direct');
    setBalanceInput(String(acc.balance));
    setEditNameInput(acc.name);
    setEditInstitutionInput(acc.institution);
    setEditProviderInput(acc.provider);
    setEditCurrencyInput(acc.currency);
    setEditMaskedInput(acc.accountNumberMasked);
    setEditNotesInput(acc.notes || '');
  };

  const handleEditProviderChange = (nextProvider: AccountProvider) => {
    setEditProviderInput(nextProvider);
    const defaultInstitutions = new Set([
      '',
      'Cash',
      'Dompet Tunai',
      'Sumber Dana Pribadi',
      'Rekening Pribadi',
      'Sumber Dana Lainnya',
      'Bank Lainnya',
      'Bank BCA',
      'Bank Mandiri',
      'ADCB Bank',
      'ADCB Bank (Abu Dhabi Commercial Bank)',
    ]);
    if (defaultInstitutions.has(editInstitutionInput.trim())) {
      if (nextProvider === 'ADCB') setEditInstitutionInput('ADCB Bank');
      else if (nextProvider === 'MANUAL') setEditInstitutionInput('Cash');
      else if (nextProvider === 'BCA') setEditInstitutionInput('Bank BCA');
      else if (nextProvider === 'MANDIRI') setEditInstitutionInput('Bank Mandiri');
      else setEditInstitutionInput('Sumber Dana Lainnya');
    }
  };

  const handleSaveAccountEdit = async (e: React.FormEvent, acc: FinancialAccount) => {
    e.preventDefault();
    setAccountEditError(null);
    setAccountEditSuccess(null);

    const cleanName = editNameInput.trim();
    if (!cleanName) {
      setAccountEditError(tr('Nama sumber dana tidak boleh kosong.', 'Funding source name is required.'));
      return;
    }

    const parsedInput = Number(balanceInput);
    if (!Number.isFinite(parsedInput)) {
      setAccountEditError(tr('Masukkan nominal saldo yang valid.', 'Enter a valid balance amount.'));
      return;
    }

    const netInfo = accountNetFlowMap.get(acc.id);
    const finalBalance =
      balanceMode === 'from_opening' && netInfo
        ? Number((parsedInput + netInfo.net).toFixed(2))
        : Number(parsedInput.toFixed(2));

    setSavingAccount(true);
    try {
      const updatedTxCount = await onUpdateAccount(acc, {
        name: cleanName,
        institution:
          editInstitutionInput.trim() ||
          (editProviderInput === 'MANUAL' ? 'Cash' : acc.institution),
        provider: editProviderInput,
        currency: editCurrencyInput,
        accountNumberMasked: editMaskedInput.trim() || (editProviderInput === 'MANUAL' ? 'Cash' : '****'),
        balance: finalBalance,
        notes: editNotesInput.trim(),
      });
      setEditingAccountId(null);
      setAccountEditSuccess(
        tr(
          `Sumber dana "${cleanName}" berhasil diperbarui (${formatMoney(finalBalance, editCurrencyInput)})${
            updatedTxCount > 0
              ? ` · ${updatedTxCount} transaksi disesuaikan ke ${editCurrencyInput}`
              : ''
          }.`,
          `Funding source "${cleanName}" updated (${formatMoney(finalBalance, editCurrencyInput)})${
            updatedTxCount > 0
              ? ` · ${updatedTxCount} transactions updated to ${editCurrencyInput}`
              : ''
          }.`
        )
      );
    } catch (err) {
      setAccountEditError(
        err instanceof Error
          ? err.message
          : tr('Gagal memperbarui data sumber dana.', 'Failed to update funding source.')
      );
    } finally {
      setSavingAccount(false);
    }
  };

  const handleCreateManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    const cleanName = manName.trim();
    if (!cleanName) {
      setCreateError(tr('Nama sumber dana wajib diisi.', 'Funding source name is required.'));
      return;
    }

    const parsedBalance = manBalance.trim() ? Number(manBalance) : 0;
    if (!Number.isFinite(parsedBalance)) {
      setCreateError(tr('Masukkan nominal saldo awal yang valid.', 'Enter a valid opening balance.'));
      return;
    }

    setCreatingManual(true);
    try {
      await onCreateManualAccount({
        name: cleanName,
        institution:
          manInstitution.trim() || (manProvider === 'MANUAL' ? 'Cash' : 'ADCB Bank'),
        provider: manProvider,
        currency: manCurrency,
        accountNumberMasked: manMasked.trim() || (manProvider === 'MANUAL' ? 'Cash' : '****'),
        balance: Number(parsedBalance.toFixed(2)),
        notes: manNotes.trim(),
      });
      setManName('');
      setManMasked('');
      setManBalance('');
      setManNotes('');
      setAddModalOpen(false);
      setCreateSuccess(
        tr(
          `Sumber dana "${cleanName}" berhasil ditambahkan ke brankas.`,
          `Funding source "${cleanName}" added to the vault.`
        )
      );
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : tr('Gagal menyimpan sumber dana baru.', 'Failed to save new funding source.')
      );
    } finally {
      setCreatingManual(false);
    }
  };

  const isLegacyEditProvider = (provider: AccountProvider) =>
    provider === 'BCA' || provider === 'MANDIRI' || provider === 'OTHER';

  const previewBalanceNum = Number.isFinite(Number(manBalance)) && manBalance.trim() !== ''
    ? Number(manBalance)
    : 0;
  const previewIsCash = manProvider === 'MANUAL';

  return (
    <div className="space-y-6">
      {/* List Sumber Dana */}
      <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {tr('List Sumber Dana', 'Funding Sources')}
          </h2>

          {!readOnly && (
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{tr('Tambah Sumber Dana', 'Add Funding Source')}</span>
            </button>
          )}
        </div>

        {createSuccess && (
          <div className="mt-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{createSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setCreateSuccess(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer shrink-0"
            >
              {tr('Tutup', 'Close')}
            </button>
          </div>
        )}

        {accountEditSuccess && (
          <div className="mt-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{accountEditSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setAccountEditSuccess(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer shrink-0"
            >
              {tr('Tutup', 'Close')}
            </button>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {tr('Belum ada sumber dana tersimpan', 'No funding sources saved yet')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {tr(
                'Tambahkan sumber dana ADCB atau Cash Anda melalui tombol Tambah Sumber Dana, atau impor mutasi PDF/gambar.',
                'Add your ADCB or Cash funding source using the Add Funding Source button, or import a PDF/image statement.'
              )}
            </p>
            {!readOnly && (
              <button
                type="button"
                onClick={openAddModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{tr('Tambah Sumber Dana', 'Add Funding Source')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((acc) => {
              const isEditingAccount = editingAccountId === acc.id;
              const netInfo = accountNetFlowMap.get(acc.id);
              const providerLabel = formatAccountProviderLabel(acc.provider);
              const previewCalculatedBalance =
                balanceMode === 'from_opening' && netInfo && Number.isFinite(Number(balanceInput))
                  ? Number(balanceInput || 0) + netInfo.net
                  : Number(balanceInput || 0);

              return (
                <div key={acc.id} className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {acc.name}
                        </h3>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            acc.provider === 'ADCB'
                              ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-900'
                              : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900'
                          }`}
                        >
                          {providerLabel}
                        </span>
                        {acc.accountNumberMasked && acc.accountNumberMasked !== 'Cash' && (
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {acc.accountNumberMasked}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{acc.institution}</span>
                        <span aria-hidden="true">·</span>
                        <span>{acc.currency}</span>
                        {netInfo && netInfo.count > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {netInfo.count} {tr('transaksi', 'transactions')}
                            </span>
                          </>
                        )}
                      </div>
                      {acc.notes && (
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {tr('Catatan', 'Note')}: {acc.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0">
                      <p className="font-mono text-base font-semibold text-slate-900 dark:text-white tabular-nums">
                        {formatMoney(acc.balance, acc.currency)}
                      </p>

                      {!readOnly && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              isEditingAccount
                                ? setEditingAccountId(null)
                                : openAccountEditor(acc)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>
                              {isEditingAccount
                                ? tr('Tutup', 'Close')
                                : tr('Edit Sumber Dana', 'Edit Source')}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteAccount(acc.id)}
                            aria-label={`${tr('Hapus', 'Delete')} ${acc.name}`}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditingAccount && (
                    <form
                      onSubmit={(e) => handleSaveAccountEdit(e, acc)}
                      className="mt-3 p-4 rounded-xl border border-teal-200 dark:border-teal-900/60 bg-slate-50 dark:bg-slate-950/70 space-y-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {tr('Edit Sumber Dana & Saldo', 'Edit Funding Source & Balance')}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {netInfo && netInfo.count > 0
                              ? tr(
                                  `Terdapat ${netInfo.count} mutasi tercatat (arus bersih ${netInfo.net >= 0 ? '+' : ''}${formatMoney(netInfo.net, acc.currency)}).`,
                                  `${netInfo.count} recorded transactions (net flow ${netInfo.net >= 0 ? '+' : ''}${formatMoney(netInfo.net, acc.currency)}).`
                                )
                              : tr(
                                  'Perbarui informasi sumber dana, mata uang, dan saldo secara terenkripsi.',
                                  'Update funding source details, currency, and balance.'
                                )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingAccountId(null)}
                          aria-label={tr('Tutup editor sumber dana', 'Close funding source editor')}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('Nama Sumber Dana', 'Funding Source Name')}
                          </label>
                          <input
                            type="text"
                            value={editNameInput}
                            onChange={(e) => setEditNameInput(e.target.value)}
                            required
                            placeholder={tr('Misal: ADCB TouchPoints', 'e.g. ADCB TouchPoints')}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('Jenis Sumber Dana', 'Source Type')}
                          </label>
                          <select
                            value={editProviderInput}
                            onChange={(e) =>
                              handleEditProviderChange(e.target.value as AccountProvider)
                            }
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          >
                            <option value="ADCB">ADCB</option>
                            <option value="MANUAL">Cash</option>
                            {isLegacyEditProvider(acc.provider) && (
                              <>
                                <option value="BCA">Bank BCA (Lama)</option>
                                <option value="MANDIRI">Bank Mandiri (Lama)</option>
                                <option value="OTHER">Lainnya (Lama)</option>
                              </>
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('Mata Uang', 'Currency')}
                          </label>
                          <select
                            value={editCurrencyInput}
                            onChange={(e) =>
                              setEditCurrencyInput(e.target.value as SupportedCurrency)
                            }
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          >
                            <option value="AED">AED (Dirham UEA)</option>
                            <option value="IDR">IDR (Rupiah)</option>
                            <option value="USD">USD (Dolar AS)</option>
                            <option value="SGD">SGD (Dolar Singapura)</option>
                            <option value="EUR">EUR (Euro)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('Institusi / Label Sumber', 'Institution / Source Label')}
                          </label>
                          <input
                            type="text"
                            value={editInstitutionInput}
                            onChange={(e) => setEditInstitutionInput(e.target.value)}
                            placeholder={tr('Misal: ADCB Bank / Cash', 'e.g. ADCB Bank / Cash')}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('No. Kartu / Referensi / IBAN', 'Card No. / Reference / IBAN')}
                          </label>
                          <input
                            type="text"
                            value={editMaskedInput}
                            onChange={(e) => setEditMaskedInput(e.target.value)}
                            placeholder={tr('Misal: ****1234', 'e.g. ****1234')}
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>
                      </div>

                      {netInfo && netInfo.count > 0 && (
                        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setBalanceMode('direct');
                              setBalanceInput(String(acc.balance));
                            }}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-colors ${
                              balanceMode === 'direct'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {tr('Update Saldo Langsung', 'Update Balance Directly')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBalanceMode('from_opening');
                              const impliedOpening = Number((acc.balance - netInfo.net).toFixed(2));
                              setBalanceInput(String(impliedOpening));
                            }}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-colors ${
                              balanceMode === 'from_opening'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {tr('Hitung dari Saldo Awal + Mutasi', 'Calculate from Opening + Flow')}
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {balanceMode === 'from_opening'
                              ? tr(
                                  `Saldo Awal Manual (${editCurrencyInput})`,
                                  `Manual Opening Balance (${editCurrencyInput})`
                                )
                              : tr(
                                  `Saldo Sumber Dana (${editCurrencyInput})`,
                                  `Current Balance (${editCurrencyInput})`
                                )}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={balanceInput}
                            onChange={(e) => setBalanceInput(e.target.value)}
                            required
                            className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {tr('Catatan Sumber Dana (Opsional)', 'Funding Source Note (Optional)')}
                          </label>
                          <input
                            type="text"
                            value={editNotesInput}
                            onChange={(e) => setEditNotesInput(e.target.value)}
                            placeholder={tr('Misal: Sumber dana gaji atau tunai harian', 'e.g. Salary or daily cash')}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                        </div>
                      </div>

                      {editCurrencyInput !== acc.currency && netInfo && netInfo.count > 0 && (
                        <div className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300">
                          {tr(
                            `Mengubah mata uang ke ${editCurrencyInput} juga akan menyesuaikan mata uang pada ${netInfo.count} transaksi yang terhubung ke sumber dana ini.`,
                            `Changing currency to ${editCurrencyInput} will also update ${netInfo.count} linked transactions.`
                          )}
                        </div>
                      )}

                      {balanceMode === 'from_opening' && netInfo && (
                        <div className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {tr('Kalkulasi: Saldo Awal + Mutasi', 'Calculation: Opening + Net Flow')} ({netInfo.net >= 0 ? '+' : ''}
                            {formatMoney(netInfo.net, editCurrencyInput)})
                          </span>
                          <span className="font-mono font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
                            {tr('Saldo Akhir', 'Ending Balance')} = {formatMoney(previewCalculatedBalance, editCurrencyInput)}
                          </span>
                        </div>
                      )}

                      {accountEditError && (
                        <div className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                          {accountEditError}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingAccountId(null)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                        >
                          {tr('Batal', 'Cancel')}
                        </button>
                        <button
                          type="submit"
                          disabled={savingAccount}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white disabled:opacity-60 cursor-pointer whitespace-nowrap"
                        >
                          {savingAccount ? tr('Menyimpan...', 'Saving...') : tr('Simpan Perubahan', 'Save Changes')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modal Tambah Sumber Dana with Live Card Preview */}
      {!readOnly && addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-sumber-dana-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto"
          >
            {/* Top Emerald-Teal Accent Strip */}
            <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400" />

            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800/80 shadow-xs flex items-center justify-center shrink-0">
                  <Landmark className="w-4.5 h-4.5 text-emerald-700 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="add-sumber-dana-title"
                    className="font-display text-base font-bold text-slate-900 dark:text-white truncate"
                  >
                    {tr('Tambah Sumber Dana', 'Add Funding Source')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {tr(
                      'Hubungkan rekening bank, kartu, atau dompet tunai baru',
                      'Connect a new bank account, card, or cash wallet'
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label={tr('Tutup modal tambah sumber dana', 'Close add funding source modal')}
                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManualSubmit} className="p-6 space-y-5">
              {/* Live Card Preview Panel */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/70 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-emerald-700 dark:text-emerald-400 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>LIVE CARD PREVIEW</span>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    {previewIsCash
                      ? tr('Dompet Tunai', 'Cash Wallet')
                      : tr('Rekening Bank', 'Bank Account')}
                  </span>
                </div>

                {/* Live Gradient Card */}
                <div
                  className={`relative overflow-hidden rounded-xl p-5 text-white shadow-md transition-colors ${
                    previewIsCash
                      ? 'bg-gradient-to-br from-amber-600 via-amber-700 to-slate-900'
                      : 'bg-gradient-to-br from-emerald-600 via-teal-700 to-emerald-950'
                  }`}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-10 -top-10 w-36 h-36 rounded-full bg-white/10 blur-xl"
                  />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-white/80 truncate">
                        {(manInstitution.trim() || (previewIsCash ? 'CASH WALLET' : 'ADCB BANK')).toUpperCase()}
                      </p>
                      <p className="font-display text-base font-bold text-white truncate mt-0.5">
                        {manName.trim() ||
                          (previewIsCash
                            ? tr('Dompet Tunai Harian', 'Daily Cash Wallet')
                            : 'ADCB TouchPoints')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {previewIsCash ? (
                        <div className="w-8 h-6 rounded-md bg-white/15 border border-white/25 flex items-center justify-center">
                          <Wallet className="w-3.5 h-3.5 text-amber-200" />
                        </div>
                      ) : (
                        <>
                          <div className="w-8 h-5.5 rounded-sm bg-gradient-to-br from-amber-200 to-amber-400 border border-amber-100/60 flex items-center justify-center">
                            <div className="w-4 h-3 border border-amber-700/40 rounded-[2px]" />
                          </div>
                          <Wifi className="w-4 h-4 text-white/75 rotate-90" />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="relative mt-5 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] text-white/70">
                        {previewIsCash
                          ? tr('Referensi Tunai', 'Cash Reference')
                          : tr('Nomor / Kartu', 'Account / Card')}
                      </p>
                      <p className="font-mono text-xs font-medium tracking-wider text-white/95 mt-0.5">
                        {manMasked.trim() || (previewIsCash ? 'CASH' : '•••• 1234')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-white/70">
                        {tr('Saldo Awal', 'Opening Balance')}
                      </p>
                      <p className="font-mono text-sm font-bold text-white tabular-nums mt-0.5">
                        {formatMoney(previewBalanceNum, manCurrency)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Provider Selector Cards */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {tr('Jenis Sumber Dana', 'Source Type')}
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleCreateProviderChange('ADCB')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      manProvider === 'ADCB'
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">ADCB / {tr('Bank', 'Bank')}</p>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                        {tr('Rekening & Kartu', 'Account & Card')}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCreateProviderChange('MANUAL')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      manProvider === 'MANUAL'
                        ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Wallet className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">Cash</p>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                        {tr('Dompet Tunai', 'Cash Wallet')}
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Nama Sumber Dana', 'Funding Source Name')}
                  </label>
                  <input
                    type="text"
                    value={manName}
                    onChange={(e) => setManName(e.target.value)}
                    placeholder={
                      manProvider === 'ADCB'
                        ? tr('Contoh: ADCB TouchPoints / ADCB Current', 'Example: ADCB TouchPoints / ADCB Current')
                        : tr('Contoh: Dompet Cash Harian', 'Example: Daily Cash Wallet')
                    }
                    required
                    autoFocus
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Mata Uang', 'Currency')}
                  </label>
                  <select
                    value={manCurrency}
                    onChange={(e) => setManCurrency(e.target.value as SupportedCurrency)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="AED">AED (Dirham UEA)</option>
                    <option value="IDR">IDR (Rupiah)</option>
                    <option value="USD">USD (Dolar AS)</option>
                    <option value="SGD">SGD (Dolar Singapura)</option>
                    <option value="EUR">EUR (Euro)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Institusi / Label Sumber', 'Institution / Source Label')}
                  </label>
                  <div className="relative">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={manInstitution}
                      onChange={(e) => setManInstitution(e.target.value)}
                      placeholder={manProvider === 'ADCB' ? 'ADCB Bank' : 'Cash'}
                      className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('No. Kartu / Referensi (Opsional)', 'Card No. / Reference (Optional)')}
                  </label>
                  <input
                    type="text"
                    value={manMasked}
                    onChange={(e) => setManMasked(e.target.value)}
                    placeholder={manProvider === 'ADCB' ? 'Contoh: ****1234' : 'Contoh: Cash'}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Saldo Awal', 'Opening Balance')} ({manCurrency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={manBalance}
                    onChange={(e) => setManBalance(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {tr('Catatan (Opsional)', 'Note (Optional)')}
                  </label>
                  <input
                    type="text"
                    value={manNotes}
                    onChange={(e) => setManNotes(e.target.value)}
                    placeholder={tr('Dana gaji / operasional', 'Salary / operational fund')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              {createError && (
                <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {tr('Batal', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creatingManual}
                  className="inline-flex items-center justify-center gap-2 py-2 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white dark:text-slate-950 text-xs font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {creatingManual
                      ? tr('Menyimpan...', 'Saving...')
                      : tr('Simpan Sumber Dana', 'Save Funding Source')}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
