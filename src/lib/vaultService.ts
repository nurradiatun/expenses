import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  compareTransactionsByDateDesc,
  normalizeCategoryKey,
  type AccountProvider,
  type CategoryBudget,
  type CustomCategory,
  type DecryptedAccountPayload,
  type DecryptedBudgetPayload,
  type DecryptedCustomCategoryPayload,
  type DecryptedTransactionPayload,
  type DisplayCurrency,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
  type SyncLogEntry,
  type TransactionSource,
  type TransactionType,
  type UserProfile,
  type VaultConfigDoc,
  type VaultMember,
  type VaultShare,
  type VaultShareRole,
} from '../types';
import {
  createKeyVerificationToken,
  decryptPayload,
  DEFAULT_KDF_ITERATIONS,
  deriveVaultKey,
  encryptPayload,
  generateRandomSaltBase64,
  verifyVaultKey,
} from './crypto';
import { db, handleFirestoreError, OperationType } from './firebase';
import { DEFAULT_AED_TO_IDR_RATE } from './formatters';

function normalizeSharedUids(
  vaultOwnerId: string,
  sharedWithUids?: string[]
): string[] | undefined {
  if (!sharedWithUids || sharedWithUids.length === 0) return undefined;
  const unique = Array.from(
    new Set([vaultOwnerId, ...sharedWithUids.filter((id) => Boolean(id && id.trim()))])
  ).slice(0, 10);
  return unique.length > 1 ? unique : undefined;
}

function buildTxPayloadWithHistory(
  tx: FinancialTransaction,
  overrides: Partial<DecryptedTransactionPayload> = {}
): DecryptedTransactionPayload {
  return {
    date: overrides.date ?? tx.date,
    description: overrides.description ?? tx.description,
    merchant: overrides.merchant ?? tx.merchant,
    amount: overrides.amount ?? tx.amount,
    currency: overrides.currency ?? tx.currency,
    category: overrides.category ?? tx.category,
    reference: overrides.reference ?? tx.reference,
    notes: overrides.notes ?? tx.notes,
    ...(overrides.createdByUid ?? tx.createdByUid
      ? { createdByUid: overrides.createdByUid ?? tx.createdByUid }
      : {}),
    ...(overrides.createdByName ?? tx.createdByName
      ? { createdByName: overrides.createdByName ?? tx.createdByName }
      : {}),
    ...(overrides.createdByEmail ?? tx.createdByEmail
      ? { createdByEmail: overrides.createdByEmail ?? tx.createdByEmail }
      : {}),
    ...(overrides.createdAtIso ?? tx.createdAtIso
      ? { createdAtIso: overrides.createdAtIso ?? tx.createdAtIso }
      : {}),
    ...(overrides.updatedByUid ?? tx.updatedByUid
      ? { updatedByUid: overrides.updatedByUid ?? tx.updatedByUid }
      : {}),
    ...(overrides.updatedByName ?? tx.updatedByName
      ? { updatedByName: overrides.updatedByName ?? tx.updatedByName }
      : {}),
    ...(overrides.updatedByEmail ?? tx.updatedByEmail
      ? { updatedByEmail: overrides.updatedByEmail ?? tx.updatedByEmail }
      : {}),
    ...(overrides.updatedAtIso ?? tx.updatedAtIso
      ? { updatedAtIso: overrides.updatedAtIso ?? tx.updatedAtIso }
      : {}),
  };
}

function newDocId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${rand}`;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
        preferredCurrency: data.preferredCurrency || 'AED',
        aedToIdrRate: Number(data.aedToIdrRate) || DEFAULT_AED_TO_IDR_RATE,
      };
    }

    const displayName = (user.displayName || user.email?.split('@')[0] || 'Pengguna My Expenses').slice(0, 120);
    const email = (user.email || 'user@myexpenses.app').slice(0, 254);

    await setDoc(ref, {
      uid: user.uid,
      email,
      displayName,
      preferredCurrency: 'AED',
      aedToIdrRate: DEFAULT_AED_TO_IDR_RATE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      uid: user.uid,
      email,
      displayName,
      preferredCurrency: 'AED',
      aedToIdrRate: DEFAULT_AED_TO_IDR_RATE,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: { preferredCurrency: DisplayCurrency; aedToIdrRate: number; displayName: string }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      preferredCurrency: updates.preferredCurrency,
      aedToIdrRate: updates.aedToIdrRate,
      displayName: updates.displayName.slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getVaultConfig(uid: string): Promise<VaultConfigDoc | null> {
  const path = `users/${uid}/vaultConfig/main`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'vaultConfig', 'main'));
    if (!snap.exists()) return null;
    return snap.data() as VaultConfigDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createVaultWithPassphrase(
  uid: string,
  passphrase: string
): Promise<CryptoKey> {
  const path = `users/${uid}/vaultConfig/main`;
  try {
    const salt = generateRandomSaltBase64();
    const key = await deriveVaultKey(passphrase, salt, DEFAULT_KDF_ITERATIONS);
    const { keyCheckCiphertext, keyCheckIv } = await createKeyVerificationToken(key);

    await setDoc(doc(db, 'users', uid, 'vaultConfig', 'main'), {
      ownerId: uid,
      salt,
      kdfIterations: DEFAULT_KDF_ITERATIONS,
      keyCheckCiphertext,
      keyCheckIv,
      algorithm: 'AES-GCM-256',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return key;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function unlockVaultWithPassphrase(
  config: VaultConfigDoc,
  passphrase: string
): Promise<CryptoKey | null> {
  const key = await deriveVaultKey(passphrase, config.salt, config.kdfIterations);
  const valid = await verifyVaultKey(key, config.keyCheckCiphertext, config.keyCheckIv);
  return valid ? key : null;
}

export async function rotateVaultPassphrase(params: {
  uid: string;
  oldKey: CryptoKey;
  newPassphrase: string;
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  syncLogs: SyncLogEntry[];
  customCategories?: CustomCategory[];
  budgets?: CategoryBudget[];
}): Promise<CryptoKey> {
  const {
    uid,
    newPassphrase,
    accounts,
    transactions,
    syncLogs,
    customCategories = [],
    budgets = [],
  } = params;
  const newSalt = generateRandomSaltBase64();
  const newKey = await deriveVaultKey(newPassphrase, newSalt, DEFAULT_KDF_ITERATIONS);
  const { keyCheckCiphertext, keyCheckIv } = await createKeyVerificationToken(newKey);

  try {
    // Re-encrypt all items in batches of 400
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => Promise<void>> = [];

    for (const acc of accounts) {
      ops.push(async (batch) => {
        const enc = await encryptPayload<DecryptedAccountPayload>(newKey, {
          name: acc.name,
          accountNumberMasked: acc.accountNumberMasked,
          balance: acc.balance,
          institution: acc.institution,
          notes: acc.notes,
          adcbConnectionRef: acc.adcbConnectionRef,
          adcbProduct: acc.adcbProduct,
        });
        batch.update(doc(db, 'accounts', acc.id), {
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (const tx of transactions) {
      ops.push(async (batch) => {
        const enc = await encryptPayload<DecryptedTransactionPayload>(
          newKey,
          buildTxPayloadWithHistory(tx)
        );
        batch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (const cat of customCategories) {
      ops.push(async (batch) => {
        const enc = await encryptPayload<DecryptedCustomCategoryPayload>(newKey, {
          name: cat.name,
          ...(cat.categoryType ? { categoryType: cat.categoryType } : {}),
          ...(cat.icon ? { icon: cat.icon } : {}),
          ...(cat.color ? { color: cat.color } : {}),
          ...(cat.systemKey ? { systemKey: cat.systemKey } : {}),
          ...(cat.deleted ? { deleted: true } : {}),
        });
        batch.update(doc(db, 'categories', cat.id), {
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (const b of budgets) {
      ops.push(async (batch) => {
        const enc = await encryptPayload<DecryptedBudgetPayload>(newKey, {
          category: b.category,
          monthlyLimit: b.monthlyLimit,
          currency: b.currency,
          periodMonths: b.periodMonths || 1,
          ...(b.anchorMonth ? { anchorMonth: b.anchorMonth } : {}),
        });
        batch.update(doc(db, 'budgets', b.id), {
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          updatedAt: serverTimestamp(),
        });
      });
    }

    // Also update vaultConfig first
    await updateDoc(doc(db, 'users', uid, 'vaultConfig', 'main'), {
      salt: newSalt,
      kdfIterations: DEFAULT_KDF_ITERATIONS,
      keyCheckCiphertext,
      keyCheckIv,
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = ops.slice(i, i + 400);
      await Promise.all(chunk.map((fn) => fn(batch)));
      await batch.commit();
    }

    void syncLogs;
    return newKey;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}/vaultConfig/main`);
  }
}

export function subscribeEncryptedAccounts(
  vaultOwnerId: string,
  vaultKey: CryptoKey,
  onData: (accounts: FinancialAccount[], fromCache: boolean) => void,
  onError: (err: Error) => void,
  viewerUid: string = vaultOwnerId
) {
  const isSharedView = vaultOwnerId !== viewerUid;
  const q = isSharedView
    ? query(collection(db, 'accounts'), where('sharedWithUids', 'array-contains', viewerUid))
    : query(collection(db, 'accounts'), where('ownerId', '==', vaultOwnerId));
  let latestSeq = 0;
  let active = true;
  const unsub = onSnapshot(
    q,
    { includeMetadataChanges: true },
    async (snapshot) => {
      const seq = ++latestSeq;
      try {
        const items = await Promise.all(
          snapshot.docs.map(async (d): Promise<FinancialAccount | null> => {
            const raw = d.data();
            if (raw.ownerId !== vaultOwnerId) return null;
            try {
              const payload = await decryptPayload<DecryptedAccountPayload>(
                vaultKey,
                raw.encryptedPayload,
                raw.iv
              );
              return {
                id: d.id,
                ownerId: raw.ownerId,
                provider: raw.provider,
                currency: raw.currency,
                autoSyncDaily: Boolean(raw.autoSyncDaily),
                syncHour: Number(raw.syncHour ?? 6),
                lastSyncedAtIso: raw.lastSyncedAtIso || '',
                name: payload.name,
                accountNumberMasked: payload.accountNumberMasked,
                balance: Number(payload.balance) || 0,
                institution: payload.institution,
                notes: payload.notes || '',
                adcbConnectionRef: payload.adcbConnectionRef,
                adcbProduct: payload.adcbProduct,
              };
            } catch (decErr) {
              console.warn('Could not decrypt account', d.id, decErr);
              return null;
            }
          })
        );
        if (!active || seq !== latestSeq) return;
        const decrypted = items.filter((item): item is FinancialAccount => item !== null);
        decrypted.sort((a, b) => a.name.localeCompare(b.name));
        onData(decrypted, snapshot.metadata.fromCache);
      } catch (err) {
        if (!active || seq !== latestSeq) return;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'accounts');
      } catch (err) {
        if (active) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  );
  return () => {
    active = false;
    unsub();
  };
}

export function subscribeEncryptedTransactions(
  vaultOwnerId: string,
  vaultKey: CryptoKey,
  onData: (transactions: FinancialTransaction[], fromCache: boolean) => void,
  onError: (err: Error) => void,
  viewerUid: string = vaultOwnerId
) {
  const isSharedView = vaultOwnerId !== viewerUid;
  const q = isSharedView
    ? query(collection(db, 'transactions'), where('sharedWithUids', 'array-contains', viewerUid))
    : query(collection(db, 'transactions'), where('ownerId', '==', vaultOwnerId));
  let latestSeq = 0;
  let active = true;
  const unsub = onSnapshot(
    q,
    { includeMetadataChanges: true },
    async (snapshot) => {
      const seq = ++latestSeq;
      try {
        const items = await Promise.all(
          snapshot.docs.map(async (d): Promise<FinancialTransaction | null> => {
            const raw = d.data();
            if (raw.ownerId !== vaultOwnerId) return null;
            try {
              const payload = await decryptPayload<DecryptedTransactionPayload>(
                vaultKey,
                raw.encryptedPayload,
                raw.iv
              );
              return {
                id: d.id,
                ownerId: raw.ownerId,
                accountId: raw.accountId,
                monthKey: raw.monthKey,
                txType: raw.txType,
                source: raw.source,
                date: payload.date,
                description: payload.description,
                merchant: payload.merchant,
                amount: Number(payload.amount) || 0,
                currency: payload.currency,
                category: payload.category,
                reference: payload.reference || '',
                notes: payload.notes || '',
                createdByUid: payload.createdByUid,
                createdByName: payload.createdByName,
                createdByEmail: payload.createdByEmail,
                createdAtIso: payload.createdAtIso,
                updatedByUid: payload.updatedByUid,
                updatedByName: payload.updatedByName,
                updatedByEmail: payload.updatedByEmail,
                updatedAtIso: payload.updatedAtIso,
              };
            } catch (decErr) {
              console.warn('Could not decrypt transaction', d.id, decErr);
              return null;
            }
          })
        );
        if (!active || seq !== latestSeq) return;
        const decrypted = items.filter((item): item is FinancialTransaction => item !== null);
        decrypted.sort(compareTransactionsByDateDesc);
        onData(decrypted, snapshot.metadata.fromCache);
      } catch (err) {
        if (!active || seq !== latestSeq) return;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'transactions');
      } catch (err) {
        if (active) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  );
  return () => {
    active = false;
    unsub();
  };
}

export function subscribeEncryptedSyncLogs(
  vaultOwnerId: string,
  vaultKey: CryptoKey,
  onData: (logs: SyncLogEntry[]) => void,
  viewerUid: string = vaultOwnerId
) {
  const isSharedView = vaultOwnerId !== viewerUid;
  const q = isSharedView
    ? query(collection(db, 'syncLogs'), where('sharedWithUids', 'array-contains', viewerUid))
    : query(collection(db, 'syncLogs'), where('ownerId', '==', vaultOwnerId));
  return onSnapshot(
    q,
    async (snapshot) => {
      const logs: SyncLogEntry[] = [];
      for (const d of snapshot.docs) {
        const raw = d.data();
        if (raw.ownerId !== vaultOwnerId) continue;
        try {
          const payload = await decryptPayload<{ summary: string; createdAtIso: string }>(
            vaultKey,
            raw.encryptedSummary,
            raw.iv
          );
          logs.push({
            id: d.id,
            ownerId: raw.ownerId,
            accountId: raw.accountId,
            syncType: raw.syncType,
            status: raw.status,
            recordsCount: Number(raw.recordsCount) || 0,
            summary: payload.summary,
            createdAtIso: payload.createdAtIso,
          });
        } catch {
          // Ignore undecryptable log
        }
      }
      logs.sort((a, b) => (a.createdAtIso < b.createdAtIso ? 1 : -1));
      onData(logs);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'syncLogs');
    }
  );
}

export async function createEncryptedAccount(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  provider: AccountProvider;
  currency: SupportedCurrency;
  autoSyncDaily: boolean;
  syncHour: number;
  lastSyncedAtIso?: string;
  payload: DecryptedAccountPayload;
}): Promise<string> {
  const { uid, sharedWithUids, vaultKey, provider, currency, autoSyncDaily, syncHour, lastSyncedAtIso, payload } = params;
  const id = newDocId('acc');
  const path = `accounts/${id}`;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);
  try {
    const enc = await encryptPayload(vaultKey, payload);
    await setDoc(doc(db, 'accounts', id), {
      ownerId: uid,
      ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
      provider,
      currency,
      autoSyncDaily,
      syncHour,
      lastSyncedAtIso: lastSyncedAtIso || new Date().toISOString(),
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateEncryptedAccount(params: {
  vaultKey: CryptoKey;
  accountId: string;
  autoSyncDaily: boolean;
  syncHour: number;
  lastSyncedAtIso: string;
  payload: DecryptedAccountPayload;
}): Promise<void> {
  const { vaultKey, accountId, autoSyncDaily, syncHour, lastSyncedAtIso, payload } = params;
  const path = `accounts/${accountId}`;
  try {
    const enc = await encryptPayload(vaultKey, payload);
    await updateDoc(doc(db, 'accounts', accountId), {
      autoSyncDaily,
      syncHour,
      lastSyncedAtIso,
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateEncryptedAccountDetails(params: {
  vaultKey: CryptoKey;
  account: FinancialAccount;
  provider: AccountProvider;
  currency: SupportedCurrency;
  autoSyncDaily: boolean;
  syncHour: number;
  payload: DecryptedAccountPayload;
  affectedTransactions?: FinancialTransaction[];
}): Promise<number> {
  const {
    vaultKey,
    account,
    provider,
    currency,
    autoSyncDaily,
    syncHour,
    payload,
    affectedTransactions = [],
  } = params;
  const path = `accounts/${account.id}`;
  try {
    const enc = await encryptPayload(vaultKey, payload);
    const currencyChanged = currency !== account.currency;
    const matchingTxs = currencyChanged
      ? affectedTransactions.filter((tx) => tx.accountId === account.id)
      : [];

    const batch = writeBatch(db);
    batch.update(doc(db, 'accounts', account.id), {
      provider,
      currency,
      autoSyncDaily,
      syncHour,
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      updatedAt: serverTimestamp(),
    });

    const firstChunk = matchingTxs.slice(0, 350);
    for (const tx of firstChunk) {
      const txEnc = await encryptPayload<DecryptedTransactionPayload>(
        vaultKey,
        buildTxPayloadWithHistory(tx, { currency })
      );
      batch.update(doc(db, 'transactions', tx.id), {
        encryptedPayload: txEnc.encryptedPayload,
        iv: txEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    for (let i = 350; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const nextBatch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { currency })
        );
        nextBatch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteEncryptedAccount(accountId: string): Promise<void> {
  const path = `accounts/${accountId}`;
  try {
    await deleteDoc(doc(db, 'accounts', accountId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createEncryptedTransaction(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  account: FinancialAccount;
  txType: TransactionType;
  source: TransactionSource;
  payload: DecryptedTransactionPayload;
  adjustAccountBalance?: boolean;
}): Promise<string> {
  const {
    uid,
    sharedWithUids,
    vaultKey,
    account,
    txType,
    source,
    payload,
    adjustAccountBalance = true,
  } = params;
  const id = newDocId('tx');
  const monthKey = payload.date.slice(0, 7);
  const path = `transactions/${id}`;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);

  try {
    const enc = await encryptPayload(vaultKey, payload);
    const batch = writeBatch(db);

    batch.set(doc(db, 'transactions', id), {
      ownerId: uid,
      ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
      accountId: account.id,
      monthKey,
      txType,
      source,
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (adjustAccountBalance) {
      const delta = txType === 'income' ? payload.amount : -payload.amount;
      const updatedBalance = Number((account.balance + delta).toFixed(2));
      const accEnc = await encryptPayload<DecryptedAccountPayload>(vaultKey, {
        name: account.name,
        accountNumberMasked: account.accountNumberMasked,
        balance: updatedBalance,
        institution: account.institution,
        notes: account.notes,
        adcbConnectionRef: account.adcbConnectionRef,
        adcbProduct: account.adcbProduct,
      });
      batch.update(doc(db, 'accounts', account.id), {
        encryptedPayload: accEnc.encryptedPayload,
        iv: accEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateEncryptedTransaction(params: {
  vaultKey: CryptoKey;
  txId: string;
  txType: TransactionType;
  payload: DecryptedTransactionPayload;
}): Promise<void> {
  const { vaultKey, txId, txType, payload } = params;
  const path = `transactions/${txId}`;
  try {
    const enc = await encryptPayload(vaultKey, payload);
    await updateDoc(doc(db, 'transactions', txId), {
      monthKey: payload.date.slice(0, 7),
      txType,
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteEncryptedTransaction(txId: string): Promise<void> {
  const path = `transactions/${txId}`;
  try {
    await deleteDoc(doc(db, 'transactions', txId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchDeleteEncryptedTransactions(txIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(txIds.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;
  try {
    for (let i = 0; i < uniqueIds.length; i += 400) {
      const chunk = uniqueIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'transactions', id));
      }
      await batch.commit();
    }
    return uniqueIds.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'transactions');
  }
}

export async function batchUpdateEncryptedTransactionsCategory(params: {
  vaultKey: CryptoKey;
  transactions: FinancialTransaction[];
  newCategory: string;
  actor?: { uid: string; name: string; email: string };
}): Promise<number> {
  const { vaultKey, transactions, newCategory, actor } = params;
  const cleanCategory = newCategory.trim();
  if (!cleanCategory || transactions.length === 0) return 0;
  const nowIso = new Date().toISOString();
  try {
    for (let i = 0; i < transactions.length; i += 350) {
      const chunk = transactions.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const tx of chunk) {
        const enc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, {
            category: cleanCategory,
            ...(actor
              ? {
                  updatedByUid: actor.uid,
                  updatedByName: actor.name,
                  updatedByEmail: actor.email,
                  updatedAtIso: nowIso,
                }
              : {}),
          })
        );
        batch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return transactions.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'transactions');
  }
}

export async function batchImportEncryptedTransactions(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  account: FinancialAccount;
  source: TransactionSource;
  items: Array<{
    txType: TransactionType;
    payload: DecryptedTransactionPayload;
  }>;
  newClosingBalance?: number;
  logSummary: string;
  syncType: 'adcb_daily' | 'adcb_manual' | 'pdf_import';
  syncedAtIso?: string;
}): Promise<number> {
  const {
    uid,
    sharedWithUids,
    vaultKey,
    account,
    source,
    items,
    newClosingBalance,
    logSummary,
    syncType,
    syncedAtIso,
  } = params;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);
  try {
    for (let i = 0; i < items.length; i += 350) {
      const chunk = items.slice(i, i + 350);
      const batch = writeBatch(db);

      for (const item of chunk) {
        const id = newDocId('tx');
        const enc = await encryptPayload(vaultKey, item.payload);
        batch.set(doc(db, 'transactions', id), {
          ownerId: uid,
          ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
          accountId: account.id,
          monthKey: item.payload.date.slice(0, 7),
          txType: item.txType,
          source,
          encryptedPayload: enc.encryptedPayload,
          iv: enc.iv,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (i === 0) {
        const updatedBal =
          typeof newClosingBalance === 'number' ? newClosingBalance : account.balance;
        const accEnc = await encryptPayload<DecryptedAccountPayload>(vaultKey, {
          name: account.name,
          accountNumberMasked: account.accountNumberMasked,
          balance: updatedBal,
          institution: account.institution,
          notes: account.notes,
          adcbConnectionRef: account.adcbConnectionRef,
          adcbProduct: account.adcbProduct,
        });
        batch.update(doc(db, 'accounts', account.id), {
          lastSyncedAtIso: syncedAtIso || new Date().toISOString(),
          encryptedPayload: accEnc.encryptedPayload,
          iv: accEnc.iv,
          updatedAt: serverTimestamp(),
        });

        const logId = newDocId('log');
        const logEnc = await encryptPayload(vaultKey, {
          summary: logSummary,
          createdAtIso: new Date().toISOString(),
        });
        batch.set(doc(db, 'syncLogs', logId), {
          ownerId: uid,
          ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
          accountId: account.id,
          syncType,
          status: 'success',
          recordsCount: items.length,
          encryptedSummary: logEnc.encryptedPayload,
          iv: logEnc.iv,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    if (items.length === 0) {
      const batch = writeBatch(db);
      const updatedBal =
        typeof newClosingBalance === 'number' ? newClosingBalance : account.balance;
      const accEnc = await encryptPayload<DecryptedAccountPayload>(vaultKey, {
        name: account.name,
        accountNumberMasked: account.accountNumberMasked,
        balance: updatedBal,
        institution: account.institution,
        notes: account.notes,
        adcbConnectionRef: account.adcbConnectionRef,
        adcbProduct: account.adcbProduct,
      });
      batch.update(doc(db, 'accounts', account.id), {
        lastSyncedAtIso: syncedAtIso || new Date().toISOString(),
        encryptedPayload: accEnc.encryptedPayload,
        iv: accEnc.iv,
        updatedAt: serverTimestamp(),
      });

      const logId = newDocId('log');
      const logEnc = await encryptPayload(vaultKey, {
        summary: logSummary,
        createdAtIso: new Date().toISOString(),
      });
      batch.set(doc(db, 'syncLogs', logId), {
        ownerId: uid,
        ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
        accountId: account.id,
        syncType,
        status: 'success',
        recordsCount: 0,
        encryptedSummary: logEnc.encryptedPayload,
        iv: logEnc.iv,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
    }

    return items.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'transactions');
  }
}

export function subscribeEncryptedCategories(
  vaultOwnerId: string,
  vaultKey: CryptoKey,
  onData: (categories: CustomCategory[]) => void,
  onError: (err: Error) => void,
  viewerUid: string = vaultOwnerId
) {
  const isSharedView = vaultOwnerId !== viewerUid;
  const q = isSharedView
    ? query(collection(db, 'categories'), where('sharedWithUids', 'array-contains', viewerUid))
    : query(collection(db, 'categories'), where('ownerId', '==', vaultOwnerId));
  return onSnapshot(
    q,
    async (snapshot) => {
      try {
        const decrypted: CustomCategory[] = [];
        for (const d of snapshot.docs) {
          const raw = d.data();
          if (raw.ownerId !== vaultOwnerId) continue;
          try {
            const payload = await decryptPayload<DecryptedCustomCategoryPayload>(
              vaultKey,
              raw.encryptedPayload,
              raw.iv
            );
            if (payload.name && payload.name.trim()) {
              decrypted.push({
                id: d.id,
                ownerId: raw.ownerId,
                name: payload.name.trim().slice(0, 50),
                categoryType:
                  payload.categoryType === 'income'
                    ? 'income'
                    : payload.categoryType === 'expense'
                      ? 'expense'
                      : undefined,
                icon: typeof payload.icon === 'string' && payload.icon.trim() ? payload.icon.trim() : undefined,
                color: typeof payload.color === 'string' && payload.color.trim() ? payload.color.trim() : undefined,
                systemKey: payload.systemKey,
                deleted: Boolean(payload.deleted),
              });
            }
          } catch (decErr) {
            console.warn('Could not decrypt custom category', d.id, decErr);
          }
        }
        decrypted.sort((a, b) => a.name.localeCompare(b.name));
        onData(decrypted);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'categories');
    }
  );
}

export async function createEncryptedCustomCategory(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  name: string;
  categoryType?: TransactionType;
  icon?: string;
  color?: string;
}): Promise<string> {
  const { uid, sharedWithUids, vaultKey, name, categoryType = 'expense', icon, color } = params;
  const cleanName = name.trim().slice(0, 50);
  const id = newDocId('cat');
  const path = `categories/${id}`;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);
  try {
    const enc = await encryptPayload<DecryptedCustomCategoryPayload>(vaultKey, {
      name: cleanName,
      categoryType,
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
    });
    await setDoc(doc(db, 'categories', id), {
      ownerId: uid,
      ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateEncryptedCustomCategory(params: {
  vaultKey: CryptoKey;
  categoryId: string;
  oldName: string;
  newName: string;
  categoryType?: TransactionType;
  icon?: string;
  color?: string;
  systemKey?: string;
  affectedTransactions: FinancialTransaction[];
}): Promise<number> {
  const {
    vaultKey,
    categoryId,
    oldName,
    newName,
    categoryType,
    icon,
    color,
    systemKey,
    affectedTransactions,
  } = params;
  const cleanNewName = newName.trim().slice(0, 50);
  const path = `categories/${categoryId}`;
  try {
    const targetKey = normalizeCategoryKey(oldName);
    const nameChanged = normalizeCategoryKey(cleanNewName) !== targetKey;
    const matchingTxs = nameChanged
      ? affectedTransactions.filter(
          (tx) =>
            normalizeCategoryKey(tx.category) === targetKey &&
            (!categoryType || tx.txType === categoryType)
        )
      : [];

    const enc = await encryptPayload<DecryptedCustomCategoryPayload>(vaultKey, {
      name: cleanNewName,
      ...(categoryType ? { categoryType } : {}),
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
      ...(systemKey ? { systemKey, deleted: false } : {}),
    });

    const batch = writeBatch(db);
    batch.update(doc(db, 'categories', categoryId), {
      encryptedPayload: enc.encryptedPayload,
      iv: enc.iv,
      updatedAt: serverTimestamp(),
    });

    const firstChunk = matchingTxs.slice(0, 350);
    for (const tx of firstChunk) {
      const txEnc = await encryptPayload<DecryptedTransactionPayload>(
        vaultKey,
        buildTxPayloadWithHistory(tx, { category: cleanNewName })
      );
      batch.update(doc(db, 'transactions', tx.id), {
        encryptedPayload: txEnc.encryptedPayload,
        iv: txEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    for (let i = 350; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const nextBatch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: cleanNewName })
        );
        nextBatch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteEncryptedCustomCategory(params: {
  vaultKey: CryptoKey;
  categoryId: string;
  categoryName: string;
  categoryType?: TransactionType;
  affectedTransactions?: FinancialTransaction[];
  fallbackCategory?: string;
}): Promise<number> {
  const {
    vaultKey,
    categoryId,
    categoryName,
    categoryType,
    affectedTransactions = [],
    fallbackCategory = 'Lainnya',
  } = params;
  const path = `categories/${categoryId}`;
  try {
    const targetKey = normalizeCategoryKey(categoryName);
    const matchingTxs = affectedTransactions.filter(
      (tx) =>
        normalizeCategoryKey(tx.category) === targetKey &&
        (!categoryType || tx.txType === categoryType)
    );

    const batch = writeBatch(db);
    batch.delete(doc(db, 'categories', categoryId));

    const firstChunk = matchingTxs.slice(0, 350);
    for (const tx of firstChunk) {
      const txEnc = await encryptPayload<DecryptedTransactionPayload>(
        vaultKey,
        buildTxPayloadWithHistory(tx, { category: fallbackCategory })
      );
      batch.update(doc(db, 'transactions', tx.id), {
        encryptedPayload: txEnc.encryptedPayload,
        iv: txEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    for (let i = 350; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const nextBatch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: fallbackCategory })
        );
        nextBatch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertBuiltInCategoryOverride(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  existingOverrideId?: string;
  systemKey: string;
  categoryType?: TransactionType;
  oldDisplayName: string;
  newDisplayName: string;
  icon?: string;
  color?: string;
  deleted: boolean;
  affectedTransactions: FinancialTransaction[];
  targetTransactionCategory: string;
}): Promise<number> {
  const {
    uid,
    sharedWithUids,
    vaultKey,
    existingOverrideId,
    systemKey,
    categoryType,
    oldDisplayName,
    newDisplayName,
    icon,
    color,
    deleted,
    affectedTransactions,
    targetTransactionCategory,
  } = params;
  const docId = existingOverrideId || newDocId('cat');
  const path = `categories/${docId}`;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);
  try {
    const oldKey = normalizeCategoryKey(oldDisplayName);
    const targetKey = normalizeCategoryKey(targetTransactionCategory);
    const needsTxRewrite = deleted || oldKey !== targetKey;
    const matchingTxs = needsTxRewrite
      ? affectedTransactions.filter(
          (tx) =>
            normalizeCategoryKey(tx.category) === oldKey &&
            (!categoryType || tx.txType === categoryType)
        )
      : [];

    const enc = await encryptPayload<DecryptedCustomCategoryPayload>(vaultKey, {
      name: newDisplayName.trim().slice(0, 50),
      ...(categoryType ? { categoryType } : {}),
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
      systemKey,
      deleted,
    });

    const batch = writeBatch(db);
    if (existingOverrideId) {
      batch.update(doc(db, 'categories', docId), {
        encryptedPayload: enc.encryptedPayload,
        iv: enc.iv,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'categories', docId), {
        ownerId: uid,
        ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
        encryptedPayload: enc.encryptedPayload,
        iv: enc.iv,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const firstChunk = matchingTxs.slice(0, 350);
    for (const tx of firstChunk) {
      const txEnc = await encryptPayload<DecryptedTransactionPayload>(
        vaultKey,
        buildTxPayloadWithHistory(tx, { category: targetTransactionCategory })
      );
      batch.update(doc(db, 'transactions', tx.id), {
        encryptedPayload: txEnc.encryptedPayload,
        iv: txEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    for (let i = 350; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const nextBatch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: targetTransactionCategory })
        );
        nextBatch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function renameOrMergeUnlistedCategory(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  oldName: string;
  newName: string;
  categoryType?: TransactionType;
  icon?: string;
  color?: string;
  createCategoryDoc: boolean;
  affectedTransactions: FinancialTransaction[];
}): Promise<number> {
  const {
    uid,
    sharedWithUids,
    vaultKey,
    oldName,
    newName,
    categoryType = 'expense',
    icon,
    color,
    createCategoryDoc,
    affectedTransactions,
  } = params;
  const cleanNewName = newName.trim().slice(0, 50);
  const oldKey = normalizeCategoryKey(oldName);
  const needsTxRewrite = normalizeCategoryKey(cleanNewName) !== oldKey;
  const matchingTxs = needsTxRewrite
    ? affectedTransactions.filter(
        (tx) =>
          normalizeCategoryKey(tx.category) === oldKey &&
          tx.txType === categoryType
      )
    : [];
  const catId = newDocId('cat');
  const path = createCategoryDoc ? `categories/${catId}` : 'transactions';
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);

  try {
    const firstChunk = matchingTxs.slice(0, 350);
    const batch = writeBatch(db);

    if (createCategoryDoc) {
      const catEnc = await encryptPayload<DecryptedCustomCategoryPayload>(vaultKey, {
        name: cleanNewName,
        categoryType,
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
      });
      batch.set(doc(db, 'categories', catId), {
        ownerId: uid,
        ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
        encryptedPayload: catEnc.encryptedPayload,
        iv: catEnc.iv,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const tx of firstChunk) {
      const txEnc = await encryptPayload<DecryptedTransactionPayload>(
        vaultKey,
        buildTxPayloadWithHistory(tx, { category: cleanNewName })
      );
      batch.update(doc(db, 'transactions', tx.id), {
        encryptedPayload: txEnc.encryptedPayload,
        iv: txEnc.iv,
        updatedAt: serverTimestamp(),
      });
    }

    if (createCategoryDoc || firstChunk.length > 0) {
      await batch.commit();
    }

    for (let i = 350; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const nextBatch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: cleanNewName })
        );
        nextBatch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteUnlistedTransactionCategory(params: {
  vaultKey: CryptoKey;
  categoryName: string;
  categoryType?: TransactionType;
  fallbackCategory: string;
  affectedTransactions: FinancialTransaction[];
}): Promise<number> {
  const { vaultKey, categoryName, categoryType, fallbackCategory, affectedTransactions } = params;
  const targetKey = normalizeCategoryKey(categoryName);
  const matchingTxs = affectedTransactions.filter(
    (tx) =>
      normalizeCategoryKey(tx.category) === targetKey &&
      (!categoryType || tx.txType === categoryType)
  );
  if (matchingTxs.length === 0) return 0;

  try {
    for (let i = 0; i < matchingTxs.length; i += 350) {
      const chunk = matchingTxs.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const tx of chunk) {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: fallbackCategory })
        );
        batch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return matchingTxs.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'transactions');
  }
}

export async function restoreBuiltInCategoryOverrides(params: {
  vaultKey: CryptoKey;
  overrideDocs: CustomCategory[];
  affectedTransactions?: FinancialTransaction[];
}): Promise<number> {
  const { vaultKey, overrideDocs, affectedTransactions = [] } = params;
  if (overrideDocs.length === 0) return 0;

  // Map any renamed (non-deleted) built-in display name back to its original systemKey
  const revertMap = new Map<string, string>();
  for (const ov of overrideDocs) {
    if (ov.systemKey && !ov.deleted && normalizeCategoryKey(ov.name) !== normalizeCategoryKey(ov.systemKey)) {
      revertMap.set(normalizeCategoryKey(ov.name), ov.systemKey);
    }
  }

  const txsToRevert: Array<{ tx: FinancialTransaction; nextCategory: string }> = [];
  if (revertMap.size > 0) {
    for (const tx of affectedTransactions) {
      const nextCat = revertMap.get(normalizeCategoryKey(tx.category));
      if (nextCat) {
        txsToRevert.push({ tx, nextCategory: nextCat });
      }
    }
  }

  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => Promise<void>> = [];

    for (const item of overrideDocs) {
      ops.push(async (batch) => {
        batch.delete(doc(db, 'categories', item.id));
      });
    }

    for (const { tx, nextCategory } of txsToRevert) {
      ops.push(async (batch) => {
        const txEnc = await encryptPayload<DecryptedTransactionPayload>(
          vaultKey,
          buildTxPayloadWithHistory(tx, { category: nextCategory })
        );
        batch.update(doc(db, 'transactions', tx.id), {
          encryptedPayload: txEnc.encryptedPayload,
          iv: txEnc.iv,
          updatedAt: serverTimestamp(),
        });
      });
    }

    for (let i = 0; i < ops.length; i += 350) {
      const chunk = ops.slice(i, i + 350);
      const batch = writeBatch(db);
      await Promise.all(chunk.map((fn) => fn(batch)));
      await batch.commit();
    }

    return txsToRevert.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'categories');
  }
}

export function subscribeEncryptedBudgets(
  vaultOwnerId: string,
  vaultKey: CryptoKey,
  onData: (budgets: CategoryBudget[]) => void,
  onError: (err: Error) => void,
  viewerUid: string = vaultOwnerId
) {
  const isSharedView = vaultOwnerId !== viewerUid;
  const q = isSharedView
    ? query(collection(db, 'budgets'), where('sharedWithUids', 'array-contains', viewerUid))
    : query(collection(db, 'budgets'), where('ownerId', '==', vaultOwnerId));
  let latestSeq = 0;
  return onSnapshot(
    q,
    async (snapshot) => {
      const seq = ++latestSeq;
      try {
        const results = await Promise.all(
          snapshot.docs.map(async (d): Promise<CategoryBudget | null> => {
            const raw = d.data();
            if (raw.ownerId !== vaultOwnerId) return null;
            try {
              const payload = await decryptPayload<DecryptedBudgetPayload>(
                vaultKey,
                raw.encryptedPayload,
                raw.iv
              );
              const monthlyLimit = Number(payload.monthlyLimit);
              const rawPeriod = Number(payload.periodMonths);
              const periodMonths =
                Number.isInteger(rawPeriod) && rawPeriod >= 1 && rawPeriod <= 36 ? rawPeriod : 1;
              const anchorMonth =
                typeof payload.anchorMonth === 'string' && /^\d{4}-\d{2}$/.test(payload.anchorMonth)
                  ? payload.anchorMonth
                  : undefined;
              const targetMonth =
                typeof payload.targetMonth === 'string' && /^\d{4}-\d{2}$/.test(payload.targetMonth)
                  ? payload.targetMonth
                  : undefined;
              const budgetType: TransactionType =
                payload.budgetType === 'income' ? 'income' : 'expense';

              if (
                payload.category &&
                payload.category.trim() &&
                Number.isFinite(monthlyLimit) &&
                monthlyLimit > 0
              ) {
                return {
                  id: d.id,
                  ownerId: raw.ownerId,
                  category: payload.category.trim().slice(0, 50),
                  monthlyLimit,
                  currency: payload.currency || 'AED',
                  periodMonths,
                  budgetType,
                  ...(anchorMonth ? { anchorMonth } : {}),
                  ...(targetMonth ? { targetMonth } : {}),
                };
              }
            } catch (decErr) {
              console.warn('Could not decrypt budget', d.id, decErr);
            }
            return null;
          })
        );
        if (seq !== latestSeq) return;
        const decrypted = results.filter((b): b is CategoryBudget => b !== null);
        decrypted.sort((a, b) => a.category.localeCompare(b.category));
        onData(decrypted);
      } catch (err) {
        if (seq !== latestSeq) return;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      handleFirestoreError(error, OperationType.LIST, 'budgets');
    }
  );
}

function makeBudgetScopeKey(
  budgetType: TransactionType | undefined,
  targetMonth: string | undefined,
  category: string
): string {
  const bType = budgetType === 'income' ? 'income' : 'expense';
  const monthPart = targetMonth && /^\d{4}-\d{2}$/.test(targetMonth) ? targetMonth : '';
  return `${bType}::${monthPart}::${normalizeCategoryKey(category)}`;
}

export async function saveCategoryBudgetsBatch(params: {
  uid: string;
  sharedWithUids?: string[];
  vaultKey: CryptoKey;
  existingBudgets: CategoryBudget[];
  entries: Array<{
    category: string;
    monthlyLimit: number;
    currency: SupportedCurrency;
    periodMonths?: number;
    anchorMonth?: string;
    budgetType?: TransactionType;
    targetMonth?: string;
  }>;
}): Promise<{ saved: number; deleted: number }> {
  const { uid, sharedWithUids, vaultKey, existingBudgets, entries } = params;
  const sharedUids = normalizeSharedUids(uid, sharedWithUids);
  const existingByKey = new Map<string, CategoryBudget>();
  for (const b of existingBudgets) {
    existingByKey.set(makeBudgetScopeKey(b.budgetType, b.targetMonth, b.category), b);
  }

  try {
    const ops: Array<(batch: ReturnType<typeof writeBatch>) => Promise<void>> = [];
    let saved = 0;
    let deleted = 0;

    for (const entry of entries) {
      const cleanCat = entry.category.trim().slice(0, 50);
      if (!cleanCat) continue;
      const nextBudgetType: TransactionType = entry.budgetType === 'income' ? 'income' : 'expense';
      const nextTargetMonth =
        typeof entry.targetMonth === 'string' && /^\d{4}-\d{2}$/.test(entry.targetMonth)
          ? entry.targetMonth
          : undefined;
      const key = makeBudgetScopeKey(nextBudgetType, nextTargetMonth, cleanCat);
      const existing = existingByKey.get(key);
      const nextLimit = Number(entry.monthlyLimit);
      const rawPeriod = Number(entry.periodMonths);
      const nextPeriod =
        Number.isInteger(rawPeriod) && rawPeriod >= 1 && rawPeriod <= 36 ? rawPeriod : 1;
      const nextAnchor =
        nextPeriod > 1 &&
        typeof entry.anchorMonth === 'string' &&
        /^\d{4}-\d{2}$/.test(entry.anchorMonth)
          ? entry.anchorMonth
          : undefined;

      if (!Number.isFinite(nextLimit) || nextLimit <= 0) {
        if (existing) {
          deleted += 1;
          ops.push(async (batch) => {
            batch.delete(doc(db, 'budgets', existing.id));
          });
        }
        continue;
      }

      if (
        existing &&
        existing.category === cleanCat &&
        (existing.budgetType || 'expense') === nextBudgetType &&
        (existing.targetMonth || undefined) === nextTargetMonth &&
        Math.abs(existing.monthlyLimit - nextLimit) < 0.0001 &&
        existing.currency === entry.currency &&
        (existing.periodMonths || 1) === nextPeriod &&
        (existing.anchorMonth || undefined) === nextAnchor
      ) {
        continue;
      }

      saved += 1;
      const payloadToEncrypt: DecryptedBudgetPayload = {
        category: cleanCat,
        monthlyLimit: nextLimit,
        currency: entry.currency,
        periodMonths: nextPeriod,
        budgetType: nextBudgetType,
        ...(nextAnchor ? { anchorMonth: nextAnchor } : {}),
        ...(nextTargetMonth ? { targetMonth: nextTargetMonth } : {}),
      };

      if (existing) {
        ops.push(async (batch) => {
          const enc = await encryptPayload<DecryptedBudgetPayload>(vaultKey, payloadToEncrypt);
          batch.update(doc(db, 'budgets', existing.id), {
            encryptedPayload: enc.encryptedPayload,
            iv: enc.iv,
            updatedAt: serverTimestamp(),
          });
        });
      } else {
        const id = newDocId('bdg');
        ops.push(async (batch) => {
          const enc = await encryptPayload<DecryptedBudgetPayload>(vaultKey, payloadToEncrypt);
          batch.set(doc(db, 'budgets', id), {
            ownerId: uid,
            ...(sharedUids ? { sharedWithUids: sharedUids } : {}),
            encryptedPayload: enc.encryptedPayload,
            iv: enc.iv,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }
    }

    for (let i = 0; i < ops.length; i += 350) {
      const chunk = ops.slice(i, i + 350);
      const batch = writeBatch(db);
      await Promise.all(chunk.map((fn) => fn(batch)));
      await batch.commit();
    }

    return { saved, deleted };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'budgets');
  }
}

export async function deleteEncryptedBudget(budgetId: string): Promise<void> {
  const path = `budgets/${budgetId}`;
  try {
    await deleteDoc(doc(db, 'budgets', budgetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteAllUserVaultData(params: {
  uid: string;
  includeAccounts: boolean;
  includeCategories?: boolean;
}): Promise<{ transactions: number; syncLogs: number; accounts: number; categories: number }> {
  const { uid, includeAccounts, includeCategories = false } = params;
  try {
    const [txSnap, logSnap, accSnap, catSnap, budgetSnap] = await Promise.all([
      getDocs(query(collection(db, 'transactions'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'syncLogs'), where('ownerId', '==', uid))),
      includeAccounts
        ? getDocs(query(collection(db, 'accounts'), where('ownerId', '==', uid)))
        : Promise.resolve(null),
      includeCategories
        ? getDocs(query(collection(db, 'categories'), where('ownerId', '==', uid)))
        : Promise.resolve(null),
      includeCategories
        ? getDocs(query(collection(db, 'budgets'), where('ownerId', '==', uid)))
        : Promise.resolve(null),
    ]);

    const refs = [
      ...txSnap.docs.map((d) => d.ref),
      ...logSnap.docs.map((d) => d.ref),
      ...(accSnap ? accSnap.docs.map((d) => d.ref) : []),
      ...(catSnap ? catSnap.docs.map((d) => d.ref) : []),
      ...(budgetSnap ? budgetSnap.docs.map((d) => d.ref) : []),
    ];

    for (let i = 0; i < refs.length; i += 400) {
      const chunk = refs.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    return {
      transactions: txSnap.size,
      syncLogs: logSnap.size,
      accounts: accSnap ? accSnap.size : 0,
      categories: catSnap ? catSnap.size : 0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'transactions');
  }
}

// ==========================================
// Multi-Account / Family Vault Sharing
// ==========================================

function mapVaultShareDoc(id: string, raw: Record<string, unknown>): VaultShare {
  return {
    id,
    vaultOwnerId: String(raw.vaultOwnerId || ''),
    ownerEmail: String(raw.ownerEmail || ''),
    ownerDisplayName: String(raw.ownerDisplayName || 'Pemilik Brankas'),
    memberEmail: String(raw.memberEmail || ''),
    memberUid: String(raw.memberUid || ''),
    memberDisplayName: String(raw.memberDisplayName || ''),
    role: raw.role === 'viewer' ? 'viewer' : 'editor',
    status:
      raw.status === 'active'
        ? 'active'
        : raw.status === 'revoked'
          ? 'revoked'
          : 'pending',
  };
}

export function subscribeMyOwnedVaultShares(
  ownerUid: string,
  onData: (shares: VaultShare[]) => void,
  onError: (err: Error) => void
) {
  const q = query(collection(db, 'vaultShares'), where('vaultOwnerId', '==', ownerUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const shares = snapshot.docs
        .map((d) => mapVaultShareDoc(d.id, d.data()))
        .filter((s) => s.status !== 'revoked');
      shares.sort((a, b) => a.memberEmail.localeCompare(b.memberEmail));
      onData(shares);
    },
    (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      handleFirestoreError(error, OperationType.LIST, 'vaultShares');
    }
  );
}

export function subscribeIncomingVaultSharesByEmail(
  memberEmail: string,
  onData: (shares: VaultShare[]) => void,
  onError: (err: Error) => void
) {
  const cleanEmail = memberEmail.trim().toLowerCase();
  if (!cleanEmail) {
    onData([]);
    return () => {};
  }
  const q = query(collection(db, 'vaultShares'), where('memberEmail', '==', cleanEmail));
  return onSnapshot(
    q,
    (snapshot) => {
      const shares = snapshot.docs
        .map((d) => mapVaultShareDoc(d.id, d.data()))
        .filter((s) => s.status !== 'revoked');
      onData(shares);
    },
    (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      handleFirestoreError(error, OperationType.LIST, 'vaultShares');
    }
  );
}

export function subscribeMySharedMemberships(
  memberUid: string,
  onData: (memberships: VaultMember[]) => void,
  onError: (err: Error) => void
) {
  const q = query(collection(db, 'vaultMembers'), where('memberUid', '==', memberUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: VaultMember[] = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          vaultOwnerId: String(raw.vaultOwnerId || ''),
          memberUid: String(raw.memberUid || ''),
          memberEmail: String(raw.memberEmail || ''),
          memberDisplayName: String(raw.memberDisplayName || ''),
          role: raw.role === 'viewer' ? 'viewer' : 'editor',
          shareId: String(raw.shareId || ''),
        };
      });
      onData(list);
    },
    (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      handleFirestoreError(error, OperationType.LIST, 'vaultMembers');
    }
  );
}

export async function inviteVaultMember(params: {
  ownerUid: string;
  ownerEmail: string;
  ownerDisplayName: string;
  memberEmail: string;
  role: VaultShareRole;
}): Promise<string> {
  const cleanMemberEmail = params.memberEmail.trim().toLowerCase().slice(0, 254);
  const cleanOwnerEmail = params.ownerEmail.trim().toLowerCase().slice(0, 254);
  if (!cleanMemberEmail || !cleanMemberEmail.includes('@')) {
    throw new Error('Masukkan alamat email Google yang valid.');
  }
  if (cleanMemberEmail === cleanOwnerEmail) {
    throw new Error('Tidak dapat mengundang email akun Anda sendiri.');
  }

  const shareId = newDocId('shr');
  const path = `vaultShares/${shareId}`;
  try {
    await setDoc(doc(db, 'vaultShares', shareId), {
      vaultOwnerId: params.ownerUid,
      ownerEmail: cleanOwnerEmail,
      ownerDisplayName: (params.ownerDisplayName || cleanOwnerEmail).slice(0, 120),
      memberEmail: cleanMemberEmail,
      memberUid: '',
      memberDisplayName: '',
      role: params.role,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return shareId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function acceptVaultShareInvitation(params: {
  share: VaultShare;
  memberUid: string;
  memberEmail: string;
  memberDisplayName: string;
}): Promise<void> {
  const { share, memberUid, memberEmail, memberDisplayName } = params;
  const membershipId = `${share.vaultOwnerId}__${memberUid}`;
  const cleanName = (memberDisplayName || memberEmail.split('@')[0] || 'Anggota').slice(0, 120);
  const cleanEmail = memberEmail.trim().toLowerCase().slice(0, 254);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'vaultShares', share.id), {
      memberUid,
      memberDisplayName: cleanName,
      status: 'active',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'vaultMembers', membershipId), {
      vaultOwnerId: share.vaultOwnerId,
      memberUid,
      memberEmail: cleanEmail,
      memberDisplayName: cleanName,
      role: share.role,
      shareId: share.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `vaultShares/${share.id}`);
  }
}

export async function updateVaultMemberRole(params: {
  shareId: string;
  vaultOwnerId: string;
  memberUid?: string;
  role: VaultShareRole;
}): Promise<void> {
  const { shareId, vaultOwnerId, memberUid, role } = params;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'vaultShares', shareId), {
      role,
      updatedAt: serverTimestamp(),
    });
    if (memberUid) {
      const membershipId = `${vaultOwnerId}__${memberUid}`;
      batch.update(doc(db, 'vaultMembers', membershipId), {
        role,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `vaultShares/${shareId}`);
  }
}

export async function syncSharedWithUidsForOwner(
  ownerUid: string,
  activeMemberUids: string[]
): Promise<number> {
  const targetShared =
    activeMemberUids.length > 0
      ? Array.from(new Set([ownerUid, ...activeMemberUids.filter(Boolean)])).slice(0, 10)
      : [];

  const sameUidSet = (existingVal: unknown): boolean => {
    const arr = Array.isArray(existingVal) ? existingVal.map(String) : [];
    if (arr.length !== targetShared.length) return false;
    const set = new Set(arr);
    return targetShared.every((u) => set.has(u));
  };

  try {
    const [accSnap, txSnap, logSnap, catSnap, budgetSnap] = await Promise.all([
      getDocs(query(collection(db, 'accounts'), where('ownerId', '==', ownerUid))),
      getDocs(query(collection(db, 'transactions'), where('ownerId', '==', ownerUid))),
      getDocs(query(collection(db, 'syncLogs'), where('ownerId', '==', ownerUid))),
      getDocs(query(collection(db, 'categories'), where('ownerId', '==', ownerUid))),
      getDocs(query(collection(db, 'budgets'), where('ownerId', '==', ownerUid))),
    ]);

    const updates: Array<{ ref: typeof accSnap.docs[number]['ref']; hasUpdatedAt: boolean }> = [];

    for (const d of [...accSnap.docs, ...txSnap.docs, ...catSnap.docs, ...budgetSnap.docs]) {
      if (!sameUidSet(d.data().sharedWithUids)) {
        updates.push({ ref: d.ref, hasUpdatedAt: true });
      }
    }
    for (const d of logSnap.docs) {
      if (!sameUidSet(d.data().sharedWithUids)) {
        updates.push({ ref: d.ref, hasUpdatedAt: false });
      }
    }

    for (let i = 0; i < updates.length; i += 350) {
      const chunk = updates.slice(i, i + 350);
      const batch = writeBatch(db);
      for (const item of chunk) {
        batch.update(item.ref, {
          sharedWithUids: targetShared,
          ...(item.hasUpdatedAt ? { updatedAt: serverTimestamp() } : {}),
        });
      }
      await batch.commit();
    }

    return updates.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'accounts');
  }
}

export async function revokeVaultShare(params: {
  share: VaultShare;
  remainingActiveMemberUids: string[];
}): Promise<void> {
  const { share, remainingActiveMemberUids } = params;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'vaultShares', share.id));
    if (share.memberUid) {
      const membershipId = `${share.vaultOwnerId}__${share.memberUid}`;
      batch.delete(doc(db, 'vaultMembers', membershipId));
    }
    await batch.commit();

    await syncSharedWithUidsForOwner(share.vaultOwnerId, remainingActiveMemberUids);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `vaultShares/${share.id}`);
  }
}

export async function leaveSharedVault(params: {
  vaultOwnerId: string;
  memberUid: string;
  shareId: string;
}): Promise<void> {
  const { vaultOwnerId, memberUid, shareId } = params;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'vaultMembers', `${vaultOwnerId}__${memberUid}`));
    if (shareId) {
      batch.delete(doc(db, 'vaultShares', shareId));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `vaultMembers/${vaultOwnerId}__${memberUid}`);
  }
}
