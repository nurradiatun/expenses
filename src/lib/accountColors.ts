import {
  formatAccountProviderLabel,
  type FinancialAccount,
  type FinancialTransaction,
} from '../types';

export interface AccountColorTheme {
  id: string;
  label: string;
  accentHex: string;
  textClass: string;
  badgeClass: string;
  cellTintClass: string;
}

export const ACCOUNT_COLOR_PALETTE: AccountColorTheme[] = [
  {
    id: 'blue',
    label: 'Biru',
    accentHex: '#2563EB',
    textClass: 'text-blue-700 dark:text-blue-400',
    badgeClass:
      'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
    cellTintClass: 'bg-blue-50/45 dark:bg-blue-950/25',
  },
  {
    id: 'amber',
    label: 'Oranye',
    accentHex: '#D97706',
    textClass: 'text-amber-700 dark:text-amber-400',
    badgeClass:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    cellTintClass: 'bg-amber-50/45 dark:bg-amber-950/25',
  },
  {
    id: 'violet',
    label: 'Ungu',
    accentHex: '#7C3AED',
    textClass: 'text-violet-700 dark:text-violet-400',
    badgeClass:
      'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/70',
    cellTintClass: 'bg-violet-50/45 dark:bg-violet-950/25',
  },
  {
    id: 'cyan',
    label: 'Sian',
    accentHex: '#0891B2',
    textClass: 'text-cyan-700 dark:text-cyan-400',
    badgeClass:
      'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/70',
    cellTintClass: 'bg-cyan-50/45 dark:bg-cyan-950/25',
  },
  {
    id: 'pink',
    label: 'Magenta',
    accentHex: '#DB2777',
    textClass: 'text-pink-700 dark:text-pink-400',
    badgeClass:
      'bg-pink-50 text-pink-800 border-pink-200 dark:bg-pink-950/60 dark:text-pink-300 dark:border-pink-800/70',
    cellTintClass: 'bg-pink-50/45 dark:bg-pink-950/25',
  },
  {
    id: 'emerald',
    label: 'Zamrud',
    accentHex: '#059669',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    badgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    cellTintClass: 'bg-emerald-50/45 dark:bg-emerald-950/25',
  },
  {
    id: 'orange',
    label: 'Koral',
    accentHex: '#EA580C',
    textClass: 'text-orange-700 dark:text-orange-400',
    badgeClass:
      'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/70',
    cellTintClass: 'bg-orange-50/45 dark:bg-orange-950/25',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    accentHex: '#4F46E5',
    textClass: 'text-indigo-700 dark:text-indigo-400',
    badgeClass:
      'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70',
    cellTintClass: 'bg-indigo-50/45 dark:bg-indigo-950/25',
  },
];

export interface ResolvedAccountColor {
  accountId: string;
  accountName: string;
  providerLabel: string;
  theme: AccountColorTheme;
}

export function buildAccountColorMap(
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[] = []
): Map<string, ResolvedAccountColor> {
  const map = new Map<string, ResolvedAccountColor>();
  let nextIdx = 0;

  for (const acc of accounts) {
    const theme = ACCOUNT_COLOR_PALETTE[nextIdx % ACCOUNT_COLOR_PALETTE.length];
    nextIdx += 1;
    map.set(acc.id, {
      accountId: acc.id,
      accountName: acc.name || formatAccountProviderLabel(acc.provider),
      providerLabel: formatAccountProviderLabel(acc.provider),
      theme,
    });
  }

  for (const tx of transactions) {
    const accId = tx.accountId || 'unassigned';
    if (!map.has(accId)) {
      const theme = ACCOUNT_COLOR_PALETTE[nextIdx % ACCOUNT_COLOR_PALETTE.length];
      nextIdx += 1;
      map.set(accId, {
        accountId: accId,
        accountName: accId === 'unassigned' ? 'Sumber Dana Lain' : 'Rekening Terarsip',
        providerLabel: 'Lainnya',
        theme,
      });
    }
  }

  return map;
}
