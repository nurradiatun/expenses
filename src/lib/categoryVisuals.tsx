import React from 'react';
import {
  Baby,
  Briefcase,
  Car,
  Coffee,
  Coins,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Layers,
  Plane,
  Receipt,
  RotateCcw,
  Send,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  normalizeCategoryKey,
  type CustomCategory,
  type TransactionType,
} from '../types';

export interface CategoryAppearance {
  icon?: string;
  color?: string;
}

export interface CategoryColorOption {
  hex: string;
  label: string;
}

export interface CategoryIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export const CATEGORY_COLOR_PALETTE: CategoryColorOption[] = [
  { hex: '#0F766E', label: 'Teal' },
  { hex: '#0284C7', label: 'Sky' },
  { hex: '#2563EB', label: 'Biru' },
  { hex: '#4F46E5', label: 'Indigo' },
  { hex: '#7C3AED', label: 'Violet' },
  { hex: '#DB2777', label: 'Pink' },
  { hex: '#E11D48', label: 'Rose' },
  { hex: '#DC2626', label: 'Merah' },
  { hex: '#EA580C', label: 'Oranye' },
  { hex: '#D97706', label: 'Amber' },
  { hex: '#65A30D', label: 'Lime' },
  { hex: '#059669', label: 'Emerald' },
  { hex: '#0891B2', label: 'Cyan' },
  { hex: '#475569', label: 'Slate' },
];

export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
  { key: 'Utensils', label: 'Makan & Resto', Icon: Utensils },
  { key: 'Coffee', label: 'Kopi & Kafe', Icon: Coffee },
  { key: 'Car', label: 'Transportasi', Icon: Car },
  { key: 'Fuel', label: 'BBM & Parkir', Icon: Fuel },
  { key: 'ShoppingBag', label: 'Belanja', Icon: ShoppingBag },
  { key: 'ShoppingCart', label: 'Groceries', Icon: ShoppingCart },
  { key: 'Sofa', label: 'Rumah Tangga', Icon: Sofa },
  { key: 'Home', label: 'Hunian & Sewa', Icon: Home },
  { key: 'Receipt', label: 'Tagihan', Icon: Receipt },
  { key: 'Zap', label: 'Listrik & Energi', Icon: Zap },
  { key: 'Wifi', label: 'Internet & Data', Icon: Wifi },
  { key: 'HeartPulse', label: 'Kesehatan', Icon: HeartPulse },
  { key: 'Gamepad2', label: 'Hiburan', Icon: Gamepad2 },
  { key: 'Plane', label: 'Perjalanan', Icon: Plane },
  { key: 'Send', label: 'Transfer', Icon: Send },
  { key: 'Landmark', label: 'Bank & Biaya', Icon: Landmark },
  { key: 'Briefcase', label: 'Gaji & Kerja', Icon: Briefcase },
  { key: 'Gift', label: 'Bonus & Hadiah', Icon: Gift },
  { key: 'TrendingUp', label: 'Investasi', Icon: TrendingUp },
  { key: 'RotateCcw', label: 'Refund & Cashback', Icon: RotateCcw },
  { key: 'Coins', label: 'Pemasukan', Icon: Coins },
  { key: 'Wallet', label: 'Kas & Dompet', Icon: Wallet },
  { key: 'GraduationCap', label: 'Pendidikan', Icon: GraduationCap },
  { key: 'Smartphone', label: 'Gadget & Apps', Icon: Smartphone },
  { key: 'Shirt', label: 'Fashion', Icon: Shirt },
  { key: 'Baby', label: 'Keluarga & Anak', Icon: Baby },
  { key: 'Dumbbell', label: 'Olahraga', Icon: Dumbbell },
  { key: 'ShieldCheck', label: 'Asuransi & Zakat', Icon: ShieldCheck },
  { key: 'Layers', label: 'Gabungan', Icon: Layers },
  { key: 'Tag', label: 'Lainnya', Icon: Tag },
];

const ICON_MAP = new Map<string, LucideIcon>(
  CATEGORY_ICON_OPTIONS.map((item) => [item.key, item.Icon])
);

export const DEFAULT_CATEGORY_VISUALS: Record<string, { icon: string; color: string }> = {
  // Expense categories
  'makan & minum': { icon: 'Utensils', color: '#EA580C' },
  transportasi: { icon: 'Car', color: '#0284C7' },
  'belanja & groceries': { icon: 'ShoppingCart', color: '#0F766E' },
  'barang rumah tangga': { icon: 'Sofa', color: '#D97706' },
  'tagihan & utilitas': { icon: 'Receipt', color: '#7C3AED' },
  'tempat tinggal': { icon: 'Home', color: '#4F46E5' },
  kesehatan: { icon: 'HeartPulse', color: '#E11D48' },
  'hiburan & gaya hidup': { icon: 'Gamepad2', color: '#DB2777' },
  'transfer & pengiriman': { icon: 'Send', color: '#0891B2' },
  'biaya bank': { icon: 'Landmark', color: '#DC2626' },
  lainnya: { icon: 'Tag', color: '#475569' },

  // Income categories
  gaji: { icon: 'Briefcase', color: '#059669' },
  'bonus & tunjangan': { icon: 'Gift', color: '#0F766E' },
  'usaha & freelance': { icon: 'Wallet', color: '#2563EB' },
  'investasi & bunga': { icon: 'TrendingUp', color: '#7C3AED' },
  'cashback & refund': { icon: 'RotateCcw', color: '#0891B2' },
  'transfer masuk': { icon: 'Send', color: '#0284C7' },
  pemasukan: { icon: 'Coins', color: '#059669' },
  'pemasukan lainnya': { icon: 'Coins', color: '#65A30D' },

  // Aggregated pie slice fallback
  'kategori lainnya': { icon: 'Layers', color: '#64748B' },
};

export function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return `rgba(71, 85, 105, ${alpha})`;
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getCategoryIconComponent(iconKey?: string): LucideIcon {
  if (iconKey && ICON_MAP.has(iconKey)) {
    return ICON_MAP.get(iconKey)!;
  }
  return Tag;
}

function hashCategoryColor(name: string): string {
  const key = normalizeCategoryKey(name);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLOR_PALETTE[hash % (CATEGORY_COLOR_PALETTE.length - 1)].hex;
}

export function getDefaultCategoryAppearance(
  categoryName: string,
  txType?: TransactionType
): { iconKey: string; color: string } {
  const key = normalizeCategoryKey(categoryName);
  const preset = DEFAULT_CATEGORY_VISUALS[key];
  if (preset) {
    return { iconKey: preset.icon, color: preset.color };
  }
  return {
    iconKey: txType === 'income' ? 'Coins' : 'Tag',
    color: hashCategoryColor(categoryName),
  };
}

export function resolveCategoryAppearance(
  categoryName: string,
  customCategories: CustomCategory[] = [],
  txType?: TransactionType
): { iconKey: string; color: string; hasCustomVisual: boolean } {
  const targetKey = normalizeCategoryKey(categoryName);

  const candidates = customCategories.filter((doc) => !doc.deleted);
  const exactTypedMatch = txType
    ? candidates.find(
        (doc) =>
          normalizeCategoryKey(doc.name) === targetKey &&
          (doc.categoryType || 'expense') === txType
      )
    : undefined;
  const anyMatch =
    exactTypedMatch ||
    candidates.find((doc) => normalizeCategoryKey(doc.name) === targetKey) ||
    candidates.find(
      (doc) => doc.systemKey && normalizeCategoryKey(doc.systemKey) === targetKey
    );

  const fallbackSourceName = anyMatch?.systemKey || categoryName;
  const defaults = getDefaultCategoryAppearance(
    fallbackSourceName,
    txType || anyMatch?.categoryType
  );

  const iconKey =
    anyMatch?.icon && ICON_MAP.has(anyMatch.icon) ? anyMatch.icon : defaults.iconKey;
  const color = anyMatch?.color || defaults.color;

  return {
    iconKey,
    color,
    hasCustomVisual: Boolean(anyMatch?.icon || anyMatch?.color),
  };
}

interface CategoryBadgeIconProps {
  categoryName: string;
  customCategories?: CustomCategory[];
  txType?: TransactionType;
  iconOverride?: string;
  colorOverride?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<
  NonNullable<CategoryBadgeIconProps['size']>,
  { box: string; icon: string }
> = {
  xs: { box: 'w-5 h-5 rounded-md', icon: 'w-3 h-3' },
  sm: { box: 'w-6 h-6 rounded-md', icon: 'w-3.5 h-3.5' },
  md: { box: 'w-8 h-8 rounded-lg', icon: 'w-4 h-4' },
  lg: { box: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5' },
};

export const CategoryBadgeIcon: React.FC<CategoryBadgeIconProps> = ({
  categoryName,
  customCategories = [],
  txType,
  iconOverride,
  colorOverride,
  size = 'sm',
  className = '',
}) => {
  const resolved = resolveCategoryAppearance(categoryName, customCategories, txType);
  const iconKey = iconOverride && ICON_MAP.has(iconOverride) ? iconOverride : resolved.iconKey;
  const color = colorOverride || resolved.color;
  const Icon = getCategoryIconComponent(iconKey);
  const sizing = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 border ${sizing.box} ${className}`}
      style={{
        color,
        backgroundColor: hexToRgba(color, 0.14),
        borderColor: hexToRgba(color, 0.26),
      }}
      aria-hidden="true"
    >
      <Icon className={sizing.icon} />
    </span>
  );
};
