import { compareTransactionsByDateDesc, type FinancialTransaction } from '../types';

export type PendingTxMutation =
  | {
      type: 'upsert';
      tx: FinancialTransaction;
      expiresAt: number;
    }
  | {
      type: 'delete';
      expiresAt: number;
    };

export function reconcileTransactionsWithPending(
  snapshotTxs: FinancialTransaction[],
  pendingMap: Map<string, PendingTxMutation>,
  fromCache = false,
  now = Date.now()
): FinancialTransaction[] {
  for (const [id, entry] of pendingMap.entries()) {
    if (now > entry.expiresAt) {
      pendingMap.delete(id);
    }
  }

  if (pendingMap.size === 0) {
    return [...snapshotTxs].sort(compareTransactionsByDateDesc);
  }

  const byId = new Map<string, FinancialTransaction>();
  for (const tx of snapshotTxs) {
    byId.set(tx.id, tx);
  }

  for (const [id, entry] of pendingMap.entries()) {
    const existing = byId.get(id);
    if (entry.type === 'delete') {
      if (!existing) {
        if (!fromCache) {
          pendingMap.delete(id);
        }
      } else {
        byId.delete(id);
      }
      continue;
    }

    // upsert
    if (existing) {
      const pendingUpdatedAt = entry.tx.updatedAtIso || '';
      const snapUpdatedAt = existing.updatedAtIso || '';
      const isSnapshotUpToDate = !pendingUpdatedAt || snapUpdatedAt >= pendingUpdatedAt;
      if (isSnapshotUpToDate) {
        if (!fromCache) {
          pendingMap.delete(id);
        }
      } else {
        byId.set(id, entry.tx);
      }
    } else {
      byId.set(id, entry.tx);
    }
  }

  return Array.from(byId.values()).sort(compareTransactionsByDateDesc);
}
