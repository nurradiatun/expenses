import React, { useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  KeyRound,
  LogOut,
  MailPlus,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { VaultMember, VaultShare, VaultShareRole } from '../types';

interface VaultSharingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserUid: string;
  currentUserEmail: string;
  activeVaultOwnerId: string;
  ownedShares: VaultShare[];
  incomingShares: VaultShare[];
  sharedMemberships: VaultMember[];
  onInviteMember: (memberEmail: string, role: VaultShareRole) => Promise<void>;
  onAcceptShare: (share: VaultShare) => Promise<void>;
  onUpdateRole: (share: VaultShare, role: VaultShareRole) => Promise<void>;
  onRevokeShare: (share: VaultShare) => Promise<void>;
  onSwitchVault: (vaultOwnerId: string) => void;
  onLeaveSharedVault: (membership: VaultMember) => Promise<void>;
}

export const VaultSharingModal: React.FC<VaultSharingModalProps> = ({
  isOpen,
  onClose,
  currentUserUid,
  currentUserEmail,
  activeVaultOwnerId,
  ownedShares,
  incomingShares,
  sharedMemberships,
  onInviteMember,
  onAcceptShare,
  onUpdateRole,
  onRevokeShare,
  onSwitchVault,
  onLeaveSharedVault,
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<VaultShareRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const isViewingOwnVault = activeVaultOwnerId === currentUserUid;
  const pendingIncoming = incomingShares.filter((s) => s.status === 'pending');

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const clean = inviteEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setError('Masukkan alamat email Google pasangan atau anggota keluarga yang valid.');
      return;
    }

    setSubmitting(true);
    try {
      await onInviteMember(clean, inviteRole);
      setInviteEmail('');
      setSuccess(
        `Undangan dikirim ke ${clean}. Minta mereka masuk dengan akun Google tersebut dan terima undangan.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim undangan berbagi brankas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async (share: VaultShare) => {
    setError(null);
    setSuccess(null);
    setBusyId(share.id);
    try {
      await onAcceptShare(share);
      setSuccess(`Akses ke brankas ${share.ownerDisplayName} aktif. Anda dapat beralih ke brankas tersebut.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menerima undangan.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (share: VaultShare, nextRole: VaultShareRole) => {
    setError(null);
    setSuccess(null);
    setBusyId(share.id);
    try {
      await onUpdateRole(share, nextRole);
      setSuccess(`Peran ${share.memberEmail} diperbarui menjadi ${nextRole === 'editor' ? 'Editor' : 'Viewer'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui peran anggota.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (share: VaultShare) => {
    setError(null);
    setSuccess(null);
    setBusyId(share.id);
    try {
      await onRevokeShare(share);
      setSuccess(`Akses untuk ${share.memberEmail} telah dicabut.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencabut akses.');
    } finally {
      setBusyId(null);
    }
  };

  const handleLeave = async (membership: VaultMember) => {
    setError(null);
    setSuccess(null);
    setBusyId(membership.id);
    try {
      await onLeaveSharedVault(membership);
      setSuccess('Anda telah keluar dari brankas bersama tersebut.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal keluar dari brankas bersama.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-sharing-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
      >
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-900 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            </div>
            <div>
              <h2
                id="vault-sharing-title"
                className="font-display text-base font-semibold text-slate-900 dark:text-white"
              >
                Berbagi Brankas Keluarga &amp; Multi-Akun
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Kelola akses bersama suami/istri agar dapat melihat &amp; mencatat transaksi dari akun Google masing-masing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal berbagi brankas"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Section 1: Active Vault Switcher */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Pilih Brankas Aktif
              </h3>
              <span className="text-[11px] text-slate-400">
                Akun: {currentUserEmail}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  onSwitchVault(currentUserUid);
                  onClose();
                }}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                  isViewingOwnVault
                    ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    Brankas Pribadi Saya
                  </span>
                  {isViewingOwnVault ? (
                    <span className="px-1.5 py-0.5 rounded bg-teal-700 text-white text-[10px] font-semibold">
                      Aktif
                    </span>
                  ) : (
                    <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Pemilik penuh · {ownedShares.filter((s) => s.status === 'active').length} anggota aktif
                </p>
              </button>

              {sharedMemberships.map((m) => {
                const incomingInfo = incomingShares.find((s) => s.vaultOwnerId === m.vaultOwnerId);
                const ownerLabel =
                  incomingInfo?.ownerDisplayName ||
                  incomingInfo?.ownerEmail ||
                  `Brankas ${m.vaultOwnerId.slice(0, 6)}`;
                const isActive = activeVaultOwnerId === m.vaultOwnerId;
                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl border flex flex-col justify-between gap-2 ${
                      isActive
                        ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          Brankas · {ownerLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Peran: {m.role === 'editor' ? 'Editor (Catat & Edit)' : 'Viewer (Hanya Lihat)'}
                        </p>
                      </div>
                      {isActive && (
                        <span className="px-1.5 py-0.5 rounded bg-teal-700 text-white text-[10px] font-semibold shrink-0">
                          Aktif
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSwitchVault(m.vaultOwnerId);
                            onClose();
                          }}
                          className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                        >
                          Buka Brankas Ini →
                        </button>
                      ) : (
                        <span className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">
                          Sedang dibuka
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => void handleLeave(m)}
                        className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Keluar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Pending Incoming Invitations */}
          {pendingIncoming.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Undangan Brankas Masuk ({pendingIncoming.length})
              </h3>
              <div className="space-y-2">
                {pendingIncoming.map((share) => (
                  <div
                    key={share.id}
                    className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                        {share.ownerDisplayName} ({share.ownerEmail})
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                        Mengundang Anda sebagai{' '}
                        <span className="font-semibold">
                          {share.role === 'editor' ? 'Editor (Lihat & Tambah Transaksi)' : 'Viewer (Hanya Lihat)'}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === share.id}
                      onClick={() => void handleAccept(share)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{busyId === share.id ? 'Memproses...' : 'Terima Undangan'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: E2EE Passphrase Notice */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex items-start gap-3">
            <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <span className="font-semibold text-slate-900 dark:text-white">
                Keamanan Zero-Knowledge E2EE:
              </span>{' '}
              Setiap transaksi tetap terenkripsi AES-256-GCM. Bagikan{' '}
              <span className="font-semibold">Frasa Sandi Brankas</span> Anda secara langsung kepada pasangan agar mereka dapat mendekripsi data saat membuka brankas bersama. Setiap transaksi otomatis mencatat nama &amp; email Google pencatatnya.
            </div>
          </div>

          {/* Section 4: Invite & Manage Owned Vault Members */}
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Undang Anggota ke Brankas Pribadi Saya
              </h3>
            </div>

            <form onSubmit={handleInviteSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email Google pasangan (mis. pasangan@gmail.com)"
                aria-label="Email Google anggota yang diundang"
                className="sm:col-span-6 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as VaultShareRole)}
                aria-label="Peran akses anggota"
                className="sm:col-span-3 px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
              >
                <option value="editor">Editor (Lihat &amp; Catat)</option>
                <option value="viewer">Viewer (Hanya Lihat)</option>
              </select>
              <button
                type="submit"
                disabled={submitting}
                className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <MailPlus className="w-3.5 h-3.5" />
                <span>{submitting ? 'Mengundang...' : 'Undang'}</span>
              </button>
            </form>

            {ownedShares.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                Belum ada akun lain yang diundang ke brankas pribadi Anda.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {ownedShares.map((share) => (
                  <div
                    key={share.id}
                    className="p-3.5 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {share.memberDisplayName || share.memberEmail}
                        </p>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            share.status === 'active'
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {share.status === 'active' ? 'Aktif' : 'Menunggu'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {share.memberEmail}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={share.role}
                        disabled={busyId === share.id}
                        onChange={(e) =>
                          void handleRoleChange(share, e.target.value as VaultShareRole)
                        }
                        aria-label={`Ubah peran untuk ${share.memberEmail}`}
                        className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>

                      <button
                        type="button"
                        disabled={busyId === share.id}
                        onClick={() => void handleRevoke(share)}
                        aria-label={`Cabut akses ${share.memberEmail}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900/60 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Cabut</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
