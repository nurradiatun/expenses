export type SupportedCurrency = 'AED' | 'IDR' | 'USD' | 'SGD' | 'EUR';
export type DisplayCurrency = 'AED' | 'IDR' | 'USD';
export type AccountProvider = 'ADCB' | 'MANUAL' | 'BCA' | 'MANDIRI' | 'OTHER';
export type TransactionType = 'income' | 'expense';
export type TransactionSource = 'manual' | 'pdf' | 'adcb_api';

export function formatAccountProviderLabel(provider: AccountProvider): string {
  switch (provider) {
    case 'ADCB':
      return 'ADCB';
    case 'MANUAL':
      return 'Cash';
    case 'BCA':
      return 'Bank BCA';
    case 'MANDIRI':
      return 'Bank Mandiri';
    default:
      return 'Lainnya';
  }
}

export const EXPENSE_CATEGORIES = [
  'Makan & Minum',
  'Transportasi',
  'Belanja & Groceries',
  'Barang Rumah Tangga',
  'Tagihan & Utilitas',
  'Tempat Tinggal',
  'Kesehatan',
  'Hiburan & Gaya Hidup',
  'Transfer & Pengiriman',
  'Biaya Bank',
  'Lainnya',
] as const;

export const INCOME_CATEGORIES = [
  'Gaji',
  'Bonus & Tunjangan',
  'Usaha & Freelance',
  'Investasi & Bunga',
  'Cashback & Refund',
  'Transfer Masuk',
  'Pemasukan',
  'Pemasukan Lainnya',
] as const;

export const TRANSACTION_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  ...INCOME_CATEGORIES,
] as const;

const INCOME_BUILT_IN_KEY_SET = new Set<string>(
  INCOME_CATEGORIES.map((c) => c.toLowerCase())
);

const HOUSEHOLD_MERCHANT_REGEX =
  /\b(IKEA|HOME\s*CENTRE|HOMECENTRE|HOME\s*BOX|HOMEBOX|ACE\s*HARDWARE|INFORMA|MR\.?\s*DIY|ATRIA|DANUBE\s*HOME|PAN\s*EMIRATES|PAN\s*HOME|POTTERY\s*BARN|WEST\s*ELM)\b/i;

export function isHouseholdGoodsMerchant(text: string): boolean {
  return HOUSEHOLD_MERCHANT_REGEX.test(text);
}

export function inferCategoryFromMerchant(
  text: string,
  isIncome = false,
  fallback?: string
): string {
  const upper = text.toUpperCase();
  if (isIncome) {
    if (/\b(SALARY|PAYROLL|GAJI|WAGE|ALLOWANCE|TUNJANGAN)\b/.test(upper)) return 'Gaji';
    if (/\b(BONUS|COMMISSION|INSENTIF|THR)\b/.test(upper)) return 'Bonus & Tunjangan';
    if (/\b(CASHBACK|REFUND|REBATE|REVERSAL|KEMBALIAN)\b/.test(upper)) return 'Cashback & Refund';
    if (/\b(DIVIDEND|INTEREST|BUNGA|PROFIT|YIELD)\b/.test(upper)) return 'Investasi & Bunga';
    if (/\b(FREELANCE|CONSULTING|INVOICE|RETAINER|CLIENT|USAHA|PENJUALAN)\b/.test(upper)) {
      return 'Usaha & Freelance';
    }
    if (/\b(TRANSFER|IBAN|REMITTANCE|WISE|TRNS|INCOMING)\b/.test(upper)) return 'Transfer Masuk';
    return fallback || 'Pemasukan';
  }

  const defaultExpenseFallback = fallback || 'Lainnya';
  if (HOUSEHOLD_MERCHANT_REGEX.test(upper)) return 'Barang Rumah Tangga';
  if (/ADNOC|UBER|CAREEM|SALIK|RTA|GRAB|GOJEK|FUEL|SHELL|PERTAMINA/.test(upper)) return 'Transportasi';
  if (/CARREFOUR|LULU|SPINNEYS|ALDI|INDOMARET|ALFAMART|GROCERY|SUPERMARKET/.test(upper)) return 'Belanja & Groceries';
  if (/TALABAT|DELIVEROO|STARBUCKS|CAFE|RESTAURANT|COFFEE|MCDONALD|RESTO|WARUNG/.test(upper)) return 'Makan & Minum';
  if (/DEWA|ETISALAT|DU TELECOM|PLN|TELKOM|INDIHOME|WATER|ELECTRICITY/.test(upper)) return 'Tagihan & Utilitas';
  if (/RENT|EMAAR|ALDAR|SEWA|APARTMENT/.test(upper)) return 'Tempat Tinggal';
  if (/HOSPITAL|CLINIC|PHARMACY|APOTEK|MEDICAL/.test(upper)) return 'Kesehatan';
  if (/TRANSFER|IBAN|REMITTANCE|WISE|TRNS/.test(upper)) return 'Transfer & Pengiriman';
  if (/FEE|CHARGE|ADMIN|VAT|COMMISSION/.test(upper)) return 'Biaya Bank';
  return defaultExpenseFallback;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  preferredCurrency: DisplayCurrency;
  aedToIdrRate: number;
}

export interface ExchangeRatesInfo {
  ratesToIdr: Record<SupportedCurrency, number>;
  source: string;
  updatedAtIso: string;
  providerUpdatedAt?: string;
  isLive: boolean;
}

export interface VaultConfigDoc {
  ownerId: string;
  salt: string;
  kdfIterations: number;
  keyCheckCiphertext: string;
  keyCheckIv: string;
  algorithm: 'AES-GCM-256';
}

export interface DecryptedAccountPayload {
  name: string;
  accountNumberMasked: string;
  balance: number;
  institution: string;
  notes: string;
  adcbConnectionRef?: string;
  adcbProduct?: string;
}

export interface FinancialAccount {
  id: string;
  ownerId: string;
  provider: AccountProvider;
  currency: SupportedCurrency;
  autoSyncDaily: boolean;
  syncHour: number;
  lastSyncedAtIso: string;
  // Decrypted sensitive payload:
  name: string;
  accountNumberMasked: string;
  balance: number;
  institution: string;
  notes: string;
  adcbConnectionRef?: string;
  adcbProduct?: string;
}

export interface DecryptedTransactionPayload {
  date: string; // YYYY-MM-DD
  description: string;
  merchant: string;
  amount: number;
  currency: SupportedCurrency;
  category: string;
  reference: string;
  notes: string;
  createdByUid?: string;
  createdByName?: string;
  createdByEmail?: string;
  createdAtIso?: string;
  updatedByUid?: string;
  updatedByName?: string;
  updatedByEmail?: string;
  updatedAtIso?: string;
}

export interface FinancialTransaction {
  id: string;
  ownerId: string;
  accountId: string;
  monthKey: string; // YYYY-MM
  txType: TransactionType;
  source: TransactionSource;
  // Decrypted sensitive payload:
  date: string;
  description: string;
  merchant: string;
  amount: number;
  currency: SupportedCurrency;
  category: string;
  reference: string;
  notes: string;
  createdByUid?: string;
  createdByName?: string;
  createdByEmail?: string;
  createdAtIso?: string;
  updatedByUid?: string;
  updatedByName?: string;
  updatedByEmail?: string;
  updatedAtIso?: string;
}

export type VaultShareRole = 'editor' | 'viewer';
export type VaultShareStatus = 'pending' | 'active' | 'revoked';

export interface VaultShare {
  id: string;
  vaultOwnerId: string;
  ownerEmail: string;
  ownerDisplayName: string;
  memberEmail: string;
  memberUid: string;
  memberDisplayName: string;
  role: VaultShareRole;
  status: VaultShareStatus;
}

export interface VaultMember {
  id: string;
  vaultOwnerId: string;
  memberUid: string;
  memberEmail: string;
  memberDisplayName: string;
  role: VaultShareRole;
  shareId: string;
}

export interface SyncLogEntry {
  id: string;
  ownerId: string;
  accountId: string;
  syncType: 'adcb_daily' | 'adcb_manual' | 'pdf_import';
  status: 'success' | 'failed';
  recordsCount: number;
  summary: string;
  createdAtIso: string;
}

export interface ExtractedPdfTransaction {
  id: string;
  selected: boolean;
  date: string;
  postingDate?: string;
  dateSource?: 'value_date' | 'posting_date' | 'document_date';
  description: string;
  merchant: string;
  amount: number;
  type: TransactionType;
  category: string;
  reference: string;
}

export interface ExtractedPdfStatement {
  bankName: string;
  accountNumberMasked: string;
  currency: SupportedCurrency;
  statementPeriod: string;
  openingBalance: number;
  closingBalance: number;
  detectedDateColumn?: string;
  transactions: ExtractedPdfTransaction[];
}

export interface DecryptedCustomCategoryPayload {
  name: string;
  categoryType?: TransactionType;
  icon?: string;
  color?: string;
  systemKey?: string;
  deleted?: boolean;
}

export interface CustomCategory {
  id: string;
  ownerId: string;
  name: string;
  categoryType?: TransactionType;
  icon?: string;
  color?: string;
  systemKey?: string;
  deleted?: boolean;
}

export interface DecryptedBudgetPayload {
  category: string;
  monthlyLimit: number;
  currency: SupportedCurrency;
  periodMonths?: number;
  anchorMonth?: string;
  budgetType?: TransactionType;
  targetMonth?: string; // Optional YYYY-MM for month-specific / future-month override
}

export interface CategoryBudget {
  id: string;
  ownerId: string;
  category: string;
  monthlyLimit: number;
  currency: SupportedCurrency;
  periodMonths: number;
  anchorMonth?: string;
  budgetType?: TransactionType;
  targetMonth?: string;
}

export interface ResolvedBuiltInCategory {
  systemKey: string;
  name: string;
  categoryType: TransactionType;
  icon?: string;
  color?: string;
  overrideDoc?: CustomCategory;
  isModified: boolean;
}

export function normalizeCategoryKey(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getBuiltInCategoryType(systemKey: string): TransactionType {
  return INCOME_BUILT_IN_KEY_SET.has(normalizeCategoryKey(systemKey)) ? 'income' : 'expense';
}

export function getResolvedBuiltInCategories(
  categoryDocs: CustomCategory[],
  typeFilter?: TransactionType
): {
  active: ResolvedBuiltInCategory[];
  hasOverrides: boolean;
  deletedSystemKeys: string[];
} {
  const overrideBySystemKey = new Map<string, CustomCategory>();
  for (const doc of categoryDocs) {
    if (doc.systemKey) {
      overrideBySystemKey.set(doc.systemKey, doc);
    }
  }

  const active: ResolvedBuiltInCategory[] = [];
  const deletedSystemKeys: string[] = [];
  let hasOverrides = false;

  const builtInSource: readonly string[] =
    typeFilter === 'income'
      ? INCOME_CATEGORIES
      : typeFilter === 'expense'
        ? EXPENSE_CATEGORIES
        : TRANSACTION_CATEGORIES;

  for (const sysName of builtInSource) {
    const categoryType = getBuiltInCategoryType(sysName);
    const ov = overrideBySystemKey.get(sysName);
    if (ov) {
      hasOverrides = true;
      if (ov.deleted) {
        deletedSystemKeys.push(sysName);
        continue;
      }
      active.push({
        systemKey: sysName,
        name: ov.name,
        categoryType,
        icon: ov.icon,
        color: ov.color,
        overrideDoc: ov,
        isModified: ov.name !== sysName || Boolean(ov.icon) || Boolean(ov.color),
      });
    } else {
      active.push({
        systemKey: sysName,
        name: sysName,
        categoryType,
        isModified: false,
      });
    }
  }

  return { active, hasOverrides, deletedSystemKeys };
}

export function getPureCustomCategories(
  categoryDocs: CustomCategory[],
  typeFilter?: TransactionType
): CustomCategory[] {
  return categoryDocs.filter((doc) => {
    if (doc.systemKey || doc.deleted) return false;
    if (!typeFilter) return true;
    const resolvedType: TransactionType = doc.categoryType || 'expense';
    return resolvedType === typeFilter;
  });
}

export function resolveBuiltInCategoryName(
  defaultName: string,
  categoryDocs: CustomCategory[] = [],
  txType?: TransactionType
): string {
  const targetKey = normalizeCategoryKey(defaultName);
  const { active } = getResolvedBuiltInCategories(categoryDocs, txType);
  const match = active.find((item) => normalizeCategoryKey(item.systemKey) === targetKey);
  if (match) return match.name;

  // If no txType provided, also check across all built-ins
  if (txType) {
    const allResolved = getResolvedBuiltInCategories(categoryDocs);
    const anyMatch = allResolved.active.find(
      (item) => normalizeCategoryKey(item.systemKey) === targetKey
    );
    if (anyMatch) return anyMatch.name;
  }

  // If the built-in was explicitly deleted, fall back to active default of that type
  const override = categoryDocs.find(
    (doc) => doc.systemKey && normalizeCategoryKey(doc.systemKey) === targetKey
  );
  if (override?.deleted) {
    const fallbackKey =
      txType === 'income' || getBuiltInCategoryType(defaultName) === 'income'
        ? 'pemasukan lainnya'
        : 'lainnya';
    const fallbackItem =
      active.find((item) => normalizeCategoryKey(item.systemKey) === fallbackKey) ||
      active.find((item) => normalizeCategoryKey(item.systemKey) === 'pemasukan') ||
      active.find((item) => normalizeCategoryKey(item.systemKey) === 'lainnya');
    return fallbackItem?.name || active[0]?.name || (txType === 'income' ? 'Pemasukan' : 'Lainnya');
  }

  return defaultName;
}

export function getUnlistedTransactionCategories(
  categoryDocs: CustomCategory[],
  transactions: FinancialTransaction[] = [],
  typeFilter?: TransactionType
): string[] {
  const registeredKeys = new Set<string>();
  const { active } = getResolvedBuiltInCategories(categoryDocs, typeFilter);
  for (const item of active) registeredKeys.add(normalizeCategoryKey(item.name));
  for (const custom of getPureCustomCategories(categoryDocs, typeFilter)) {
    registeredKeys.add(normalizeCategoryKey(custom.name));
  }

  const seen = new Set<string>();
  const unlisted: string[] = [];
  for (const tx of transactions) {
    if (typeFilter && tx.txType !== typeFilter) continue;
    const clean = (tx.category || '').trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (registeredKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    unlisted.push(clean);
  }
  return unlisted.sort((a, b) => a.localeCompare(b));
}

export function mergeCategoryListsByType(
  categoryDocs: CustomCategory[],
  transactions: FinancialTransaction[] = [],
  txType: TransactionType
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const pushUnique = (raw: string) => {
    const clean = (raw || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  };

  const { active } = getResolvedBuiltInCategories(categoryDocs, txType);
  for (const item of active) pushUnique(item.name);
  for (const custom of getPureCustomCategories(categoryDocs, txType)) pushUnique(custom.name);
  for (const tx of transactions) {
    if (tx.txType === txType) pushUnique(tx.category);
  }

  return result;
}

export function mergeCategoryLists(
  categoryDocs: CustomCategory[],
  transactions: FinancialTransaction[] = []
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const pushUnique = (raw: string) => {
    const clean = (raw || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  };

  const { active } = getResolvedBuiltInCategories(categoryDocs);
  for (const item of active) pushUnique(item.name);
  for (const custom of getPureCustomCategories(categoryDocs)) pushUnique(custom.name);
  for (const tx of transactions) pushUnique(tx.category);

  return result;
}

export function compareTransactionsByDateDesc(
  a: Pick<FinancialTransaction, 'date' | 'createdAtIso' | 'id'>,
  b: Pick<FinancialTransaction, 'date' | 'createdAtIso' | 'id'>
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const aCreated = a.createdAtIso || '';
  const bCreated = b.createdAtIso || '';
  if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function compareTransactionsByDateAsc(
  a: Pick<FinancialTransaction, 'date' | 'createdAtIso' | 'id'>,
  b: Pick<FinancialTransaction, 'date' | 'createdAtIso' | 'id'>
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const aCreated = a.createdAtIso || '';
  const bCreated = b.createdAtIso || '';
  if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

