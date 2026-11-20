import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdcbAccountsView } from '../components/AdcbAccountsView';
import type { FinancialAccount } from '../types';

const sampleAccounts: FinancialAccount[] = [
  {
    id: 'acc-1',
    ownerId: 'u1',
    provider: 'ADCB',
    currency: 'AED',
    autoSyncDaily: false,
    syncHour: 6,
    lastSyncedAtIso: '',
    name: 'ADCB Savings',
    accountNumberMasked: '****1234',
    balance: 15000,
    institution: 'ADCB Bank',
    notes: '',
  },
];

describe('AdcbAccountsView (Data Rekening / List Sumber Dana)', () => {
  it('renders List Sumber Dana without removed ciphertext subtitles and opens Tambah Sumber Dana modal on button click', async () => {
    const user = userEvent.setup();
    const onCreateManualAccount = vi.fn().mockResolvedValue(undefined);

    render(
      <AdcbAccountsView
        accounts={sampleAccounts}
        transactions={[]}
        onUpdateAccount={vi.fn().mockResolvedValue(0)}
        onCreateManualAccount={onCreateManualAccount}
        onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText('List Sumber Dana')).toBeInTheDocument();
    expect(screen.queryByText(/Daftar Sumber Dana Terenkripsi/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tersimpan dalam bentuk ciphertext di Firestore/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Catat sumber dana ADCB maupun uang tunai/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Riwayat Impor Mutasi/i)).not.toBeInTheDocument();

    // Open Tambah Sumber Dana modal via button
    await user.click(screen.getByRole('button', { name: /Tambah Sumber Dana/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Tambah Sumber Dana')).toBeInTheDocument();
    expect(within(dialog).queryByText(/\(ADCB & Cash\)/i)).not.toBeInTheDocument();

    await user.type(within(dialog).getByPlaceholderText(/Contoh: ADCB TouchPoints/i), 'Dompet Cash');
    await user.click(within(dialog).getByRole('button', { name: /Simpan Sumber Dana/i }));

    expect(onCreateManualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Dompet Cash',
        provider: 'ADCB',
        currency: 'AED',
      })
    );
  });
});
