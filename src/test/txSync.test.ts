import { describe, expect, it, vi } from 'vitest';
import {
  compareTransactionsByDateAsc,
  compareTransactionsByDateDesc,
  type FinancialTransaction,
} from '../types';
import { reconcileTransactionsWithPending, type PendingTxMutation } from '../lib/txSync';

function makeTx(
  id: string,
  date: string,
  createdAtIso: string,
  overrides: Partial<FinancialTransaction> = {}
): FinancialTransaction {
  return {
    id,
    ownerId: 'u1',
    accountId: 'acc-1',
    monthKey: date.slice(0, 7),
    txType: 'expense',
    source: 'manual',
    date,
    description: `Desc ${id}`,
    merchant: `Merchant ${id}`,
    amount: 100,
    currency: 'AED',
    category: 'Makan & Minum',
    reference: '',
    notes: '',
    createdAtIso,
    ...overrides,
  };
}

describe('txSync & deterministic transaction ordering', () => {
  it('breaks same-date ties by createdAtIso descending / ascending', () => {
    const older = makeTx('tx_z', '2026-11-25', '2026-11-25T08:00:00.000Z');
    const newer = makeTx('tx_a', '2026-11-25', '2026-11-25T10:30:00.000Z');

    const desc = [older, newer].sort(compareTransactionsByDateDesc);
    expect(desc.map((t) => t.id)).toEqual(['tx_a', 'tx_z']);

    const asc = [newer, older].sort(compareTransactionsByDateAsc);
    expect(asc.map((t) => t.id)).toEqual(['tx_z', 'tx_a']);
  });

  it('keeps newly created manual transaction across stale snapshots until confirmed by server', () => {
    const existing = makeTx('tx-1', '2026-11-25', '2026-11-25T08:00:00.000Z');
    const newlyCreated = makeTx('tx-2', '2026-11-25', '2026-11-25T11:00:00.000Z');
    const pending = new Map<string, PendingTxMutation>([
      ['tx-2', { type: 'upsert', tx: newlyCreated, expiresAt: 20_000 }],
    ]);

    // Stale cached snapshot arrives without tx-2: tx-2 MUST remain visible at top
    const afterStale = reconcileTransactionsWithPending([existing], pending, true, 10_000);
    expect(afterStale.map((t) => t.id)).toEqual(['tx-2', 'tx-1']);
    expect(pending.has('tx-2')).toBe(true);

    // Server snapshot arrives containing tx-2: deduplicated and pending entry cleared
    const afterServer = reconcileTransactionsWithPending(
      [existing, newlyCreated],
      pending,
      false,
      11_000
    );
    expect(afterServer.map((t) => t.id)).toEqual(['tx-2', 'tx-1']);
    expect(pending.has('tx-2')).toBe(false);
  });

  it('preserves pending edits against older snapshot versions and pending deletes until confirmed', () => {
    const original = makeTx('tx-1', '2026-11-25', '2026-11-25T08:00:00.000Z', {
      category: 'Makan & Minum',
      updatedAtIso: '2026-11-25T08:05:00.000Z',
    });
    const edited = {
      ...original,
      category: 'Transportasi',
      updatedAtIso: '2026-11-25T09:00:00.000Z',
    };
    const deletedTx = makeTx('tx-del', '2026-11-25', '2026-11-25T07:00:00.000Z');

    const pending = new Map<string, PendingTxMutation>([
      ['tx-1', { type: 'upsert', tx: edited, expiresAt: 20_000 }],
      ['tx-del', { type: 'delete', expiresAt: 20_000 }],
    ]);

    const merged = reconcileTransactionsWithPending([original, deletedTx], pending, true, 10_000);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('tx-1');
    expect(merged[0].category).toBe('Transportasi');
  });
});

describe('subscribeEncryptedTransactions async decryption race guard', () => {
  it('ignores stale out-of-order snapshot decryption results when a newer snapshot already resolved', async () => {
    vi.resetModules();

    let snapshotHandler: ((snap: unknown) => void) | null = null;
    const unsubscribeSpy = vi.fn();

    vi.doMock('firebase/firestore', () => ({
      collection: vi.fn(),
      deleteDoc: vi.fn(),
      doc: vi.fn(),
      getDoc: vi.fn(),
      getDocs: vi.fn(),
      onSnapshot: vi.fn((_q: unknown, _opts: unknown, onNext: (snap: unknown) => void) => {
        snapshotHandler = onNext;
        return unsubscribeSpy;
      }),
      query: vi.fn(),
      serverTimestamp: vi.fn(),
      setDoc: vi.fn(),
      updateDoc: vi.fn(),
      where: vi.fn(),
      writeBatch: vi.fn(),
    }));

    vi.doMock('../lib/firebase', () => ({
      db: {},
      handleFirestoreError: vi.fn(),
      OperationType: { LIST: 'list' },
    }));

    let resolveFirstDecrypt!: (val: unknown) => void;
    const decryptMock = vi.fn((_key: unknown, cipher: string) => {
      if (cipher === 'slow-old') {
        return new Promise((resolve) => {
          resolveFirstDecrypt = resolve;
        });
      }
      return Promise.resolve({
        date: '2026-11-25',
        description: 'Transaksi Baru',
        merchant: 'Merchant Baru',
        amount: 42,
        currency: 'AED',
        category: 'Makan & Minum',
        createdAtIso: '2026-11-25T12:00:00.000Z',
      });
    });

    vi.doMock('../lib/crypto', () => ({
      createKeyVerificationToken: vi.fn(),
      decryptPayload: decryptMock,
      DEFAULT_KDF_ITERATIONS: 1000,
      deriveVaultKey: vi.fn(),
      encryptPayload: vi.fn(),
      generateRandomSaltBase64: vi.fn(),
      verifyVaultKey: vi.fn(),
    }));

    const { subscribeEncryptedTransactions } = await import('../lib/vaultService');
    const received: FinancialTransaction[][] = [];

    const unsub = subscribeEncryptedTransactions(
      'u1',
      {} as CryptoKey,
      (txs) => received.push(txs),
      vi.fn()
    );

    expect(snapshotHandler).not.toBeNull();

    // Emit Snapshot #1 (older, slow to decrypt)
    snapshotHandler!({
      metadata: { fromCache: true },
      docs: [
        {
          id: 'tx-old',
          data: () => ({
            ownerId: 'u1',
            accountId: 'acc-1',
            monthKey: '2026-11',
            txType: 'expense',
            source: 'manual',
            encryptedPayload: 'slow-old',
            iv: 'iv1',
          }),
        },
      ],
    });

    // Emit Snapshot #2 (newer, fast to decrypt, includes new transaction)
    snapshotHandler!({
      metadata: { fromCache: false },
      docs: [
        {
          id: 'tx-old',
          data: () => ({
            ownerId: 'u1',
            accountId: 'acc-1',
            monthKey: '2026-11',
            txType: 'expense',
            source: 'manual',
            encryptedPayload: 'fast-old',
            iv: 'iv1',
          }),
        },
        {
          id: 'tx-new',
          data: () => ({
            ownerId: 'u1',
            accountId: 'acc-1',
            monthKey: '2026-11',
            txType: 'expense',
            source: 'manual',
            encryptedPayload: 'fast-new',
            iv: 'iv2',
          }),
        },
      ],
    });

    // Wait for Snapshot #2 to commit
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].map((t) => t.id)).toContain('tx-new');

    // Now resolve Snapshot #1 late — it MUST NOT overwrite Snapshot #2!
    resolveFirstDecrypt({
      date: '2026-11-25',
      description: 'Transaksi Lama',
      merchant: 'Merchant Lama',
      amount: 10,
      currency: 'AED',
      category: 'Makan & Minum',
      createdAtIso: '2026-11-25T08:00:00.000Z',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(1);

    unsub();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    vi.doUnmock('firebase/firestore');
    vi.doUnmock('../lib/firebase');
    vi.doUnmock('../lib/crypto');
  });
});
