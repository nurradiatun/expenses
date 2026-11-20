import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  CheckCircle2,
  CloudOff,
  FileDown,
  Landmark,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useLanguage } from './lib/i18n';
import {
  compareTransactionsByDateDesc,
  getPureCustomCategories,
  getResolvedBuiltInCategories,
  mergeCategoryLists,
  mergeCategoryListsByType,
  normalizeCategoryKey,
  type AccountProvider,
  type CategoryBudget,
  type CustomCategory,
  type DisplayCurrency,
  type ExchangeRatesInfo,
  type ExtractedPdfStatement,
  type FinancialAccount,
  type FinancialTransaction,
  type ResolvedBuiltInCategory,
  type SupportedCurrency,
  type SyncLogEntry,
  type TransactionType,
  type UserProfile,
  type VaultConfigDoc,
  type VaultMember,
  type VaultShare,
  type VaultShareRole,
} from './types';
import { auth, signOutAccount, testFirestoreConnection } from './lib/firebase';
import {
  clearVaultKeySession,
  exportVaultKeyToSession,
  restoreVaultKeyFromSession,
} from './lib/crypto';
import { DEFAULT_FX_RATES_TO_IDR } from './lib/formatters';
import { reconcileTransactionsWithPending, type PendingTxMutation } from './lib/txSync';
import {
  acceptVaultShareInvitation,
  batchDeleteEncryptedTransactions,
  batchImportEncryptedTransactions,
  batchUpdateEncryptedTransactionsCategory,
  createEncryptedAccount,
  createEncryptedCustomCategory,
  createEncryptedTransaction,
  deleteAllUserVaultData,
  deleteEncryptedAccount,
  deleteEncryptedCustomCategory,
  deleteEncryptedTransaction,
  deleteUnlistedTransactionCategory,
  ensureUserProfile,
  getVaultConfig,
  inviteVaultMember,
  leaveSharedVault,
  renameOrMergeUnlistedCategory,
  restoreBuiltInCategoryOverrides,
  revokeVaultShare,
  rotateVaultPassphrase,
  saveCategoryBudgetsBatch,
  subscribeEncryptedAccounts,
  subscribeEncryptedBudgets,
  subscribeEncryptedCategories,
  subscribeEncryptedSyncLogs,
  subscribeEncryptedTransactions,
  subscribeIncomingVaultSharesByEmail,
  subscribeMyOwnedVaultShares,
  subscribeMySharedMemberships,
  syncSharedWithUidsForOwner,
  unlockVaultWithPassphrase,
  updateEncryptedAccountDetails,
  updateEncryptedCustomCategory,
  updateEncryptedTransaction,
  updateUserPreferences,
  updateVaultMemberRole,
  upsertBuiltInCategoryOverride,
} from './lib/vaultService';
import { AuthAndVaultGate } from './components/AuthAndVaultGate';
import { BudgetManagerModal } from './components/BudgetManagerModal';
import { BudgetsView } from './components/BudgetsView';
import { DashboardView } from './components/DashboardView';
import { InsightsView } from './components/InsightsView';
import { TransactionsView } from './components/TransactionsView';
import { PdfImportModal } from './components/PdfImportView';
import { AdcbAccountsView } from './components/AdcbAccountsView';
import { ExportVaultView } from './components/ExportVaultView';
import { TransactionModal } from './components/TransactionModal';
import { VaultSharingModal } from './components/VaultSharingModal';

type ActiveTab = 'dashboard' | 'insights' | 'budgets' | 'transactions' | 'accounts' | 'export';

async function safeReadApiJson(res: globalThis.Response, fallbackErr: string) {
  const rawText = await res.text();
  if (rawText.trimStart().startsWith('<')) {
    throw new Error('Server sedang memulai ulang. Silakan coba beberapa detik lagi.');
  }
  const data = rawText ? JSON.parse(rawText) : {};
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : fallbackErr);
  }
  return data;
}

const NAV_ITEMS: Array<{
  id: ActiveTab;
  labelId: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', labelId: 'Ringkasan', labelEn: 'Overview', icon: BarChart3 },
  { id: 'transactions', labelId: 'Transaksi', labelEn: 'Transactions', icon: ListOrdered },
  { id: 'accounts', labelId: 'Data Rekening', labelEn: 'Accounts', icon: Landmark },
  { id: 'export', labelId: 'Pengaturan & Laporan', labelEn: 'Settings & Reports', icon: FileDown },
];

export default function App() {
  const { lang, setLang, tr } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [vaultConfig, setVaultConfig] = useState<VaultConfigDoc | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [budgetFocusType, setBudgetFocusType] = useState<TransactionType>('expense');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const hasManuallySelectedMonthRef = useRef(false);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('AED');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      (localStorage.getItem('my_expenses_theme') ?? localStorage.getItem('khasanah_theme')) ===
      'dark'
    );
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [sharingModalOpen, setSharingModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinancialTransaction | null>(null);
  const [manualCreatedTick, setManualCreatedTick] = useState(0);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Family / Multi-account sharing state
  const [activeVaultOwnerId, setActiveVaultOwnerId] = useState<string | null>(null);
  const [ownedShares, setOwnedShares] = useState<VaultShare[]>([]);
  const [incomingShares, setIncomingShares] = useState<VaultShare[]>([]);
  const [sharedMemberships, setSharedMemberships] = useState<VaultMember[]>([]);
  const membershipsLoadedRef = useRef(false);
  const lastShareSyncSigRef = useRef('');

  const [exchangeRates, setExchangeRates] = useState<ExchangeRatesInfo>({
    ratesToIdr: { ...DEFAULT_FX_RATES_TO_IDR },
    source: 'Memuat kurs terkini...',
    updatedAtIso: '',
    isLive: false,
  });
  const [refreshingRates, setRefreshingRates] = useState(false);

  const transactionsRef = useRef<FinancialTransaction[]>(transactions);
  transactionsRef.current = transactions;
  const pendingTxMutationsRef = useRef<Map<string, PendingTxMutation>>(new Map());
  const activeUidRef = useRef<string | null>(null);
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  vaultKeyRef.current = vaultKey;

  useEffect(() => {
    if (hasManuallySelectedMonthRef.current || transactions.length === 0) return;
    let maxMonth = '';
    for (const tx of transactions) {
      if (tx.monthKey && tx.monthKey > maxMonth) {
        maxMonth = tx.monthKey;
      }
    }
    if (maxMonth) {
      setSelectedMonth(maxMonth);
    }
  }, [transactions]);

  const refreshExchangeRates = useCallback(async (force = false) => {
    setRefreshingRates(true);
    try {
      const res = await fetch(force ? '/api/exchange-rates?force=1' : '/api/exchange-rates');
      const data = await safeReadApiJson(res, 'Gagal memuat kurs mata uang terkini.');
      if (data?.ratesToIdr) {
        setExchangeRates({
          ratesToIdr: {
            AED: Number(data.ratesToIdr.AED) || DEFAULT_FX_RATES_TO_IDR.AED,
            IDR: 1,
            USD: Number(data.ratesToIdr.USD) || DEFAULT_FX_RATES_TO_IDR.USD,
            SGD: Number(data.ratesToIdr.SGD) || DEFAULT_FX_RATES_TO_IDR.SGD,
            EUR: Number(data.ratesToIdr.EUR) || DEFAULT_FX_RATES_TO_IDR.EUR,
          },
          source: String(data.source || 'Kurs Otomatis'),
          updatedAtIso: String(data.updatedAtIso || new Date().toISOString()),
          providerUpdatedAt:
            typeof data.providerUpdatedAt === 'string' ? data.providerUpdatedAt : undefined,
          isLive: Boolean(data.isLive),
        });
      }
    } catch {
      // Retain existing rates silently on transient offline/network error
    } finally {
      setRefreshingRates(false);
    }
  }, []);

  // Fetch latest live exchange rates on boot, when coming back online, and every 15 minutes
  useEffect(() => {
    if (!isOnline) return;
    void refreshExchangeRates(false);
    const timer = setInterval(() => {
      void refreshExchangeRates(false);
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isOnline, refreshExchangeRates]);

  // Sync dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('my_expenses_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('my_expenses_theme', 'light');
    }
  }, [darkMode]);

  // Network connectivity listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Validate Firestore connection on initial boot
  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  // Firebase Auth listener (never reset unlocked vaultKey if the same UID refreshes tokens)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      if (nextUser && activeUidRef.current === nextUser.uid && vaultKeyRef.current) {
        setUser(nextUser);
        setLoadingAuth(false);
        return;
      }

      activeUidRef.current = nextUser?.uid ?? null;
      setUser(nextUser);
      setVaultKey(null);
      pendingTxMutationsRef.current.clear();
      setAccounts([]);
      setTransactions([]);
      setSyncLogs([]);
      setCustomCategories([]);
      setBudgets([]);
      setOwnedShares([]);
      setIncomingShares([]);
      setSharedMemberships([]);
      membershipsLoadedRef.current = false;
      lastShareSyncSigRef.current = '';
      setBannerError(null);

      if (!nextUser) {
        clearVaultKeySession();
        setActiveVaultOwnerId(null);
        setProfile(null);
        setVaultConfig(null);
        setImportModalOpen(false);
        setSharingModalOpen(false);
        setLoadingAuth(false);
        return;
      }

      const storedTargetVault =
        (typeof window !== 'undefined' &&
          window.sessionStorage?.getItem(`my_expenses_active_vault_${nextUser.uid}`)) ||
        nextUser.uid;
      let targetOwnerId = storedTargetVault;
      setActiveVaultOwnerId(targetOwnerId);

      setLoadingAuth(false);
      setLoadingConfig(true);
      try {
        const prof = await ensureUserProfile(nextUser);
        setProfile(prof);
        setDisplayCurrency(prof.preferredCurrency);

        let cfg: VaultConfigDoc | null = null;
        try {
          cfg = await getVaultConfig(targetOwnerId);
        } catch {
          if (targetOwnerId !== nextUser.uid) {
            targetOwnerId = nextUser.uid;
            setActiveVaultOwnerId(targetOwnerId);
            if (typeof window !== 'undefined' && window.sessionStorage) {
              window.sessionStorage.removeItem(`my_expenses_active_vault_${nextUser.uid}`);
            }
            cfg = await getVaultConfig(nextUser.uid);
          } else {
            throw new Error('Gagal memuat konfigurasi brankas.');
          }
        }
        setVaultConfig(cfg);

        if (cfg) {
          const restoredKey = await restoreVaultKeyFromSession(
            targetOwnerId,
            cfg.keyCheckCiphertext,
            cfg.keyCheckIv
          );
          if (restoredKey) {
            setVaultKey(restoredKey);
            if (
              typeof window !== 'undefined' &&
              window.sessionStorage?.getItem(`my_expenses_import_open_${nextUser.uid}`) === '1'
            ) {
              setImportModalOpen(true);
            }
          }
        }
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'Gagal memuat konfigurasi brankas.');
      } finally {
        setLoadingConfig(false);
      }
    });
    return () => unsub();
  }, []);

  const effectiveVaultOwnerId = activeVaultOwnerId || user?.uid || '';
  const isSharedVaultView = Boolean(
    user && effectiveVaultOwnerId && effectiveVaultOwnerId !== user.uid
  );

  const activeMembership = useMemo(
    () => sharedMemberships.find((m) => m.vaultOwnerId === effectiveVaultOwnerId),
    [sharedMemberships, effectiveVaultOwnerId]
  );

  const activeVaultRole: VaultShareRole = isSharedVaultView
    ? activeMembership?.role || 'viewer'
    : 'editor';
  const isReadOnlyVault = isSharedVaultView && activeVaultRole === 'viewer';

  const activeSharedInfo = useMemo(
    () => incomingShares.find((s) => s.vaultOwnerId === effectiveVaultOwnerId),
    [incomingShares, effectiveVaultOwnerId]
  );

  const activeVaultOwnerLabel = isSharedVaultView
    ? activeSharedInfo?.ownerDisplayName || activeSharedInfo?.ownerEmail || 'Pasangan'
    : profile?.displayName || 'Brankas Pribadi';

  const activeOwnedMemberUids = useMemo(
    () => ownedShares.filter((s) => s.status === 'active' && s.memberUid).map((s) => s.memberUid),
    [ownedShares]
  );

  const writeSharedWithUids = useMemo(() => {
    if (!user || !effectiveVaultOwnerId) return undefined;
    if (isSharedVaultView) {
      return Array.from(new Set([effectiveVaultOwnerId, user.uid]));
    }
    if (activeOwnedMemberUids.length === 0) return undefined;
    return Array.from(new Set([user.uid, ...activeOwnedMemberUids]));
  }, [user, effectiveVaultOwnerId, isSharedVaultView, activeOwnedMemberUids]);

  const pendingIncomingCount = useMemo(
    () => incomingShares.filter((s) => s.status === 'pending').length,
    [incomingShares]
  );

  const handleSelectVault = useCallback(
    async (nextOwnerId: string) => {
      if (!user) return;
      const targetId = nextOwnerId || user.uid;
      if (targetId === effectiveVaultOwnerId && vaultKey) return;

      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(`my_expenses_active_vault_${user.uid}`, targetId);
      }
      setActiveVaultOwnerId(targetId);
      setVaultKey(null);
      pendingTxMutationsRef.current.clear();
      setAccounts([]);
      setTransactions([]);
      setSyncLogs([]);
      setCustomCategories([]);
      setBudgets([]);
      setBannerError(null);
      setLoadingConfig(true);
      try {
        const cfg = await getVaultConfig(targetId);
        setVaultConfig(cfg);
        if (cfg) {
          const restored = await restoreVaultKeyFromSession(
            targetId,
            cfg.keyCheckCiphertext,
            cfg.keyCheckIv
          );
          if (restored) {
            setVaultKey(restored);
          }
        }
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : 'Gagal beralih ke brankas yang dipilih.');
      } finally {
        setLoadingConfig(false);
      }
    },
    [user, effectiveVaultOwnerId, vaultKey]
  );

  // Subscribe to family vault sharing invitations & memberships when signed in
  useEffect(() => {
    if (!user) return;
    const unsubOwned = subscribeMyOwnedVaultShares(
      user.uid,
      setOwnedShares,
      (err) => setBannerError(err.message)
    );
    const unsubMemberships = subscribeMySharedMemberships(
      user.uid,
      (list) => {
        membershipsLoadedRef.current = true;
        setSharedMemberships(list);
      },
      (err) => setBannerError(err.message)
    );
    const unsubIncoming = subscribeIncomingVaultSharesByEmail(
      user.email || '',
      setIncomingShares,
      (err) => setBannerError(err.message)
    );

    return () => {
      unsubOwned();
      unsubMemberships();
      unsubIncoming();
    };
  }, [user]);

  // If active shared vault membership is revoked remotely, return to personal vault
  useEffect(() => {
    if (!user || !isSharedVaultView || !membershipsLoadedRef.current) return;
    if (!activeMembership) {
      void handleSelectVault(user.uid);
    }
  }, [user, isSharedVaultView, activeMembership, handleSelectVault]);

  // Auto-sync sharedWithUids across owner's encrypted documents so partners see all existing & new data
  useEffect(() => {
    if (!user || !vaultKey || isSharedVaultView) return;
    if (activeOwnedMemberUids.length === 0) return;

    const sortedUids = [...activeOwnedMemberUids].sort().join(',');
    const sig = `${user.uid}|${sortedUids}|${accounts.length}|${transactions.length}|${customCategories.length}|${budgets.length}`;
    if (lastShareSyncSigRef.current === sig) return;
    lastShareSyncSigRef.current = sig;

    void syncSharedWithUidsForOwner(user.uid, activeOwnedMemberUids).catch(() => {
      lastShareSyncSigRef.current = '';
    });
  }, [
    user,
    vaultKey,
    isSharedVaultView,
    activeOwnedMemberUids,
    accounts.length,
    transactions.length,
    customCategories.length,
    budgets.length,
  ]);

  // Persist whether the import modal is currently open during this tab session
  useEffect(() => {
    if (!user?.uid || typeof window === 'undefined' || !window.sessionStorage) return;
    const key = `my_expenses_import_open_${user.uid}`;
    if (importModalOpen) {
      window.sessionStorage.setItem(key, '1');
    } else {
      window.sessionStorage.removeItem(key);
    }
  }, [user?.uid, importModalOpen]);

  const keepSessionActive = useCallback(() => {
    const current = auth.currentUser;
    if (!current) return;
    void current.getIdToken(true).catch(() => {
      // Ignore transient offline refresh failure; token will retry on next activity
    });
  }, []);

  // Periodic keep-alive every 15 minutes & on tab visibility return while vault is unlocked
  useEffect(() => {
    if (!user || !vaultKey) return;
    const intervalMs = importModalOpen ? 5 * 60 * 1000 : 15 * 60 * 1000;
    const timer = setInterval(() => {
      keepSessionActive();
    }, intervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        keepSessionActive();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, vaultKey, importModalOpen, keepSessionActive]);

  // Real-time encrypted Firestore subscriptions (supports Own Vault & Shared Vault)
  useEffect(() => {
    if (!user || !vaultKey || !effectiveVaultOwnerId) return;

    const unsubAccounts = subscribeEncryptedAccounts(
      effectiveVaultOwnerId,
      vaultKey,
      (accs, cached) => {
        setAccounts(accs);
        setFromCache(cached);
      },
      (err) => setBannerError(err.message),
      user.uid
    );

    const unsubTxs = subscribeEncryptedTransactions(
      effectiveVaultOwnerId,
      vaultKey,
      (txs, cached) => {
        setTransactions(
          reconcileTransactionsWithPending(txs, pendingTxMutationsRef.current, cached)
        );
        setFromCache((prev) => prev || cached);
      },
      (err) => setBannerError(err.message),
      user.uid
    );

    const unsubLogs = subscribeEncryptedSyncLogs(
      effectiveVaultOwnerId,
      vaultKey,
      setSyncLogs,
      user.uid
    );
    const unsubCategories = subscribeEncryptedCategories(
      effectiveVaultOwnerId,
      vaultKey,
      setCustomCategories,
      (err) => setBannerError(err.message),
      user.uid
    );
    const unsubBudgets = subscribeEncryptedBudgets(
      effectiveVaultOwnerId,
      vaultKey,
      setBudgets,
      (err) => setBannerError(err.message),
      user.uid
    );

    return () => {
      unsubAccounts();
      unsubTxs();
      unsubLogs();
      unsubCategories();
      unsubBudgets();
    };
  }, [user, vaultKey, effectiveVaultOwnerId]);

  const availableCategories = useMemo(
    () => mergeCategoryLists(customCategories, transactions),
    [customCategories, transactions]
  );

  const expenseCategories = useMemo(
    () => mergeCategoryListsByType(customCategories, transactions, 'expense'),
    [customCategories, transactions]
  );

  const incomeCategories = useMemo(
    () => mergeCategoryListsByType(customCategories, transactions, 'income'),
    [customCategories, transactions]
  );

  const handleUpdateAccount = async (
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
  ): Promise<number> => {
    if (!vaultKey) return 0;
    const cleanName = params.name.trim() || account.name;
    const cleanInstitution = params.institution.trim() || account.institution;
    const cleanMasked = params.accountNumberMasked.trim() || account.accountNumberMasked || '****';

    return updateEncryptedAccountDetails({
      vaultKey,
      account,
      provider: params.provider,
      currency: params.currency,
      autoSyncDaily: false,
      syncHour: account.syncHour,
      payload: {
        name: cleanName,
        accountNumberMasked: cleanMasked,
        balance: Number(params.balance),
        institution: cleanInstitution,
        notes: params.notes.trim(),
      },
      affectedTransactions: transactionsRef.current,
    });
  };

  const handleCreateManualAccount = async (params: {
    name: string;
    institution: string;
    provider: AccountProvider;
    currency: SupportedCurrency;
    accountNumberMasked: string;
    balance: number;
    notes?: string;
  }) => {
    if (!user || !vaultKey || !effectiveVaultOwnerId) return;
    await createEncryptedAccount({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      provider: params.provider,
      currency: params.currency,
      autoSyncDaily: false,
      syncHour: 6,
      payload: {
        name: params.name,
        accountNumberMasked: params.accountNumberMasked,
        balance: params.balance,
        institution: params.institution,
        notes: params.notes?.trim() || '',
      },
    });
  };

  const handleImportPdfConfirm = async (params: {
    targetAccountId: string | 'CREATE_NEW';
    newAccountSpec?: {
      name: string;
      institution: string;
      accountNumberMasked: string;
      currency: SupportedCurrency;
      balance: number;
    };
    statement: ExtractedPdfStatement;
    updateBalanceToClosing: boolean;
  }): Promise<number> => {
    if (!user || !vaultKey || !effectiveVaultOwnerId) return 0;

    let targetAccount: FinancialAccount | undefined = accounts.find(
      (a) => a.id === params.targetAccountId
    );

    if (!targetAccount && params.newAccountSpec) {
      const upperBank = params.newAccountSpec.institution.toUpperCase();
      const provider: AccountProvider = upperBank.includes('ADCB')
        ? 'ADCB'
        : upperBank.includes('BCA')
          ? 'BCA'
          : upperBank.includes('MANDIRI')
            ? 'MANDIRI'
            : 'OTHER';

      const newId = await createEncryptedAccount({
        uid: effectiveVaultOwnerId,
        sharedWithUids: writeSharedWithUids,
        vaultKey,
        provider,
        currency: params.newAccountSpec.currency,
        autoSyncDaily: false,
        syncHour: 6,
        payload: {
          name: params.newAccountSpec.name,
          accountNumberMasked: params.newAccountSpec.accountNumberMasked,
          balance: params.newAccountSpec.balance,
          institution: params.newAccountSpec.institution,
          notes: 'Dibuat otomatis dari impor mutasi PDF',
        },
      });

      targetAccount = {
        id: newId,
        ownerId: effectiveVaultOwnerId,
        provider,
        currency: params.newAccountSpec.currency,
        autoSyncDaily: false,
        syncHour: 6,
        lastSyncedAtIso: new Date().toISOString(),
        name: params.newAccountSpec.name,
        accountNumberMasked: params.newAccountSpec.accountNumberMasked,
        balance: params.newAccountSpec.balance,
        institution: params.newAccountSpec.institution,
        notes: 'Dibuat otomatis dari impor mutasi PDF',
      };
    }

    if (!targetAccount) {
      throw new Error('Sumber dana tujuan tidak ditemukan.');
    }

    const selectedTxs = params.statement.transactions.filter((t) => t.selected);
    const shouldUpdateClosing =
      (params.updateBalanceToClosing || params.targetAccountId === 'CREATE_NEW') &&
      params.statement.closingBalance > 0;
    const nowIso = new Date().toISOString();
    const actorName = profile?.displayName || user.displayName || user.email || 'Pengguna';
    const actorEmail = (user.email || '').toLowerCase();

    return batchImportEncryptedTransactions({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      account: targetAccount,
      source: 'pdf',
      items: selectedTxs.map((tx) => ({
        txType: tx.type,
        payload: {
          date: tx.date,
          description: tx.description,
          merchant: tx.merchant,
          amount: tx.amount,
          currency: params.statement.currency,
          category: tx.category,
          reference: tx.reference,
          notes:
            tx.postingDate && tx.postingDate !== tx.date
              ? `Impor Mutasi (${params.statement.statementPeriod}) · Posting Date: ${tx.postingDate}`
              : `Impor Mutasi (${params.statement.statementPeriod})`,
          createdByUid: user.uid,
          createdByName: actorName,
          createdByEmail: actorEmail,
          createdAtIso: nowIso,
        },
      })),
      newClosingBalance: shouldUpdateClosing
        ? params.statement.closingBalance
        : targetAccount.balance,
      syncType: 'pdf_import',
      logSummary: `Impor ${selectedTxs.length} transaksi · ${params.statement.bankName} (${params.statement.statementPeriod})`,
    });
  };

  const handleSaveTransaction = async (data: {
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
  }) => {
    if (!user || !vaultKey || !effectiveVaultOwnerId) return;
    const account = accounts.find((a) => a.id === data.accountId);
    if (!account) throw new Error('Sumber dana tidak ditemukan.');

    const nowIso = new Date().toISOString();
    const actorName = profile?.displayName || user.displayName || user.email || 'Pengguna';
    const actorEmail = (user.email || '').toLowerCase();

    if (data.txId) {
      const existingTx = transactionsRef.current.find((t) => t.id === data.txId);
      await updateEncryptedTransaction({
        vaultKey,
        txId: data.txId,
        txType: data.txType,
        payload: {
          date: data.date,
          description: data.description,
          merchant: data.merchant,
          amount: data.amount,
          currency: account.currency,
          category: data.category,
          reference: data.reference,
          notes: data.notes,
          createdByUid: existingTx?.createdByUid,
          createdByName: existingTx?.createdByName,
          createdByEmail: existingTx?.createdByEmail,
          createdAtIso: existingTx?.createdAtIso,
          updatedByUid: user.uid,
          updatedByName: actorName,
          updatedByEmail: actorEmail,
          updatedAtIso: nowIso,
        },
      });
      const updatedTx: FinancialTransaction = {
        id: data.txId,
        ownerId: existingTx?.ownerId || effectiveVaultOwnerId,
        accountId: existingTx?.accountId || data.accountId,
        monthKey: data.date.slice(0, 7),
        txType: data.txType,
        source: existingTx?.source || 'manual',
        date: data.date,
        description: data.description,
        merchant: data.merchant,
        amount: data.amount,
        currency: account.currency,
        category: data.category,
        reference: data.reference,
        notes: data.notes,
        createdByUid: existingTx?.createdByUid,
        createdByName: existingTx?.createdByName,
        createdByEmail: existingTx?.createdByEmail,
        createdAtIso: existingTx?.createdAtIso,
        updatedByUid: user.uid,
        updatedByName: actorName,
        updatedByEmail: actorEmail,
        updatedAtIso: nowIso,
      };
      pendingTxMutationsRef.current.set(updatedTx.id, {
        type: 'upsert',
        tx: updatedTx,
        expiresAt: Date.now() + 15000,
      });
      setTransactions((prev) =>
        [
          updatedTx,
          ...prev.filter((t) => t.id !== updatedTx.id),
        ].sort(compareTransactionsByDateDesc)
      );
    } else {
      const createdTxId = await createEncryptedTransaction({
        uid: effectiveVaultOwnerId,
        sharedWithUids: writeSharedWithUids,
        vaultKey,
        account,
        txType: data.txType,
        source: 'manual',
        payload: {
          date: data.date,
          description: data.description,
          merchant: data.merchant,
          amount: data.amount,
          currency: account.currency,
          category: data.category,
          reference: data.reference,
          notes: data.notes,
          createdByUid: user.uid,
          createdByName: actorName,
          createdByEmail: actorEmail,
          createdAtIso: nowIso,
        },
      });
      const createdTx: FinancialTransaction = {
        id: createdTxId,
        ownerId: effectiveVaultOwnerId,
        accountId: data.accountId,
        monthKey: data.date.slice(0, 7),
        txType: data.txType,
        source: 'manual',
        date: data.date,
        description: data.description,
        merchant: data.merchant,
        amount: data.amount,
        currency: account.currency,
        category: data.category,
        reference: data.reference,
        notes: data.notes,
        createdByUid: user.uid,
        createdByName: actorName,
        createdByEmail: actorEmail,
        createdAtIso: nowIso,
      };
      pendingTxMutationsRef.current.set(createdTxId, {
        type: 'upsert',
        tx: createdTx,
        expiresAt: Date.now() + 15000,
      });
      setTransactions((prev) =>
        [
          createdTx,
          ...prev.filter((t) => t.id !== createdTxId),
        ].sort(compareTransactionsByDateDesc)
      );
      const delta = data.txType === 'income' ? data.amount : -data.amount;
      const updatedBalance = Number((account.balance + delta).toFixed(2));
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, balance: updatedBalance } : a))
      );
      setManualCreatedTick((n) => n + 1);
    }
  };

  const handleDeleteTransaction = async (txId: string): Promise<void> => {
    await deleteEncryptedTransaction(txId);
    pendingTxMutationsRef.current.set(txId, {
      type: 'delete',
      expiresAt: Date.now() + 15000,
    });
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
  };

  const handleBulkDeleteTransactions = async (txIds: string[]): Promise<number> => {
    const count = await batchDeleteEncryptedTransactions(txIds);
    const idSet = new Set(txIds);
    const expiresAt = Date.now() + 15000;
    for (const id of idSet) {
      pendingTxMutationsRef.current.set(id, { type: 'delete', expiresAt });
    }
    setTransactions((prev) => prev.filter((t) => !idSet.has(t.id)));
    return count;
  };

  const handleBulkUpdateTransactionsCategory = async (
    txIds: string[],
    newCategory: string
  ): Promise<number> => {
    if (!user || !vaultKey) {
      throw new Error(
        tr(
          'Brankas terkunci. Buka brankas terlebih dahulu.',
          'Vault is locked. Unlock the vault first.'
        )
      );
    }
    const targetSet = new Set(txIds);
    const matched = transactionsRef.current.filter((t) => targetSet.has(t.id));
    if (matched.length === 0) return 0;
    const actorName = profile?.displayName || user.displayName || user.email || tr('Pengguna', 'User');
    const actorEmail = (user.email || '').toLowerCase();
    const updatedCount = await batchUpdateEncryptedTransactionsCategory({
      vaultKey,
      transactions: matched,
      newCategory,
      actor: {
        uid: user.uid,
        name: actorName,
        email: actorEmail,
      },
    });
    const cleanCategory = newCategory.trim();
    const nowIso = new Date().toISOString();
    const expiresAt = Date.now() + 15000;
    const updatedById = new Map<string, FinancialTransaction>();
    for (const tx of matched) {
      const nextTx: FinancialTransaction = {
        ...tx,
        category: cleanCategory,
        updatedByUid: user.uid,
        updatedByName: actorName,
        updatedByEmail: actorEmail,
        updatedAtIso: nowIso,
      };
      updatedById.set(tx.id, nextTx);
      pendingTxMutationsRef.current.set(tx.id, {
        type: 'upsert',
        tx: nextTx,
        expiresAt,
      });
    }
    setTransactions((prev) =>
      prev.map((t) => updatedById.get(t.id) ?? t).sort(compareTransactionsByDateDesc)
    );
    return updatedCount;
  };

  const handleSavePreferences = async (prefs: {
    preferredCurrency: DisplayCurrency;
    aedToIdrRate: number;
    displayName: string;
  }) => {
    if (!user || !profile) return;
    await updateUserPreferences(user.uid, prefs);
    setProfile({
      ...profile,
      preferredCurrency: prefs.preferredCurrency,
      aedToIdrRate: prefs.aedToIdrRate,
      displayName: prefs.displayName,
    });
    setDisplayCurrency(prefs.preferredCurrency);
  };

  const handleCreateCustomCategory = async (
    rawName: string,
    categoryType: TransactionType = 'expense',
    appearance?: { icon?: string; color?: string }
  ): Promise<string> => {
    if (!user || !vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    const cleanName = rawName.trim().slice(0, 50);
    if (!cleanName) {
      throw new Error('Nama kategori tidak boleh kosong.');
    }
    const cleanKey = normalizeCategoryKey(cleanName);
    const { active: activeBuiltIns } = getResolvedBuiltInCategories(
      customCategories,
      categoryType
    );
    const registeredNames = [
      ...activeBuiltIns.map((b) => b.name),
      ...getPureCustomCategories(customCategories, categoryType).map((c) => c.name),
    ];
    const existing = registeredNames.find(
      (cat) => normalizeCategoryKey(cat) === cleanKey
    );
    if (existing) {
      return existing;
    }

    const deletedBuiltInOverride = customCategories.find(
      (c) =>
        c.systemKey &&
        c.deleted &&
        (normalizeCategoryKey(c.name) === cleanKey ||
          normalizeCategoryKey(c.systemKey) === cleanKey)
    );
    if (deletedBuiltInOverride && deletedBuiltInOverride.systemKey) {
      await upsertBuiltInCategoryOverride({
        uid: effectiveVaultOwnerId,
        sharedWithUids: writeSharedWithUids,
        vaultKey,
        existingOverrideId: deletedBuiltInOverride.id,
        systemKey: deletedBuiltInOverride.systemKey,
        categoryType,
        oldDisplayName: deletedBuiltInOverride.name,
        newDisplayName: cleanName,
        icon: appearance?.icon,
        color: appearance?.color,
        deleted: false,
        affectedTransactions: [],
        targetTransactionCategory: cleanName,
      });
      return cleanName;
    }

    await createEncryptedCustomCategory({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      name: cleanName,
      categoryType,
      icon: appearance?.icon,
      color: appearance?.color,
    });
    return cleanName;
  };

  const handleUpdateCustomCategory = async (
    category: CustomCategory,
    newName: string,
    appearance?: { icon?: string; color?: string }
  ): Promise<number> => {
    if (!vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    const cleanNewName = newName.trim().slice(0, 50);
    if (!cleanNewName) {
      throw new Error('Nama kategori tidak boleh kosong.');
    }
    return updateEncryptedCustomCategory({
      vaultKey,
      categoryId: category.id,
      oldName: category.name,
      newName: cleanNewName,
      categoryType: category.categoryType || 'expense',
      icon: appearance ? appearance.icon : category.icon,
      color: appearance ? appearance.color : category.color,
      systemKey: category.systemKey,
      affectedTransactions: transactionsRef.current,
    });
  };

  const handleDeleteCustomCategory = async (
    category: CustomCategory,
    fallbackCategory = 'Lainnya'
  ): Promise<number> => {
    if (!vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    return deleteEncryptedCustomCategory({
      vaultKey,
      categoryId: category.id,
      categoryName: category.name,
      categoryType: category.categoryType || 'expense',
      affectedTransactions: transactionsRef.current,
      fallbackCategory,
    });
  };

  const handleUpdateBuiltInCategory = async (
    item: ResolvedBuiltInCategory,
    newName: string,
    appearance?: { icon?: string; color?: string }
  ): Promise<number> => {
    if (!user || !vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    const cleanNewName = newName.trim().slice(0, 50);
    if (!cleanNewName) {
      throw new Error('Nama kategori tidak boleh kosong.');
    }
    return upsertBuiltInCategoryOverride({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      existingOverrideId: item.overrideDoc?.id,
      systemKey: item.systemKey,
      categoryType: item.categoryType,
      oldDisplayName: item.name,
      newDisplayName: cleanNewName,
      icon: appearance ? appearance.icon : item.icon,
      color: appearance ? appearance.color : item.color,
      deleted: false,
      affectedTransactions: transactionsRef.current,
      targetTransactionCategory: cleanNewName,
    });
  };

  const handleDeleteBuiltInCategory = async (
    item: ResolvedBuiltInCategory,
    fallbackCategory = 'Lainnya'
  ): Promise<number> => {
    if (!user || !vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    return upsertBuiltInCategoryOverride({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      existingOverrideId: item.overrideDoc?.id,
      systemKey: item.systemKey,
      categoryType: item.categoryType,
      oldDisplayName: item.name,
      newDisplayName: item.name,
      icon: item.icon,
      color: item.color,
      deleted: true,
      affectedTransactions: transactionsRef.current,
      targetTransactionCategory: fallbackCategory,
    });
  };

  const handleRenameUnlistedCategory = async (
    oldName: string,
    newName: string,
    categoryType: TransactionType = 'expense',
    appearance?: { icon?: string; color?: string }
  ): Promise<number> => {
    if (!user || !vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    const cleanNewName = newName.trim().slice(0, 50);
    if (!cleanNewName) {
      throw new Error('Nama kategori tidak boleh kosong.');
    }
    const cleanKey = normalizeCategoryKey(cleanNewName);
    const { active: activeBuiltIns } = getResolvedBuiltInCategories(
      customCategories,
      categoryType
    );
    const registeredNames = [
      ...activeBuiltIns.map((b) => b.name),
      ...getPureCustomCategories(customCategories, categoryType).map((c) => c.name),
    ];
    const existingRegistered = registeredNames.find(
      (cat) => normalizeCategoryKey(cat) === cleanKey
    );

    return renameOrMergeUnlistedCategory({
      uid: effectiveVaultOwnerId,
      sharedWithUids: writeSharedWithUids,
      vaultKey,
      oldName,
      newName: existingRegistered || cleanNewName,
      categoryType,
      icon: appearance?.icon,
      color: appearance?.color,
      createCategoryDoc: !existingRegistered,
      affectedTransactions: transactionsRef.current,
    });
  };

  const handleDeleteUnlistedCategory = async (
    categoryName: string,
    fallbackCategory = 'Lainnya',
    categoryType: TransactionType = 'expense'
  ): Promise<number> => {
    if (!vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    return deleteUnlistedTransactionCategory({
      vaultKey,
      categoryName,
      categoryType,
      fallbackCategory,
      affectedTransactions: transactionsRef.current,
    });
  };

  const handleRestoreBuiltInCategories = async (): Promise<number> => {
    if (!vaultKey) {
      throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
    }
    const overrideDocs = customCategories.filter((c) => Boolean(c.systemKey));
    return restoreBuiltInCategoryOverrides({
      vaultKey,
      overrideDocs,
      affectedTransactions: transactionsRef.current,
    });
  };

  const handleDeleteAllData = async (options: {
    includeAccounts: boolean;
    includeCategories: boolean;
  }) => {
    if (!user) {
      throw new Error('Silakan masuk terlebih dahulu.');
    }
    return deleteAllUserVaultData({
      uid: user.uid,
      includeAccounts: options.includeAccounts,
      includeCategories: options.includeCategories,
    });
  };

  const handleRotatePassphrase = async (currentPass: string, newPass: string) => {
    if (!user || !vaultConfig || !vaultKey) return;
    const verified = await unlockVaultWithPassphrase(vaultConfig, currentPass);
    if (!verified) {
      throw new Error('Frasa sandi saat ini tidak cocok.');
    }
    const newKey = await rotateVaultPassphrase({
      uid: user.uid,
      oldKey: vaultKey,
      newPassphrase: newPass,
      accounts,
      transactions,
      syncLogs,
      customCategories,
      budgets,
    });
    const refreshedCfg = await getVaultConfig(user.uid);
    setVaultConfig(refreshedCfg);
    setVaultKey(newKey);
    void exportVaultKeyToSession(user.uid, newKey);
  };

  const handleLockVault = () => {
    clearVaultKeySession(effectiveVaultOwnerId || user?.uid);
    setVaultKey(null);
  };

  const handleSignOut = async () => {
    if (user?.uid && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(`my_expenses_import_draft_${user.uid}`);
      window.sessionStorage.removeItem(`my_expenses_import_open_${user.uid}`);
      window.sessionStorage.removeItem(`my_expenses_active_vault_${user.uid}`);
    }
    clearVaultKeySession();
    await signOutAccount();
  };

  const handleAcceptShare = async (share: VaultShare) => {
    if (!user) return;
    await acceptVaultShareInvitation({
      share,
      memberUid: user.uid,
      memberEmail: user.email || '',
      memberDisplayName: profile?.displayName || user.displayName || user.email || 'Anggota',
    });
  };

  if (!user || !vaultKey || !profile) {
    return (
      <AuthAndVaultGate
        user={user}
        vaultConfig={vaultConfig}
        loadingAuth={loadingAuth}
        loadingConfig={loadingConfig}
        activeVaultOwnerId={effectiveVaultOwnerId}
        incomingShares={incomingShares}
        sharedMemberships={sharedMemberships}
        onSelectVault={(targetId) => void handleSelectVault(targetId)}
        onAcceptShare={handleAcceptShare}
        onUnlocked={async (key, isNewVault) => {
          const targetOwner = effectiveVaultOwnerId || user?.uid;
          if (user && targetOwner) {
            await exportVaultKeyToSession(targetOwner, key);
            if (isNewVault) {
              const cfg = await getVaultConfig(targetOwner);
              setVaultConfig(cfg);
            }
          }
          setVaultKey(key);
        }}
      />
    );
  }

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    label: lang === 'en' ? item.labelEn : item.labelId,
  }));

  const activeNavTitle =
    activeTab === 'insights'
      ? tr('Ringkasan / Insight Keuangan', 'Overview / Financial Insights')
      : activeTab === 'budgets'
        ? budgetFocusType === 'income'
          ? tr('Ringkasan / Budget Pemasukan', 'Overview / Income Budgets')
          : tr('Ringkasan / Budget Pengeluaran', 'Overview / Spending Budgets')
        : navItems.find((i) => i.id === activeTab)?.label || tr('Ringkasan', 'Overview');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070B12] text-slate-900 dark:text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
        />
      )}

      {/* Left Sidebar (256px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B111C] flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-16 px-6 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
              My Expenses
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label={tr('Tutup menu', 'Close menu')}
              className="lg:hidden p-1 text-slate-500 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id ||
                (item.id === 'dashboard' &&
                  (activeTab === 'insights' || activeTab === 'budgets'));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Active Vault & Family Sharing Button */}
          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setSharingModalOpen(true);
                setMobileMenuOpen(false);
              }}
              className={`w-full p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                isSharedVaultView
                  ? 'border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal-800 dark:text-teal-300">
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isSharedVaultView
                      ? tr('Brankas Bersama', 'Shared Vault')
                      : tr('Berbagi Brankas', 'Vault Sharing')}
                  </span>
                </span>
                {pendingIncomingCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold tabular-nums">
                    {pendingIncomingCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-1">
                {isSharedVaultView
                  ? `${activeVaultOwnerLabel} · ${activeVaultRole === 'editor' ? 'Editor' : 'Viewer'}`
                  : ownedShares.length > 0
                    ? tr(`Pribadi · ${ownedShares.length} anggota`, `Personal · ${ownedShares.length} members`)
                    : tr('Undang pasangan / multi-akun', 'Invite partner / multi-account')}
              </p>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5 px-2">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={profile.displayName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-teal-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                {profile.displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {profile.displayName}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {profile.email}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleLockVault}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{tr('Kunci', 'Lock')}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{tr('Keluar', 'Sign Out')}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="h-16 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B111C] px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={tr('Buka menu', 'Open menu')}
              className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E1523] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-400 hidden sm:inline">My Expenses</span>
              <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {activeNavTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {isSharedVaultView && (
              <button
                type="button"
                onClick={() => setSharingModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 cursor-pointer whitespace-nowrap"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="truncate max-w-[140px]">
                  {tr('Bersama', 'Shared')} · {activeVaultOwnerLabel}
                </span>
              </button>
            )}

            <div className="hidden xl:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mr-1">
              {isOnline ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {fromCache
                      ? tr('Sinkronisasi Cache', 'Synced (Cache)')
                      : tr('Tersinkron Lintas Perangkat', 'Synced Across Devices')}
                  </span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>{tr('Offline · Antrean Lokal', 'Offline · Local Queue')}</span>
                </>
              )}
            </div>

            <div
              role="group"
              aria-label={tr('Pilih bahasa', 'Select language')}
              className="inline-flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#0E1523]"
            >
              <button
                type="button"
                onClick={() => setLang('en')}
                aria-pressed={lang === 'en'}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  lang === 'en'
                    ? 'bg-emerald-500/20 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang('id')}
                aria-pressed={lang === 'id'}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  lang === 'id'
                    ? 'bg-emerald-500/20 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                ID
              </button>
            </div>

            <select
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
              aria-label={tr('Mata uang tampilan', 'Display currency')}
              className="px-3 py-1.5 text-xs font-mono font-semibold rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <option value="AED">AED</option>
              <option value="IDR">IDR</option>
              <option value="USD">USD</option>
            </select>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={tr('Ganti tema terang atau gelap', 'Toggle light or dark theme')}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1523] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {!isReadOnlyVault && (
              <button
                type="button"
                onClick={() => {
                  setEditingTx(null);
                  setTxModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 text-xs font-semibold shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{tr('Catat Transaksi', 'Add Transaction')}</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {bannerError && (
            <div className="mb-5 p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-4">
              <span>{bannerError}</span>
              <button
                type="button"
                onClick={() => setBannerError(null)}
                className="text-xs font-semibold underline cursor-pointer shrink-0"
              >
                {tr('Tutup', 'Close')}
              </button>
            </div>
          )}

          {isSharedVaultView && accounts.length === 0 && transactions.length === 0 && (
            <div className="mb-5 p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 flex flex-wrap items-center justify-between gap-3">
              <span>
                Belum ada data tersinkron di brankas bersama milik {activeVaultOwnerLabel}. Jika sebelumnya sudah ada transaksi, minta pemilik membuka aplikasinya sekali agar izin baca otomatis disinkronkan.
              </span>
              <button
                type="button"
                onClick={() => setSharingModalOpen(true)}
                className="text-xs font-semibold underline cursor-pointer shrink-0"
              >
                Kelola Brankas
              </button>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              accounts={accounts}
              transactions={transactions}
              customCategories={customCategories}
              budgets={budgets}
              displayCurrency={displayCurrency}
              aedToIdrRate={exchangeRates.ratesToIdr.AED}
              fxRates={exchangeRates.ratesToIdr}
              selectedMonth={selectedMonth}
              onSelectMonth={(monthKey) => {
                hasManuallySelectedMonthRef.current = true;
                setSelectedMonth(monthKey);
              }}
              onOpenNewTx={() => {
                if (isReadOnlyVault) return;
                setEditingTx(null);
                setTxModalOpen(true);
              }}
              onNavigate={(t) => setActiveTab(t)}
              onOpenBudgets={(bType) => {
                setBudgetFocusType(bType);
                setActiveTab('budgets');
              }}
              onOpenPdfImport={() => {
                if (!isReadOnlyVault) setImportModalOpen(true);
              }}
            />
          )}

          {activeTab === 'budgets' && (
            <BudgetsView
              transactions={transactions}
              customCategories={customCategories}
              budgets={budgets}
              displayCurrency={displayCurrency}
              aedToIdrRate={exchangeRates.ratesToIdr.AED}
              fxRates={exchangeRates.ratesToIdr}
              selectedMonth={selectedMonth}
              onSelectMonth={(monthKey) => {
                hasManuallySelectedMonthRef.current = true;
                setSelectedMonth(monthKey);
              }}
              onNavigate={(t) => setActiveTab(t)}
              initialBudgetType={budgetFocusType}
              onOpenBudgetManager={(bType) => {
                if (isReadOnlyVault) return;
                if (bType) setBudgetFocusType(bType);
                setBudgetModalOpen(true);
              }}
              readOnly={isReadOnlyVault}
              isSharedVault={isSharedVaultView}
              activeRole={activeVaultRole}
            />
          )}

          {activeTab === 'insights' && (
            <InsightsView
              accounts={accounts}
              transactions={transactions}
              customCategories={customCategories}
              displayCurrency={displayCurrency}
              aedToIdrRate={exchangeRates.ratesToIdr.AED}
              fxRates={exchangeRates.ratesToIdr}
              selectedMonth={selectedMonth}
              onSelectMonth={(monthKey) => {
                hasManuallySelectedMonthRef.current = true;
                setSelectedMonth(monthKey);
              }}
              onNavigate={(t) => setActiveTab(t)}
              onOpenNewTx={() => {
                if (isReadOnlyVault) return;
                setEditingTx(null);
                setTxModalOpen(true);
              }}
              onOpenPdfImport={() => {
                if (!isReadOnlyVault) setImportModalOpen(true);
              }}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsView
              accounts={accounts}
              transactions={transactions}
              syncLogs={syncLogs}
              categories={availableCategories}
              expenseCategories={expenseCategories}
              incomeCategories={incomeCategories}
              customCategories={customCategories}
              displayCurrency={displayCurrency}
              aedToIdrRate={exchangeRates.ratesToIdr.AED}
              fxRates={exchangeRates.ratesToIdr}
              userName={profile.displayName}
              onOpenNewTx={() => {
                if (isReadOnlyVault) return;
                setEditingTx(null);
                setTxModalOpen(true);
              }}
              onEditTx={(tx) => {
                if (isReadOnlyVault) return;
                setEditingTx(tx);
                setTxModalOpen(true);
              }}
              onDeleteTx={handleDeleteTransaction}
              onBulkDeleteTx={handleBulkDeleteTransactions}
              onBulkUpdateCategory={handleBulkUpdateTransactionsCategory}
              onCreateCategory={handleCreateCustomCategory}
              onUpdateCategory={handleUpdateCustomCategory}
              onDeleteCategory={handleDeleteCustomCategory}
              onUpdateBuiltInCategory={handleUpdateBuiltInCategory}
              onDeleteBuiltInCategory={handleDeleteBuiltInCategory}
              onRenameUnlistedCategory={handleRenameUnlistedCategory}
              onDeleteUnlistedCategory={handleDeleteUnlistedCategory}
              onRestoreBuiltInCategories={handleRestoreBuiltInCategories}
              onOpenImportModal={() => {
                if (!isReadOnlyVault) setImportModalOpen(true);
              }}
              manualCreatedTick={manualCreatedTick}
              readOnly={isReadOnlyVault}
            />
          )}

          {activeTab === 'accounts' && (
            <AdcbAccountsView
              accounts={accounts}
              transactions={transactions}
              onUpdateAccount={handleUpdateAccount}
              onCreateManualAccount={handleCreateManualAccount}
              onDeleteAccount={deleteEncryptedAccount}
              readOnly={isReadOnlyVault}
            />
          )}

          {activeTab === 'export' && (
            <ExportVaultView
              profile={{ ...profile, preferredCurrency: displayCurrency }}
              exchangeRates={exchangeRates}
              refreshingRates={refreshingRates}
              onRefreshExchangeRates={() => refreshExchangeRates(true)}
              accounts={accounts}
              transactions={transactions}
              syncLogsCount={syncLogs.length}
              onSavePreferences={handleSavePreferences}
              onRotatePassphrase={handleRotatePassphrase}
              onDeleteAllData={handleDeleteAllData}
              onLockVault={handleLockVault}
              isSharedVaultView={isSharedVaultView}
              activeVaultOwnerLabel={activeVaultOwnerLabel}
              activeVaultRole={activeVaultRole}
              ownedSharesCount={ownedShares.filter((s) => s.status === 'active').length}
              pendingIncomingCount={pendingIncomingCount}
              onOpenSharingModal={() => setSharingModalOpen(true)}
            />
          )}
        </main>
      </div>

      <TransactionModal
        isOpen={txModalOpen}
        accounts={accounts}
        expenseCategories={expenseCategories}
        incomeCategories={incomeCategories}
        customCategories={customCategories}
        editingTx={editingTx}
        onCreateCategory={handleCreateCustomCategory}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        onSubmit={handleSaveTransaction}
      />

      <PdfImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        accounts={accounts}
        existingTransactions={transactions}
        expenseCategories={expenseCategories}
        incomeCategories={incomeCategories}
        customCategories={customCategories}
        customCategoryNames={getPureCustomCategories(customCategories).map((c) => c.name)}
        draftStorageKey={`my_expenses_import_draft_${user.uid}`}
        onSessionKeepAlive={keepSessionActive}
        onCreateCategory={handleCreateCustomCategory}
        onImportConfirm={handleImportPdfConfirm}
      />

      <BudgetManagerModal
        isOpen={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        budgets={budgets}
        transactions={transactions}
        customCategories={customCategories}
        displayCurrency={displayCurrency}
        rateInput={exchangeRates.ratesToIdr}
        activeMonth={selectedMonth}
        initialBudgetType={budgetFocusType}
        readOnly={isReadOnlyVault}
        onSaveBudgets={async (entries) => {
          if (!user || !vaultKey || !effectiveVaultOwnerId) {
            throw new Error('Brankas terkunci. Buka brankas terlebih dahulu.');
          }
          await saveCategoryBudgetsBatch({
            uid: effectiveVaultOwnerId,
            sharedWithUids: writeSharedWithUids,
            vaultKey,
            existingBudgets: budgets,
            entries,
          });
        }}
      />

      <VaultSharingModal
        isOpen={sharingModalOpen}
        onClose={() => setSharingModalOpen(false)}
        currentUserUid={user.uid}
        currentUserEmail={profile.email}
        activeVaultOwnerId={effectiveVaultOwnerId}
        ownedShares={ownedShares}
        incomingShares={incomingShares}
        sharedMemberships={sharedMemberships}
        onInviteMember={async (memberEmail, role) => {
          await inviteVaultMember({
            ownerUid: user.uid,
            ownerEmail: profile.email,
            ownerDisplayName: profile.displayName,
            memberEmail,
            role,
          });
        }}
        onAcceptShare={handleAcceptShare}
        onUpdateRole={async (share, role) => {
          await updateVaultMemberRole({
            shareId: share.id,
            vaultOwnerId: share.vaultOwnerId,
            memberUid: share.memberUid || undefined,
            role,
          });
        }}
        onRevokeShare={async (share) => {
          const remaining = ownedShares
            .filter((s) => s.id !== share.id && s.status === 'active' && s.memberUid)
            .map((s) => s.memberUid);
          await revokeVaultShare({
            share,
            remainingActiveMemberUids: remaining,
          });
        }}
        onSwitchVault={(targetId) => void handleSelectVault(targetId)}
        onLeaveSharedVault={async (membership) => {
          await leaveSharedVault({
            vaultOwnerId: membership.vaultOwnerId,
            memberUid: user.uid,
            shareId: membership.shareId,
          });
          if (effectiveVaultOwnerId === membership.vaultOwnerId) {
            await handleSelectVault(user.uid);
          }
        }}
      />
    </div>
  );
}
