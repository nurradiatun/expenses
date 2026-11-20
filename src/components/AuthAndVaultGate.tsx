import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Landmark,
  Languages,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import type { VaultConfigDoc, VaultMember, VaultShare } from '../types';
import { signInWithGoogle, signOutAccount } from '../lib/firebase';
import { createVaultWithPassphrase, unlockVaultWithPassphrase } from '../lib/vaultService';
import { useLanguage } from '../lib/i18n';

interface AuthAndVaultGateProps {
  user: User | null;
  vaultConfig: VaultConfigDoc | null;
  loadingAuth: boolean;
  loadingConfig: boolean;
  activeVaultOwnerId?: string;
  incomingShares?: VaultShare[];
  sharedMemberships?: VaultMember[];
  onSelectVault?: (vaultOwnerId: string) => void;
  onAcceptShare?: (share: VaultShare) => Promise<void>;
  onUnlocked: (key: CryptoKey, isNewVault: boolean) => void;
}

export const AuthAndVaultGate: React.FC<AuthAndVaultGateProps> = ({
  user,
  vaultConfig,
  loadingAuth,
  loadingConfig,
  activeVaultOwnerId,
  incomingShares = [],
  sharedMemberships = [],
  onSelectVault,
  onAcceptShare,
  onUnlocked,
}) => {
  const { lang, toggleLang, tr } = useLanguage();
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingShareId, setAcceptingShareId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr(
              'Gagal masuk dengan akun Google. Silakan coba lagi.',
              'Failed to sign in with Google. Please try again.'
            )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    if (passphrase.length < 8) {
      setError(
        tr(
          'Frasa sandi minimal 8 karakter agar kunci AES-256-GCM kuat.',
          'Passphrase must be at least 8 characters for strong AES-256-GCM encryption.'
        )
      );
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError(tr('Konfirmasi frasa sandi tidak cocok.', 'Passphrase confirmation does not match.'));
      return;
    }

    setSubmitting(true);
    try {
      const key = await createVaultWithPassphrase(user.uid, passphrase);
      setPassphrase('');
      setConfirmPassphrase('');
      onUnlocked(key, true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Gagal membuat brankas terenkripsi.', 'Failed to create encrypted vault.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultConfig) return;
    setError(null);

    if (!passphrase) {
      setError(tr('Masukkan frasa sandi brankas Anda.', 'Enter your vault passphrase.'));
      return;
    }

    setSubmitting(true);
    try {
      const key = await unlockVaultWithPassphrase(vaultConfig, passphrase);
      if (!key) {
        setError(
          tr(
            'Frasa sandi tidak cocok. Kunci dekripsi tidak valid.',
            'Incorrect passphrase. Invalid decryption key.'
          )
        );
        return;
      }
      setPassphrase('');
      onUnlocked(key, false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Gagal membuka brankas.', 'Failed to unlock vault.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAuth || (user && loadingConfig)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6">
        <div className="w-full max-w-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-8 text-center">
          <RefreshCw className="w-6 h-6 text-teal-700 dark:text-teal-400 animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {tr('Menghubungkan ke brankas terenkripsi...', 'Connecting to encrypted vault...')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {tr('Memverifikasi sesi dan sinkronisasi data lokal', 'Verifying session and syncing local data')}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between">
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
              My Expenses
            </span>
            <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
              <span className="whitespace-nowrap shrink-0">{tr('Enkripsi AES-256-GCM', 'AES-256-GCM Encryption')}</span>
              <span className="whitespace-nowrap shrink-0">{tr('Impor Mutasi PDF & Gambar', 'PDF & Image Statement Import')}</span>
              <span className="whitespace-nowrap shrink-0">{tr('Multi-Sumber Dana & Kurs', 'Multi-Funding Sources & FX')}</span>
            </nav>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={toggleLang}
                aria-label={tr('Ubah bahasa ke Inggris', 'Switch language to Indonesian')}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Languages className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                <span>{lang === 'id' ? 'ID' : 'EN'}</span>
              </button>
              <button
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
              >
                {tr('Masuk dengan Google', 'Sign in with Google')}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto w-full px-6 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center">
            <p className="text-xs font-medium tracking-wide text-teal-700 dark:text-teal-400 mb-3">
              {tr('Pencatatan Keuangan Pribadi Zero-Knowledge', 'Zero-Knowledge Personal Finance Tracker')}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.15] [text-wrap:balance]">
              {tr(
                'Kendali penuh atas keuangan pribadi, terenkripsi di setiap perangkat.',
                'Full control over personal finances, encrypted on every device.'
              )}
            </h1>
            <p className="mt-5 text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
              {tr(
                'Catat pemasukan dan pengeluaran harian, ekstrak laporan mutasi PDF maupun gambar secara otomatis, dan pantau saldo sumber dana serta tren arus kas secara real-time tanpa mengorbankan privasi data Anda.',
                'Track daily income and expenses, automatically extract PDF and image bank statements, and monitor funding balances and cash flow trends in real time without compromising your privacy.'
              )}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
              >
                <span>
                  {submitting
                    ? tr('Menghubungkan...', 'Connecting...')
                    : tr('Masuk dengan Google', 'Sign in with Google')}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {tr(
                  'Sinkronisasi lintas perangkat aktif otomatis setelah login',
                  'Cross-device sync activates automatically after sign-in'
                )}
              </span>
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6 sm:p-8">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {tr('Arsitektur Privasi & Sinkronisasi', 'Privacy & Sync Architecture')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {tr(
                  'Seluruh nominal, nama merchant, dan saldo dienkripsi di browser sebelum disinkronkan ke cloud.',
                  'All amounts, merchant names, and balances are encrypted in your browser before cloud sync.'
                )}
              </p>
            </div>

            <div className="mt-6 space-y-5 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="pt-1 flex items-start gap-3.5">
                <ShieldCheck className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {tr('Enkripsi Ujung-ke-Ujung AES-256-GCM', 'AES-256-GCM End-to-End Encryption')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {tr(
                      'Kunci diturunkan secara lokal via PBKDF2-SHA256 (310.000 iterasi). Server maupun database hanya menyimpan ciphertext terenkripsi.',
                      'Keys are derived locally via PBKDF2-SHA256 (310,000 iterations). Servers and databases only store encrypted ciphertext.'
                    )}
                  </p>
                </div>
              </div>

              <div className="pt-4 flex items-start gap-3.5">
                <FileSpreadsheet className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {tr('Pembaca Mutasi PDF & Ekspor CSV / PDF', 'PDF Statement Reader & CSV / PDF Export')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {tr(
                      'Unggah laporan mutasi bank dalam PDF untuk diekstrak otomatis menjadi baris transaksi, serta ekspor laporan bulanan ke CSV atau PDF.',
                      'Upload PDF bank statements to automatically extract transaction rows, and export monthly reports to CSV or PDF.'
                    )}
                  </p>
                </div>
              </div>

              <div className="pt-4 flex items-start gap-3.5">
                <Landmark className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {tr('Sumber Dana & Kurs Otomatis', 'Funding Sources & Live FX Rates')}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {tr(
                      'Kelola sumber dana bank dan tunai dalam mata uang AED, IDR, USD, SGD, dan EUR dengan konversi kurs real-time.',
                      'Manage bank and cash funding sources across AED, IDR, USD, SGD, and EUR with real-time exchange rate conversion.'
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-6">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span>{tr('My Expenses · Buku Kas Pribadi Terenkripsi', 'My Expenses · Encrypted Personal Ledger')}</span>
            <span>AES-256-GCM · PBKDF2-SHA256 · Firestore Offline Sync</span>
          </div>
        </footer>
      </div>
    );
  }

  // Signed in with Google, now require Vault Passphrase creation or unlock
  const targetVaultOwnerId = activeVaultOwnerId || user.uid;
  const isSharedTarget = targetVaultOwnerId !== user.uid;
  const isNewVault = vaultConfig === null;
  const pendingInvites = incomingShares.filter((s) => s.status === 'pending');
  const activeSharedShare = incomingShares.find((s) => s.vaultOwnerId === targetVaultOwnerId);
  const sharedOwnerLabel =
    activeSharedShare?.ownerDisplayName ||
    activeSharedShare?.ownerEmail ||
    `${tr('Brankas', 'Vault')} ${targetVaultOwnerId.slice(0, 6)}`;

  const handleAcceptInvite = async (share: VaultShare) => {
    if (!onAcceptShare) return;
    setError(null);
    setAcceptingShareId(share.id);
    try {
      await onAcceptShare(share);
      onSelectVault?.(share.vaultOwnerId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Gagal menerima undangan brankas.', 'Failed to accept vault invitation.')
      );
    } finally {
      setAcceptingShareId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-7 sm:p-8">
        <div className="flex items-center justify-between gap-3 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 flex items-center justify-center shrink-0">
              {isSharedTarget ? (
                <Users className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              ) : isNewVault ? (
                <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              ) : (
                <Lock className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                {isSharedTarget
                  ? tr('Buka Brankas Bersama', 'Unlock Shared Vault')
                  : isNewVault
                    ? tr('Buat Frasa Sandi Brankas', 'Create Vault Passphrase')
                    : tr('Buka Brankas Terenkripsi', 'Unlock Encrypted Vault')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[190px]">
                {user.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLang}
              aria-label={tr('Ubah bahasa ke Inggris', 'Switch language to Indonesian')}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Languages className="w-3 h-3 text-teal-700 dark:text-teal-400" />
              <span>{lang === 'id' ? 'ID' : 'EN'}</span>
            </button>
            <button
              type="button"
              onClick={() => signOutAccount()}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer whitespace-nowrap"
            >
              {tr('Ganti Akun', 'Switch Account')}
            </button>
          </div>
        </div>

        {pendingInvites.length > 0 && (
          <div className="mt-4 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 space-y-2.5">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">
              {tr('Undangan Brankas Bersama', 'Shared Vault Invitations')} ({pendingInvites.length})
            </p>
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-amber-200/70 dark:border-amber-900/40"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white truncate">
                    {invite.ownerDisplayName}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                    {invite.ownerEmail} · {invite.role === 'editor' ? 'Editor' : 'Viewer'}
                  </p>
                </div>
                {onAcceptShare && (
                  <button
                    type="button"
                    disabled={acceptingShareId === invite.id}
                    onClick={() => void handleAcceptInvite(invite)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    <UserCheck className="w-3 h-3" />
                    <span>
                      {acceptingShareId === invite.id
                        ? tr('Memproses...', 'Processing...')
                        : tr('Terima', 'Accept')}
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {(sharedMemberships.length > 0 || isSharedTarget) && onSelectVault && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {tr('Brankas yang Dibuka', 'Vault to Open')}
            </label>
            <select
              value={targetVaultOwnerId}
              onChange={(e) => {
                setError(null);
                setPassphrase('');
                onSelectVault(e.target.value);
              }}
              aria-label={tr('Pilih brankas yang dibuka', 'Select vault to open')}
              className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
            >
              <option value={user.uid}>
                {tr('Brankas Pribadi Saya', 'My Personal Vault')} ({user.email})
              </option>
              {sharedMemberships.map((m) => {
                const info = incomingShares.find((s) => s.vaultOwnerId === m.vaultOwnerId);
                const label = info?.ownerDisplayName || info?.ownerEmail || m.vaultOwnerId;
                return (
                  <option key={m.id} value={m.vaultOwnerId}>
                    {tr('Brankas Bersama', 'Shared Vault')} · {label} ({m.role === 'editor' ? 'Editor' : 'Viewer'})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {isSharedTarget && isNewVault ? (
          <div className="mt-5 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {tr(
                `Pemilik brankas bersama (${sharedOwnerLabel}) belum membuat frasa sandi enkripsi brankasnya. Minta pemilik membuka aplikasi terlebih dahulu.`,
                `The shared vault owner (${sharedOwnerLabel}) hasn't created their vault encryption passphrase yet. Ask them to open the app first.`
              )}
            </p>
            {onSelectVault && (
              <button
                type="button"
                onClick={() => onSelectVault(user.uid)}
                className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
              >
                {tr('Buka Brankas Pribadi Saya', 'Open My Personal Vault')}
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-5 leading-relaxed">
              {isSharedTarget
                ? tr(
                    `Masukkan Frasa Sandi Brankas milik ${sharedOwnerLabel} untuk mendekripsi data keuangan bersama di perangkat ini.`,
                    `Enter ${sharedOwnerLabel}'s Vault Passphrase to decrypt shared financial data on this device.`
                  )
                : isNewVault
                  ? tr(
                      'Frasa sandi ini digunakan untuk menurunkan kunci enkripsi AES-256-GCM secara lokal di perangkat Anda. Gunakan frasa sandi yang sama saat membuka akun ini di perangkat lain.',
                      'This passphrase derives your AES-256-GCM encryption key locally on this device. Use the same passphrase when unlocking on other devices.'
                    )
                  : tr(
                      'Masukkan frasa sandi brankas Anda untuk mendekripsi saldo sumber dana dan riwayat transaksi secara lokal di perangkat ini.',
                      'Enter your vault passphrase to decrypt funding source balances and transaction history locally on this device.'
                    )}
            </p>

        <form onSubmit={isNewVault ? handleCreateVault : handleUnlockVault} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {tr('Frasa Sandi Brankas', 'Vault Passphrase')}
            </label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={
                  isNewVault
                    ? tr('Minimal 8 karakter', 'At least 8 characters')
                    : tr('Masukkan frasa sandi brankas', 'Enter vault passphrase')
                }
                autoFocus
                className="w-full px-3.5 py-2.5 pr-10 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={tr('Tampilkan frasa sandi', 'Show passphrase')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

            {!isSharedTarget && isNewVault && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {tr('Konfirmasi Frasa Sandi', 'Confirm Passphrase')}
                </label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder={tr('Ulangi frasa sandi brankas', 'Repeat vault passphrase')}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
            >
              {submitting
                ? tr('Memproses Kunci PBKDF2...', 'Deriving PBKDF2 Key...')
                : !isSharedTarget && isNewVault
                  ? tr('Aktifkan Enkripsi & Masuk', 'Enable Encryption & Continue')
                  : tr('Buka Brankas', 'Unlock Vault')}
            </button>
          </form>
          </>
        )}

        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>{tr('PBKDF2-SHA256 · 310.000 iterasi', 'PBKDF2-SHA256 · 310,000 iterations')}</span>
          <span>Zero-Knowledge E2EE</span>
        </div>
      </div>
    </div>
  );
};
