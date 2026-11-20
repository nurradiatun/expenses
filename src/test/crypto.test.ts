import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearVaultKeySession,
  createKeyVerificationToken,
  decryptPayload,
  decryptString,
  deriveVaultKey,
  encryptPayload,
  encryptString,
  exportVaultKeyToSession,
  generateRandomSaltBase64,
  restoreVaultKeyFromSession,
  verifyVaultKey,
} from '../lib/crypto';
import type { DecryptedCustomCategoryPayload, DecryptedTransactionPayload } from '../types';

describe('End-to-End Vault Cryptography (PBKDF2 + AES-GCM-256)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('derives an AES-GCM key and round-trips string encryption/decryption', async () => {
    const salt = generateRandomSaltBase64();
    const key = await deriveVaultKey('rahasia-brankas-2026', salt, 1000);

    const { ciphertext, iv } = await encryptString(key, 'My Expenses Vault Secret');
    expect(ciphertext).not.toContain('My Expenses');
    expect(iv.length).toBeGreaterThan(8);

    const decrypted = await decryptString(key, ciphertext, iv);
    expect(decrypted).toBe('My Expenses Vault Secret');
  });

  it('encrypts and decrypts structured transaction & category payloads with icon and color', async () => {
    const salt = generateRandomSaltBase64();
    const key = await deriveVaultKey('sandi-kuat', salt, 1000);

    const txPayload: DecryptedTransactionPayload = {
      date: '2026-11-15',
      description: 'Belanja mingguan Carrefour',
      merchant: 'Carrefour UAE',
      amount: 245.75,
      currency: 'AED',
      category: 'Belanja & Groceries',
      reference: 'TXN-99881',
      notes: 'Value Date terverifikasi',
    };

    const encTx = await encryptPayload(key, txPayload);
    const decTx = await decryptPayload<DecryptedTransactionPayload>(
      key,
      encTx.encryptedPayload,
      encTx.iv
    );
    expect(decTx).toEqual(txPayload);

    const catPayload: DecryptedCustomCategoryPayload = {
      name: 'Pendidikan Anak',
      categoryType: 'expense',
      icon: 'GraduationCap',
      color: '#4F46E5',
    };
    const encCat = await encryptPayload(key, catPayload);
    const decCat = await decryptPayload<DecryptedCustomCategoryPayload>(
      key,
      encCat.encryptedPayload,
      encCat.iv
    );
    expect(decCat).toEqual(catPayload);
  });

  it('verifies correct passphrase keys and rejects wrong keys', async () => {
    const salt = generateRandomSaltBase64();
    const validKey = await deriveVaultKey('passphrase-benar', salt, 1000);
    const wrongKey = await deriveVaultKey('passphrase-salah', salt, 1000);

    const token = await createKeyVerificationToken(validKey);
    expect(await verifyVaultKey(validKey, token.keyCheckCiphertext, token.keyCheckIv)).toBe(true);
    expect(await verifyVaultKey(wrongKey, token.keyCheckCiphertext, token.keyCheckIv)).toBe(false);
  });

  it('persists and restores vault key in sessionStorage while clearing on lock/signout', async () => {
    const salt = generateRandomSaltBase64();
    const key = await deriveVaultKey('session-pass', salt, 1000);
    const token = await createKeyVerificationToken(key);

    await exportVaultKeyToSession('user-123', key);
    const restored = await restoreVaultKeyFromSession(
      'user-123',
      token.keyCheckCiphertext,
      token.keyCheckIv
    );
    expect(restored).not.toBeNull();

    // Wrong verification token clears invalid cached key
    const rejected = await restoreVaultKeyFromSession('user-123', 'invalid-cipher', token.keyCheckIv);
    expect(rejected).toBeNull();

    await exportVaultKeyToSession('user-123', key);
    clearVaultKeySession('user-123');
    const afterClear = await restoreVaultKeyFromSession(
      'user-123',
      token.keyCheckCiphertext,
      token.keyCheckIv
    );
    expect(afterClear).toBeNull();
  });
});
