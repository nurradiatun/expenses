const KEY_VERIFICATION_PLAINTEXT = 'KHASANAH_VAULT_VERIFIED_V1';
export const DEFAULT_KDF_ITERATIONS = 310000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateRandomSaltBase64(): string {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  return bytesToBase64(salt);
}

export async function deriveVaultKey(
  passphrase: string,
  saltBase64: string,
  iterations = DEFAULT_KDF_ITERATIONS
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(saltBase64),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const encoder = new TextEncoder();
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptString(
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string
): Promise<string> {
  const decoder = new TextDecoder();
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(ivBase64),
    },
    key,
    base64ToBytes(ciphertextBase64)
  );
  return decoder.decode(decryptedBuffer);
}

export async function createKeyVerificationToken(
  key: CryptoKey
): Promise<{ keyCheckCiphertext: string; keyCheckIv: string }> {
  const { ciphertext, iv } = await encryptString(key, KEY_VERIFICATION_PLAINTEXT);
  return {
    keyCheckCiphertext: ciphertext,
    keyCheckIv: iv,
  };
}

export async function verifyVaultKey(
  key: CryptoKey,
  keyCheckCiphertext: string,
  keyCheckIv: string
): Promise<boolean> {
  try {
    const result = await decryptString(key, keyCheckCiphertext, keyCheckIv);
    return result === KEY_VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

export async function encryptPayload<T>(
  key: CryptoKey,
  payload: T
): Promise<{ encryptedPayload: string; iv: string }> {
  const serialized = JSON.stringify(payload);
  const { ciphertext, iv } = await encryptString(key, serialized);
  return {
    encryptedPayload: ciphertext,
    iv,
  };
}

export async function decryptPayload<T>(
  key: CryptoKey,
  encryptedPayload: string,
  iv: string
): Promise<T> {
  const serialized = await decryptString(key, encryptedPayload, iv);
  return JSON.parse(serialized) as T;
}

const VAULT_SESSION_PREFIX = 'my_expenses_vault_jwk_';

export async function exportVaultKeyToSession(uid: string, key: CryptoKey): Promise<void> {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    window.sessionStorage.setItem(`${VAULT_SESSION_PREFIX}${uid}`, JSON.stringify(jwk));
  } catch {
    // Ignore if browser blocks sessionStorage or key isn't extractable
  }
}

export async function restoreVaultKeyFromSession(
  uid: string,
  keyCheckCiphertext: string,
  keyCheckIv: string
): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(`${VAULT_SESSION_PREFIX}${uid}`);
    if (!raw) return null;
    const jwk = JSON.parse(raw) as JsonWebKey;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const valid = await verifyVaultKey(key, keyCheckCiphertext, keyCheckIv);
    if (!valid) {
      window.sessionStorage.removeItem(`${VAULT_SESSION_PREFIX}${uid}`);
      return null;
    }
    return key;
  } catch {
    window.sessionStorage.removeItem(`${VAULT_SESSION_PREFIX}${uid}`);
    return null;
  }
}

export function clearVaultKeySession(uid?: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    if (uid) {
      window.sessionStorage.removeItem(`${VAULT_SESSION_PREFIX}${uid}`);
      return;
    }
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(VAULT_SESSION_PREFIX)) keysToDelete.push(k);
    }
    for (const k of keysToDelete) {
      window.sessionStorage.removeItem(k);
    }
  } catch {
    // Ignore storage errors
  }
}
