import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from 'firebase/auth';
import { describe, expect, it, vi } from 'vitest';
import { AuthAndVaultGate } from '../components/AuthAndVaultGate';
import { VaultSharingModal } from '../components/VaultSharingModal';
import type { VaultConfigDoc, VaultMember, VaultShare } from '../types';

vi.mock('../lib/firebase', () => ({
  signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  signOutAccount: vi.fn().mockResolvedValue(undefined),
}));

const ownedShares: VaultShare[] = [
  {
    id: 'share-1',
    vaultOwnerId: 'uid-husband',
    ownerEmail: 'suami@gmail.com',
    ownerDisplayName: 'Suami',
    memberEmail: 'istri@gmail.com',
    memberUid: 'uid-wife',
    memberDisplayName: 'Istri',
    role: 'editor',
    status: 'active',
  },
];

const pendingIncoming: VaultShare[] = [
  {
    id: 'share-in-1',
    vaultOwnerId: 'uid-partner',
    ownerEmail: 'pasangan@gmail.com',
    ownerDisplayName: 'Pasangan',
    memberEmail: 'suami@gmail.com',
    memberUid: '',
    memberDisplayName: '',
    role: 'editor',
    status: 'pending',
  },
];

const activeMemberships: VaultMember[] = [
  {
    id: 'uid-partner_uid-husband',
    vaultOwnerId: 'uid-partner',
    memberUid: 'uid-husband',
    memberEmail: 'suami@gmail.com',
    memberDisplayName: 'Suami',
    role: 'editor',
    shareId: 'share-in-2',
  },
];

describe('Multi-Account Family Vault Sharing', () => {
  it('allows inviting spouse email, changing role, revoking access, accepting invites, and switching vaults in VaultSharingModal', async () => {
    const user = userEvent.setup();
    const onInviteMember = vi.fn().mockResolvedValue(undefined);
    const onAcceptShare = vi.fn().mockResolvedValue(undefined);
    const onUpdateRole = vi.fn().mockResolvedValue(undefined);
    const onRevokeShare = vi.fn().mockResolvedValue(undefined);
    const onSwitchVault = vi.fn();
    const onLeaveSharedVault = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <VaultSharingModal
        isOpen={true}
        onClose={onClose}
        currentUserUid="uid-husband"
        currentUserEmail="suami@gmail.com"
        activeVaultOwnerId="uid-husband"
        ownedShares={ownedShares}
        incomingShares={[
          ...pendingIncoming,
          {
            ...pendingIncoming[0],
            id: 'share-in-2',
            status: 'active',
            memberUid: 'uid-husband',
          },
        ]}
        sharedMemberships={activeMemberships}
        onInviteMember={onInviteMember}
        onAcceptShare={onAcceptShare}
        onUpdateRole={onUpdateRole}
        onRevokeShare={onRevokeShare}
        onSwitchVault={onSwitchVault}
        onLeaveSharedVault={onLeaveSharedVault}
      />
    );

    // 1. Accept pending incoming invite
    await user.click(screen.getByRole('button', { name: /Terima Undangan/i }));
    expect(onAcceptShare).toHaveBeenCalledWith(pendingIncoming[0]);

    // 2. Invite new email as Viewer
    const emailInput = screen.getByLabelText('Email Google anggota yang diundang');
    await user.type(emailInput, 'keluarga@gmail.com');
    await user.selectOptions(screen.getByLabelText('Peran akses anggota'), 'viewer');
    await user.click(screen.getByRole('button', { name: /^Undang$/i }));
    expect(onInviteMember).toHaveBeenCalledWith('keluarga@gmail.com', 'viewer');

    // 3. Change existing member role from editor to viewer
    await user.selectOptions(screen.getByLabelText('Ubah peran untuk istri@gmail.com'), 'viewer');
    expect(onUpdateRole).toHaveBeenCalledWith(ownedShares[0], 'viewer');

    // 4. Revoke share
    await user.click(screen.getByLabelText('Cabut akses istri@gmail.com'));
    expect(onRevokeShare).toHaveBeenCalledWith(ownedShares[0]);

    // 5. Switch to partner shared vault
    await user.click(screen.getByRole('button', { name: /Buka Brankas Ini/i }));
    expect(onSwitchVault).toHaveBeenCalledWith('uid-partner');
  });

  it('shows incoming invite acceptance and shared vault switcher inside AuthAndVaultGate', async () => {
    const user = userEvent.setup();
    const onAcceptShare = vi.fn().mockResolvedValue(undefined);
    const onSelectVault = vi.fn();

    const mockUser = {
      uid: 'uid-husband',
      email: 'suami@gmail.com',
      displayName: 'Suami',
    } as unknown as User;

    const mockVaultConfig: VaultConfigDoc = {
      ownerId: 'uid-husband',
      salt: 'c2FsdA==',
      kdfIterations: 310000,
      keyCheckCiphertext: 'dmVyaWZpZXI=',
      keyCheckIv: 'aXY=',
      algorithm: 'AES-GCM-256',
    };

    render(
      <AuthAndVaultGate
        user={mockUser}
        vaultConfig={mockVaultConfig}
        loadingAuth={false}
        loadingConfig={false}
        activeVaultOwnerId="uid-husband"
        incomingShares={pendingIncoming}
        sharedMemberships={activeMemberships}
        onSelectVault={onSelectVault}
        onAcceptShare={onAcceptShare}
        onUnlocked={vi.fn()}
      />
    );

    expect(screen.getByText(/Undangan Brankas Bersama \(1\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Terima/i }));
    expect(onAcceptShare).toHaveBeenCalledWith(pendingIncoming[0]);

    const selector = screen.getByLabelText('Pilih brankas yang dibuka');
    await user.selectOptions(selector, 'uid-partner');
    expect(onSelectVault).toHaveBeenCalledWith('uid-partner');
  });
});
