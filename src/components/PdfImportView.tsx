import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertCircle,
  ArrowUpDown,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  formatAccountProviderLabel,
  INCOME_CATEGORIES,
  inferCategoryFromMerchant,
  isHouseholdGoodsMerchant,
  resolveBuiltInCategoryName,
  type CustomCategory,
  type ExtractedPdfStatement,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
  type TransactionType,
} from '../types';
import { formatMoney } from '../lib/formatters';
import { CategoryBadgeIcon, type CategoryAppearance } from '../lib/categoryVisuals';
import {
  parsePdfStatementLocally,
  PdfPasswordError,
  preparePdfChunksForAiExtraction,
} from '../lib/localPdfParser';
import { parseCsvStatementFile } from '../lib/csvStatementParser';

interface PdfImportViewProps {
  accounts: FinancialAccount[];
  existingTransactions: FinancialTransaction[];
  categories?: string[];
  expenseCategories?: string[];
  incomeCategories?: string[];
  customCategories?: CustomCategory[];
  customCategoryNames?: string[];
  draftStorageKey?: string;
  onSessionKeepAlive?: () => void;
  onCreateCategory?: (
    name: string,
    categoryType: TransactionType,
    appearance?: CategoryAppearance
  ) => Promise<string>;
  onImportConfirm: (params: {
    targetAccountId: string | 'CREATE_NEW';
    newAccountSpec?: {
      name: string;
      institution: string;
      accountNumberMasked: string;
      currency: SupportedCurrency;
      balance: number;
    };
    statement: ExtractedPdfStatement;
    updateBalanceToClosing: boolean;
  }) => Promise<number>;
}

interface ImportFileItem {
  id: string;
  file: File;
  kind: 'pdf' | 'image' | 'csv';
  status: 'pending' | 'processing' | 'done' | 'locked' | 'error';
  txCount: number;
  errorMsg?: string;
  previewUrl?: string;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_FILES = 30;
const PREVIEW_PAGE_SIZE = 20;
const IMAGE_CHUNK_SIZE = 1;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_PIXELS = 1_400_000;
const SUPPORTED_CURRENCIES: SupportedCurrency[] = ['AED', 'IDR', 'USD', 'SGD', 'EUR'];

async function postJsonWithSafeParse(url: string, body: unknown): Promise<Record<string, unknown>> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 95_000);
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Waktu pemrosesan AI habis. Coba unggah gambar dengan resolusi lebih ringan.');
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw new Error('Koneksi ke server terputus saat memproses dokumen. Silakan coba lagi.');
    } finally {
      clearTimeout(timer);
    }

    const rawText = await res.text();
    const trimmed = rawText.trimStart();
    const isHtmlOrProxyPage =
      trimmed.startsWith('<') || res.status === 502 || res.status === 503 || res.status === 504;

    if (isHtmlOrProxyPage) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(
        'Server sedang memproses terlalu lama atau baru dimulai ulang. Mohon coba ulangi beberapa detik lagi.'
      );
    }

    let data: Record<string, unknown>;
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      throw new Error(
        `Respons server tidak valid (HTTP ${res.status}). Silakan coba unggah kembali.`
      );
    }

    if (!res.ok) {
      const errMsg =
        typeof data.error === 'string' && data.error
          ? data.error
          : `Gagal memproses dokumen (HTTP ${res.status}).`;
      const isTransientDemand =
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.toLowerCase().includes('high demand') ||
        errMsg.toLowerCase().includes('lonjakan trafik');
      if (isTransientDemand && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error(errMsg);
    }

    return data;
  }

  throw new Error('Gagal menghubungi server pemrosesan dokumen.');
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isCsvFile(file: File): boolean {
  return (
    file.type === 'text/csv' ||
    file.type === 'text/tab-separated-values' ||
    /\.(csv|tsv)$/i.test(file.name)
  );
}

function isSupportedImageFile(file: File): boolean {
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file PDF.'));
    reader.readAsDataURL(file);
  });
}

function normalizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        let { naturalWidth: width, naturalHeight: height } = img;
        if (!width || !height) {
          throw new Error(`Dimensi gambar ${file.name} tidak valid.`);
        }

        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const totalPixels = width * height;
        if (totalPixels > MAX_IMAGE_PIXELS) {
          const pixelScale = Math.sqrt(MAX_IMAGE_PIXELS / totalPixels);
          width = Math.max(1, Math.round(width * pixelScale));
          height = Math.max(1, Math.round(height * pixelScale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Browser tidak mendukung pemrosesan gambar kanvas.');
        }

        // Fill white background so transparent PNGs remain crisp and legible
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        resolve(dataUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(`Gagal memproses gambar ${file.name}.`));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Gagal memuat gambar ${file.name}. Pastikan file JPG/JPEG/PNG/WEBP tidak rusak.`));
    };

    img.src = objectUrl;
  });
}

function downloadSampleStatementPdf() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ADCB Bank - Account Statement', 14, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Account: ADCB TouchPoints Current · IBAN: AE42 0030 1122 3344 8912', 14, 25);
  doc.text('Currency: AED · Statement Period: 01 Nov 2026 - 15 Nov 2026', 14, 31);
  doc.text('Opening Balance: 42,500.00 AED · Closing Balance: 46,842.50 AED', 14, 37);

  autoTable(doc, {
    startY: 44,
    head: [['Posting Date', 'Value Date', 'Description', 'Type', 'Amount (AED)', 'Balance (AED)']],
    body: [
      ['2026-11-01', '2026-11-02', 'Emirates NBD Transfer - Retainer Client', 'CR', '6,500.00 CR', '49,000.00'],
      ['2026-11-03', '2026-11-04', 'DEWA Dubai Electricity & Water AutoPay', 'DR', '485.50 DR', '48,514.50'],
      ['2026-11-05', '2026-11-06', 'Carrefour Hypermarket Mall of the Emirates', 'DR', '342.00 DR', '48,172.50'],
      ['2026-11-08', '2026-11-09', 'ADNOC Distribution Fuel Station', 'DR', '145.00 DR', '48,027.50'],
      ['2026-11-10', '2026-11-11', 'Etisalat e& Fiber & Mobile Plan', 'DR', '389.00 DR', '47,638.50'],
      ['2026-11-12', '2026-11-13', 'Talabat UAE Food Delivery', 'DR', '96.00 DR', '47,542.50'],
      ['2026-11-14', '2026-11-15', 'Rent Transfer Marina Residences', 'DR', '700.00 DR', '46,842.50'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  doc.save('contoh-mutasi-adcb-nov-2026.pdf');
}

export const PdfImportView: React.FC<PdfImportViewProps> = ({
  accounts,
  existingTransactions,
  categories,
  expenseCategories,
  incomeCategories,
  customCategories = [],
  customCategoryNames = [],
  draftStorageKey,
  onSessionKeepAlive,
  onCreateCategory,
  onImportConfirm,
}) => {
  const expenseCategoryOptions = useMemo(
    () =>
      expenseCategories && expenseCategories.length > 0
        ? expenseCategories
        : categories && categories.length > 0
          ? categories
          : [...EXPENSE_CATEGORIES],
    [expenseCategories, categories]
  );
  const incomeCategoryOptions = useMemo(
    () =>
      incomeCategories && incomeCategories.length > 0
        ? incomeCategories
        : [...INCOME_CATEGORIES],
    [incomeCategories]
  );
  const [parseMode, setParseMode] = useState<'ai' | 'local'>('ai');
  const [parsing, setParsing] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfPassword, setPdfPassword] = useState('');
  const [showPdfPassword, setShowPdfPassword] = useState(false);
  const [preferredAccountId, setPreferredAccountId] = useState<string>('AUTO');
  const [fileQueue, setFileQueue] = useState<ImportFileItem[]>([]);
  const [statement, setStatement] = useState<ExtractedPdfStatement | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string>(accounts[0]?.id || 'CREATE_NEW');
  const [updateBalanceToClosing, setUpdateBalanceToClosing] = useState(true);
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [previewSearch, setPreviewSearch] = useState('');
  const [dateSortAsc, setDateSortAsc] = useState(true);
  const [previewPage, setPreviewPage] = useState(1);
  const [addingInlineCat, setAddingInlineCat] = useState(false);
  const [newInlineCatName, setNewInlineCatName] = useState('');
  const [newInlineCatType, setNewInlineCatType] = useState<TransactionType>('expense');
  const [savingInlineCat, setSavingInlineCat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const lastKeepAliveRef = React.useRef<number>(0);

  const notifyEditActivity = () => {
    if (!onSessionKeepAlive) return;
    const now = Date.now();
    if (now - lastKeepAliveRef.current > 30_000) {
      lastKeepAliveRef.current = now;
      onSessionKeepAlive();
    }
  };

  // Restore unfinished import preview draft if session reloaded while editing
  useEffect(() => {
    if (!draftStorageKey || typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const raw = window.sessionStorage.getItem(draftStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        statement?: ExtractedPdfStatement | null;
        targetAccountId?: string;
        preferredAccountId?: string;
        updateBalanceToClosing?: boolean;
      };
      if (parsed.statement && Array.isArray(parsed.statement.transactions) && parsed.statement.transactions.length > 0) {
        setStatement(parsed.statement);
        if (parsed.targetAccountId) setTargetAccountId(parsed.targetAccountId);
        if (parsed.preferredAccountId) setPreferredAccountId(parsed.preferredAccountId);
        if (typeof parsed.updateBalanceToClosing === 'boolean') {
          setUpdateBalanceToClosing(parsed.updateBalanceToClosing);
        }
      }
    } catch {
      window.sessionStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey]);

  // Persist current import preview draft into sessionStorage as user edits
  useEffect(() => {
    if (!draftStorageKey || typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      if (!statement || statement.transactions.length === 0) {
        window.sessionStorage.removeItem(draftStorageKey);
      } else {
        window.sessionStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            statement,
            targetAccountId,
            preferredAccountId,
            updateBalanceToClosing,
          })
        );
      }
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [draftStorageKey, statement, targetAccountId, preferredAccountId, updateBalanceToClosing]);

  const duplicateCheckKeys = useMemo(() => {
    const keys = new Set<string>();
    const refs = new Set<string>();
    for (const tx of existingTransactions) {
      keys.add(`${tx.date}|${tx.amount.toFixed(2)}|${tx.merchant.trim().toLowerCase()}`);
      if (tx.reference) refs.add(tx.reference.trim().toLowerCase());
    }
    return { keys, refs };
  }, [existingTransactions]);

  const isPotentialDuplicate = (tx: ExtractedPdfStatement['transactions'][number]): boolean => {
    if (tx.reference && duplicateCheckKeys.refs.has(tx.reference.trim().toLowerCase())) {
      return true;
    }
    const key = `${tx.date}|${Number(tx.amount).toFixed(2)}|${tx.merchant.trim().toLowerCase()}`;
    return duplicateCheckKeys.keys.has(key);
  };

  const getActiveAccountHint = (): string | undefined => {
    if (preferredAccountId === 'AUTO') return undefined;
    const acc = accounts.find((a) => a.id === preferredAccountId);
    if (!acc) return undefined;
    return `${acc.name} (${formatAccountProviderLabel(acc.provider)} · ${acc.institution}, mata uang ${acc.currency})`;
  };

  const applyExtractedStatement = (raw: Record<string, unknown>, idPrefix: string): ExtractedPdfStatement => {
    const rawTx = Array.isArray(raw.transactions) ? (raw.transactions as Record<string, unknown>[]) : [];
    const rawCurrency = String(raw.currency || '').toUpperCase() as SupportedCurrency;
    const normalizedCurrency: SupportedCurrency = SUPPORTED_CURRENCIES.includes(rawCurrency)
      ? rawCurrency
      : 'IDR';

    const extracted: ExtractedPdfStatement = {
      bankName: String(raw.bankName || 'Dokumen Keuangan'),
      accountNumberMasked: String(raw.accountNumberMasked || '••••'),
      currency: normalizedCurrency,
      statementPeriod: String(raw.statementPeriod || 'Periode Terdeteksi'),
      openingBalance: Number(raw.openingBalance) || 0,
      closingBalance: Number(raw.closingBalance) || 0,
      detectedDateColumn: typeof raw.detectedDateColumn === 'string' ? raw.detectedDateColumn : undefined,
      transactions: rawTx.map((tx, idx) => {
        const desc = String(tx.description || '');
        const merch = String(tx.merchant || tx.description || '');
        const txType: TransactionType = tx.type === 'income' ? 'income' : 'expense';
        const rawCat = String(tx.category || 'Lainnya');
        const baseCat =
          txType === 'expense' && isHouseholdGoodsMerchant(`${merch} ${desc}`)
            ? 'Barang Rumah Tangga'
            : rawCat === 'Lainnya'
              ? inferCategoryFromMerchant(
                  `${merch} ${desc}`,
                  txType === 'income',
                  txType === 'income' ? 'Pemasukan' : 'Lainnya'
                )
              : rawCat;
        const resolvedCat = resolveBuiltInCategoryName(baseCat, customCategories, txType);
        const dateSourceRaw = tx.dateSource;
        const dateSource =
          dateSourceRaw === 'value_date' || dateSourceRaw === 'posting_date' || dateSourceRaw === 'document_date'
            ? dateSourceRaw
            : undefined;

        return {
          id: `${idPrefix}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          selected: true,
          date: String(tx.date || new Date().toISOString().slice(0, 10)),
          ...(typeof tx.postingDate === 'string' && tx.postingDate ? { postingDate: tx.postingDate } : {}),
          ...(dateSource ? { dateSource } : {}),
          description: desc,
          merchant: merch,
          amount: Number(tx.amount) || 0,
          type: txType,
          category: resolvedCat,
          reference: String(tx.reference || ''),
        };
      }),
    };

    extracted.transactions = extracted.transactions.map((tx) => ({
      ...tx,
      selected: !isPotentialDuplicate(tx),
    }));

    return extracted;
  };

  const mergeExtractedIntoBatch = (
    current: ExtractedPdfStatement | null,
    incoming: ExtractedPdfStatement
  ): ExtractedPdfStatement => {
    if (!current) {
      return incoming;
    }

    const existingBatchRefKeys = new Set<string>();
    const existingBatchExactKeys = new Set<string>();
    for (const t of current.transactions) {
      const ref = t.reference.trim().toLowerCase();
      if (ref.length >= 4) {
        existingBatchRefKeys.add(`${t.date}|${Number(t.amount).toFixed(2)}|${ref}`);
      }
      existingBatchExactKeys.add(
        `${t.date}|${Number(t.amount).toFixed(2)}|${t.description.trim().toLowerCase()}|${ref}`
      );
    }

    const mergedIncomingTxs = incoming.transactions.map((tx) => {
      const ref = tx.reference.trim().toLowerCase();
      const hasRefDup =
        ref.length >= 4 && existingBatchRefKeys.has(`${tx.date}|${Number(tx.amount).toFixed(2)}|${ref}`);
      const hasExactDup = existingBatchExactKeys.has(
        `${tx.date}|${Number(tx.amount).toFixed(2)}|${tx.description.trim().toLowerCase()}|${ref}`
      );
      return {
        ...tx,
        selected: tx.selected && !hasRefDup && !hasExactDup,
      };
    });

    const isCurrentEmptyBank =
      current.bankName === 'Tidak Terdeteksi' || current.bankName === 'Dokumen Keuangan';
    const isIncomingEmptyBank =
      incoming.bankName === 'Tidak Terdeteksi' || incoming.bankName === 'Dokumen Keuangan';

    const resolvedBankName = isCurrentEmptyBank && !isIncomingEmptyBank
      ? incoming.bankName
      : !isCurrentEmptyBank && isIncomingEmptyBank
        ? current.bankName
        : current.bankName.toLowerCase() === incoming.bankName.toLowerCase()
          ? current.bankName
          : 'Gabungan Multi-Dokumen';

    const resolvedPeriod =
      current.statementPeriod === incoming.statementPeriod
        ? current.statementPeriod
        : 'Gabungan Beberapa Dokumen';

    const resolvedDateCol =
      current.detectedDateColumn === 'Value Date' || incoming.detectedDateColumn === 'Value Date'
        ? 'Value Date'
        : current.detectedDateColumn || incoming.detectedDateColumn;

    return {
      bankName: resolvedBankName,
      accountNumberMasked:
        current.accountNumberMasked !== '••••' && current.accountNumberMasked !== '****'
          ? current.accountNumberMasked
          : incoming.accountNumberMasked,
      currency: current.transactions.length > 0 ? current.currency : incoming.currency,
      statementPeriod: resolvedPeriod,
      openingBalance: current.openingBalance || incoming.openingBalance,
      closingBalance: incoming.closingBalance > 0 ? incoming.closingBalance : current.closingBalance,
      detectedDateColumn: resolvedDateCol,
      transactions: [...current.transactions, ...mergedIncomingTxs],
    };
  };

  const matchAccountForStatement = (extracted: ExtractedPdfStatement) => {
    if (preferredAccountId !== 'AUTO') {
      const preselected = accounts.find((a) => a.id === preferredAccountId);
      if (preselected) {
        setTargetAccountId(preselected.id);
        return;
      }
    }
    const matched = accounts.find(
      (a) =>
        a.currency === extracted.currency &&
        (a.institution.toLowerCase().includes(extracted.bankName.toLowerCase()) ||
          extracted.bankName.toLowerCase().includes(a.provider.toLowerCase()))
    );
    setTargetAccountId(matched ? matched.id : accounts.length > 0 ? accounts[0].id : 'CREATE_NEW');
  };

  const updateQueueItem = (id: string, patch: Partial<ImportFileItem>) => {
    setFileQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const processBatchItems = async (
    itemsToProcess: ImportFileItem[],
    activeMode: 'ai' | 'local',
    activePassword: string,
    startingStatement: ExtractedPdfStatement | null
  ) => {
    if (itemsToProcess.length === 0) return;

    setParsing(true);
    setError(null);
    let workingStatement = startingStatement;
    let firstMatchedStatement: ExtractedPdfStatement | null = startingStatement;

    const csvItems = itemsToProcess.filter((it) => it.kind === 'csv');
    const pdfItems = itemsToProcess.filter((it) => it.kind === 'pdf');
    const imageItems = itemsToProcess.filter((it) => it.kind === 'image');
    const accountHint = getActiveAccountHint();

    try {
      // 1. Process CSV/TSV files directly in the browser with Value Date priority
      for (let idx = 0; idx < csvItems.length; idx++) {
        const item = csvItems[idx];
        setProgressLabel(`Membaca CSV/TSV ${idx + 1}/${csvItems.length}: ${item.file.name}...`);
        updateQueueItem(item.id, { status: 'processing', errorMsg: undefined });

        try {
          const extracted = await parseCsvStatementFile(item.file, customCategories);
          extracted.transactions = extracted.transactions.map((tx) => ({
            ...tx,
            selected: !isPotentialDuplicate(tx),
          }));
          workingStatement = mergeExtractedIntoBatch(workingStatement, extracted);
          if (!firstMatchedStatement) firstMatchedStatement = extracted;
          setStatement(workingStatement);
          updateQueueItem(item.id, {
            status: 'done',
            txCount: extracted.transactions.length,
            errorMsg: undefined,
          });
        } catch (err) {
          updateQueueItem(item.id, {
            status: 'error',
            errorMsg: err instanceof Error ? err.message : 'Gagal membaca file CSV/TSV.',
          });
        }
      }

      const failedMessages: string[] = [];

      // 2. Process ALL PDFs sequentially and read ALL page chunks of every PDF file
      for (let idx = 0; idx < pdfItems.length; idx++) {
        const item = pdfItems[idx];
        setProgressLabel(`Memproses PDF ${idx + 1}/${pdfItems.length}: ${item.file.name}...`);
        updateQueueItem(item.id, { status: 'processing', errorMsg: undefined });

        try {
          let fileExtracted: ExtractedPdfStatement | null = null;

          if (activeMode === 'local') {
            fileExtracted = await parsePdfStatementLocally(item.file, activePassword || undefined);
            if (fileExtracted.transactions.length === 0) {
              throw new Error(
                'Ekstraksi lokal tidak menemukan teks transaksi. Gunakan mode Ekstraksi Cerdas AI untuk membaca tabel kompleks atau PDF scan.'
              );
            }
            fileExtracted.transactions = fileExtracted.transactions.map((tx) => ({
              ...tx,
              category: resolveBuiltInCategoryName(tx.category, customCategories, tx.type),
              selected: !isPotentialDuplicate(tx),
            }));
          } else {
            const chunks = await preparePdfChunksForAiExtraction(
              item.file,
              activePassword || undefined,
              4
            );
            const rawPdfBase64 =
              chunks.length === 1 && chunks[0].mode === 'raw_pdf'
                ? await fileToBase64(item.file)
                : undefined;

            const chunkStatements: ExtractedPdfStatement[] = [];

            for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
              const chunk = chunks[cIdx];
              setProgressLabel(
                chunks.length > 1
                  ? `Memproses PDF ${idx + 1}/${pdfItems.length} (${chunk.chunkInfo}): ${item.file.name}...`
                  : `Memproses PDF ${idx + 1}/${pdfItems.length}: ${item.file.name}...`
              );

              const requestBody =
                chunk.mode === 'raw_pdf' && rawPdfBase64
                  ? {
                      pdfBase64: rawPdfBase64,
                      extractedText: chunk.extractedText,
                      fileName: item.file.name,
                      chunkInfo: chunk.chunkInfo,
                      accountHint,
                      customCategories: customCategoryNames,
                    }
                  : {
                      pageImages: chunk.pageImages,
                      extractedText: chunk.extractedText,
                      fileName: item.file.name,
                      chunkInfo: chunk.chunkInfo,
                      accountHint,
                      customCategories: customCategoryNames,
                    };

              const data = await postJsonWithSafeParse('/api/parse-statement', requestBody);
              chunkStatements.push(
                applyExtractedStatement(data, `pdf-${item.id.slice(-4)}-c${cIdx + 1}`)
              );
            }

            fileExtracted = chunkStatements.reduce<ExtractedPdfStatement | null>(
              (acc, chunkStatement) => {
                if (!acc) return chunkStatement;
                return {
                  bankName:
                    acc.bankName === 'Tidak Terdeteksi' ||
                    acc.bankName === 'Dokumen Keuangan'
                      ? chunkStatement.bankName
                      : acc.bankName,
                  accountNumberMasked:
                    acc.accountNumberMasked !== '••••' &&
                    acc.accountNumberMasked !== '****'
                      ? acc.accountNumberMasked
                      : chunkStatement.accountNumberMasked,
                  currency: acc.currency,
                  statementPeriod: acc.statementPeriod,
                  openingBalance: acc.openingBalance || chunkStatement.openingBalance,
                  closingBalance:
                    chunkStatement.closingBalance > 0
                      ? chunkStatement.closingBalance
                      : acc.closingBalance,
                  detectedDateColumn:
                    acc.detectedDateColumn === 'Value Date' ||
                    chunkStatement.detectedDateColumn === 'Value Date'
                      ? 'Value Date'
                      : acc.detectedDateColumn || chunkStatement.detectedDateColumn,
                  transactions: [...acc.transactions, ...chunkStatement.transactions],
                };
              },
              null
            );
          }

          if (!fileExtracted) {
            throw new Error(`Tidak ada data yang berhasil dibaca dari ${item.file.name}.`);
          }

          workingStatement = mergeExtractedIntoBatch(workingStatement, fileExtracted);
          if (!firstMatchedStatement) firstMatchedStatement = fileExtracted;
          setStatement(workingStatement);
          updateQueueItem(item.id, {
            status: 'done',
            txCount: fileExtracted.transactions.length,
            errorMsg: undefined,
          });
        } catch (err) {
          if (err instanceof PdfPasswordError) {
            updateQueueItem(item.id, { status: 'locked', errorMsg: err.message });
          } else {
            const msg = err instanceof Error ? err.message : 'Gagal membaca file PDF.';
            failedMessages.push(`${item.file.name}: ${msg}`);
            updateQueueItem(item.id, {
              status: 'error',
              errorMsg: msg,
            });
          }
        }
      }

      // 3. Process images in chunks of IMAGE_CHUNK_SIZE for fast, reliable OCR
      for (let start = 0; start < imageItems.length; start += IMAGE_CHUNK_SIZE) {
        const chunk = imageItems.slice(start, start + IMAGE_CHUNK_SIZE);
        const chunkLabel =
          chunk.length === 1
            ? chunk[0].file.name
            : `${chunk.length} gambar (${start + 1}-${start + chunk.length} dari ${imageItems.length})`;

        setProgressLabel(`Mengekstrak gambar: ${chunkLabel}...`);
        for (const imgItem of chunk) {
          updateQueueItem(imgItem.id, { status: 'processing', errorMsg: undefined });
        }

        try {
          const dataUrls = await Promise.all(
            chunk.map(async (imgItem) => {
              if (imgItem.previewUrl) return imgItem.previewUrl;
              const url = await normalizeImageToDataUrl(imgItem.file);
              updateQueueItem(imgItem.id, { previewUrl: url });
              return url;
            })
          );

          const data = await postJsonWithSafeParse('/api/parse-statement', {
            pageImages: dataUrls,
            fileName: chunk.map((c) => c.file.name).join(', '),
            accountHint,
            customCategories: customCategoryNames,
          });

          const extracted = applyExtractedStatement(data, `img-${start}`);
          workingStatement = mergeExtractedIntoBatch(workingStatement, extracted);
          if (!firstMatchedStatement) firstMatchedStatement = extracted;
          setStatement(workingStatement);

          chunk.forEach((imgItem, cIdx) => {
            updateQueueItem(imgItem.id, {
              status: 'done',
              txCount: cIdx === 0 ? extracted.transactions.length : 0,
              errorMsg: undefined,
            });
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal memproses gambar dokumen.';
          for (const imgItem of chunk) {
            updateQueueItem(imgItem.id, { status: 'error', errorMsg: msg });
          }
        }
      }

      if (failedMessages.length > 0) {
        setError(
          `Sebagian file gagal diproses (${failedMessages.length}): ${failedMessages.join(' · ')}`
        );
      }

      if (!startingStatement && firstMatchedStatement) {
        matchAccountForStatement(firstMatchedStatement);
      }
    } finally {
      setParsing(false);
      setProgressLabel('');
    }
  };

  const handleFiles = async (
    fileList: FileList | File[] | null,
    forcedMode?: 'ai' | 'local',
    overridePassword?: string
  ) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;

    setError(null);
    setSuccessMsg(null);

    const validFiles: Array<{ file: File; kind: 'pdf' | 'image' | 'csv' }> = [];
    const invalidNames: string[] = [];
    const oversizedNames: string[] = [];

    for (const f of files) {
      if (isPdfFile(f)) {
        if (f.size > MAX_FILE_BYTES) oversizedNames.push(f.name);
        else validFiles.push({ file: f, kind: 'pdf' });
      } else if (isCsvFile(f)) {
        if (f.size > MAX_FILE_BYTES) oversizedNames.push(f.name);
        else validFiles.push({ file: f, kind: 'csv' });
      } else if (isSupportedImageFile(f)) {
        if (f.size > MAX_FILE_BYTES) oversizedNames.push(f.name);
        else validFiles.push({ file: f, kind: 'image' });
      } else {
        invalidNames.push(f.name);
      }
    }

    if (validFiles.length === 0) {
      if (oversizedNames.length > 0) {
        setError(`Ukuran file melebihi batas 15 MB: ${oversizedNames.join(', ')}`);
      } else {
        setError('Mohon unggah file berformat PDF (.pdf), CSV/TSV (.csv, .tsv), atau gambar (.jpg, .jpeg, .png, .webp).');
      }
      return;
    }

    if (fileQueue.length + validFiles.length > MAX_BATCH_FILES) {
      setError(`Maksimal ${MAX_BATCH_FILES} file dalam satu batch impor. Bersihkan antrean terlebih dahulu jika ingin memulai batch baru.`);
      return;
    }

    const warnings: string[] = [];
    if (invalidNames.length > 0) {
      warnings.push(`Format tidak didukung dilewati (${invalidNames.join(', ')})`);
    }
    if (oversizedNames.length > 0) {
      warnings.push(`File > 15 MB dilewati (${oversizedNames.join(', ')})`);
    }

    // If batch has images and local mode was active, automatically use AI for image OCR while keeping PDFs/CSVs compatible
    const hasImages = validFiles.some((v) => v.kind === 'image');
    if (hasImages && parseMode === 'local') {
      setParseMode('ai');
    }

    const newItems: ImportFileItem[] = await Promise.all(
      validFiles.map(async ({ file, kind }) => {
        let previewUrl: string | undefined;
        if (kind === 'image') {
          try {
            previewUrl = await normalizeImageToDataUrl(file);
          } catch {
            previewUrl = undefined;
          }
        }
        return {
          id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          kind,
          status: 'pending' as const,
          txCount: 0,
          previewUrl,
        };
      })
    );

    setFileQueue((prev) => [...prev, ...newItems]);

    if (warnings.length > 0) {
      setError(warnings.join(' · '));
    }

    const activeMode = hasImages ? 'ai' : forcedMode || parseMode;
    const activePassword = (overridePassword !== undefined ? overridePassword : pdfPassword).trim();
    await processBatchItems(newItems, activeMode, activePassword, statement);
  };

  const lockedItems = useMemo(
    () => fileQueue.filter((f) => f.status === 'locked'),
    [fileQueue]
  );

  const failedItems = useMemo(
    () => fileQueue.filter((f) => f.status === 'error'),
    [fileQueue]
  );

  const imageQueueItems = useMemo(
    () => fileQueue.filter((f) => f.kind === 'image' && f.previewUrl),
    [fileQueue]
  );

  const handleUnlockLockedPdfs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedItems.length === 0) return;
    if (!pdfPassword.trim()) {
      setError('Masukkan kode pembuka PDF terlebih dahulu.');
      return;
    }
    await processBatchItems(lockedItems, parseMode, pdfPassword.trim(), statement);
  };

  const handleRetryFailedItems = async () => {
    if (failedItems.length === 0) return;
    const hasImages = failedItems.some((f) => f.kind === 'image');
    await processBatchItems(
      failedItems,
      hasImages ? 'ai' : parseMode,
      pdfPassword.trim(),
      statement
    );
  };

  const handleRetrySingleItem = async (item: ImportFileItem) => {
    await processBatchItems(
      [item],
      item.kind === 'image' ? 'ai' : parseMode,
      pdfPassword.trim(),
      statement
    );
  };

  const removeQueueItem = (id: string) => {
    setFileQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAllBatch = () => {
    setFileQueue([]);
    setStatement(null);
    setPreviewSearch('');
    setPreviewPage(1);
    setError(null);
    setSuccessMsg(null);
    if (draftStorageKey && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(draftStorageKey);
    }
  };

  const toggleRow = (id: string) => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) =>
        t.id === id ? { ...t, selected: !t.selected } : t
      ),
    });
  };

  const toggleAllRows = (checked: boolean) => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) => ({ ...t, selected: checked })),
    });
  };

  const selectNonDuplicatesOnly = () => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) => ({
        ...t,
        selected: !isPotentialDuplicate(t),
      })),
    });
  };

  const removeUnselectedRows = () => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.filter((t) => t.selected),
    });
  };

  const sortRowsByDate = () => {
    if (!statement) return;
    notifyEditActivity();
    const nextAsc = !dateSortAsc;
    setDateSortAsc(nextAsc);
    setStatement({
      ...statement,
      transactions: [...statement.transactions].sort((a, b) =>
        nextAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
      ),
    });
  };

  const updateRow = (
    id: string,
    patch: Partial<ExtractedPdfStatement['transactions'][number]>
  ) => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };

  const removeRow = (id: string) => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.filter((t) => t.id !== id),
    });
  };

  const addEmptyRow = () => {
    if (!statement) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: [
        ...statement.transactions,
        {
          id: `manual-doc-${Math.random().toString(36).slice(2, 8)}`,
          selected: true,
          date: new Date().toISOString().slice(0, 10),
          description: 'Item tambahan dari dokumen',
          merchant: 'Merchant Baru',
          amount: 0,
          type: 'expense',
          category: expenseCategoryOptions[0] || 'Lainnya',
          reference: '',
        },
      ],
    });
  };

  const applyBulkCategory = (cat: string) => {
    setBulkCategory('');
    if (!statement || !cat) return;
    notifyEditActivity();
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) =>
        t.selected ? { ...t, category: cat } : t
      ),
    });
  };

  const previewSummary = useMemo(() => {
    if (!statement) return { selectedCount: 0, income: 0, expense: 0, dupCount: 0, valueDateCount: 0 };
    let selectedCount = 0;
    let income = 0;
    let expense = 0;
    let dupCount = 0;
    let valueDateCount = 0;
    for (const tx of statement.transactions) {
      if (tx.dateSource === 'value_date') valueDateCount++;
      if (isPotentialDuplicate(tx)) dupCount++;
      if (!tx.selected) continue;
      selectedCount++;
      if (tx.type === 'income') income += tx.amount;
      else expense += tx.amount;
    }
    return { selectedCount, income, expense, dupCount, valueDateCount };
  }, [statement, duplicateCheckKeys]);

  const filteredPreviewTransactions = useMemo(() => {
    if (!statement) return [];
    const q = previewSearch.trim().toLowerCase();
    if (!q) return statement.transactions;
    return statement.transactions.filter(
      (tx) =>
        tx.merchant.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.date.includes(q)
    );
  }, [statement, previewSearch]);

  const totalPreviewPages = Math.max(
    1,
    Math.ceil(filteredPreviewTransactions.length / PREVIEW_PAGE_SIZE)
  );
  const safePreviewPage = Math.min(previewPage, totalPreviewPages);
  const previewPageStart = (safePreviewPage - 1) * PREVIEW_PAGE_SIZE;
  const paginatedPreviewTransactions = useMemo(
    () =>
      filteredPreviewTransactions.slice(
        previewPageStart,
        previewPageStart + PREVIEW_PAGE_SIZE
      ),
    [filteredPreviewTransactions, previewPageStart]
  );

  useEffect(() => {
    setPreviewPage(1);
  }, [previewSearch, dateSortAsc]);

  useEffect(() => {
    if (previewPage > totalPreviewPages) {
      setPreviewPage(totalPreviewPages);
    }
  }, [previewPage, totalPreviewPages]);

  const previewPageNumbers = useMemo(() => {
    const items: Array<number | 'ellipsis'> = [];
    if (totalPreviewPages <= 7) {
      for (let i = 1; i <= totalPreviewPages; i++) items.push(i);
      return items;
    }
    items.push(1);
    if (safePreviewPage > 3) items.push('ellipsis');
    const start = Math.max(2, safePreviewPage - 1);
    const end = Math.min(totalPreviewPages - 1, safePreviewPage + 1);
    for (let i = start; i <= end; i++) items.push(i);
    if (safePreviewPage < totalPreviewPages - 2) items.push('ellipsis');
    items.push(totalPreviewPages);
    return items;
  }, [totalPreviewPages, safePreviewPage]);

  const handleSave = async () => {
    if (!statement) return;
    setError(null);
    const selectedRows = statement.transactions.filter((t) => t.selected && t.amount > 0);
    if (selectedRows.length === 0) {
      setError('Pilih minimal 1 transaksi dengan nominal lebih dari 0 untuk disimpan ke brankas.');
      return;
    }

    setSaving(true);
    try {
      const count = await onImportConfirm({
        targetAccountId,
        newAccountSpec:
          targetAccountId === 'CREATE_NEW'
            ? {
                name: `${statement.bankName} (${statement.accountNumberMasked})`,
                institution: statement.bankName,
                accountNumberMasked: statement.accountNumberMasked,
                currency: statement.currency,
                balance: statement.closingBalance || 0,
              }
            : undefined,
        statement,
        updateBalanceToClosing,
      });
      const doneCount = fileQueue.filter((f) => f.status === 'done').length;
      setSuccessMsg(
        `${count} transaksi dari ${doneCount || 1} file dokumen berhasil dienkripsi (AES-256-GCM) dan disimpan ke brankas.`
      );
      setStatement(null);
      setFileQueue([]);
      setPreviewSearch('');
      setPreviewPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan transaksi impor dokumen.');
    } finally {
      setSaving(false);
    }
  };

  const allSelected =
    Boolean(statement) &&
    statement!.transactions.length > 0 &&
    statement!.transactions.every((t) => t.selected);

  return (
    <div className="space-y-6">
      <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Impor Multi-File Mutasi & Dokumen (PDF / CSV / JPG / PNG)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unggah hingga {MAX_BATCH_FILES} file sekaligus (PDF terkunci sandi, ekspor CSV/TSV bank, foto struk, atau screenshot m-banking).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={downloadSampleStatementPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Contoh PDF Mutasi</span>
            </button>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setParseMode('ai')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                  parseMode === 'ai'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Ekstraksi Cerdas AI
              </button>
              <button
                type="button"
                onClick={() => setParseMode('local')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                  parseMode === 'local'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Lokal di Browser (PDF)
              </button>
            </div>
          </div>
        </div>

        {/* Upload Options Bar: Target Account Hint + Optional PDF Password */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <CalendarCheck2 className="w-4 h-4 text-teal-700 dark:text-teal-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  Prioritas Value Date &amp; Sumber Dana Tujuan
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Tanggal otomatis dibaca dari kolom <strong>Value Date</strong> (bukan Posting Date) jika tersedia.
                </p>
              </div>
            </div>

            <select
              value={preferredAccountId}
              onChange={(e) => {
                const val = e.target.value;
                setPreferredAccountId(val);
                if (val !== 'AUTO') setTargetAccountId(val);
              }}
              aria-label="Pilih sumber dana petunjuk sebelum unggah"
              className="w-full sm:w-56 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600 shrink-0"
            >
              <option value="AUTO">Deteksi Sumber Dana Otomatis</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({formatAccountProviderLabel(acc.provider)} · {acc.currency})
                </option>
              ))}
            </select>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  Kode Pembuka PDF (Opsional)
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Diproses lokal di browser jika PDF mutasi terkunci sandi (misal Customer ID bank).
                </p>
              </div>
            </div>

            <div className="relative w-full sm:w-52 shrink-0">
              <input
                type={showPdfPassword ? 'text' : 'password'}
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Sandi PDF (jika ada)"
                aria-label="Kode pembuka PDF"
                className="w-full px-3 py-2 pr-9 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="button"
                onClick={() => setShowPdfPassword((v) => !v)}
                aria-label="Tampilkan kode PDF"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                {showPdfPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                void handleFiles(e.dataTransfer.files);
              }
            }}
            className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30'
                : 'border-slate-300 dark:border-slate-700 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/50 dark:bg-slate-950/40'
            }`}
          >
            <input
              type="file"
              multiple
              accept="application/pdf,.pdf,text/csv,.csv,text/tab-separated-values,.tsv,image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  void handleFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />

            {parsing ? (
              <>
                <RefreshCw className="w-7 h-7 text-teal-700 dark:text-teal-400 animate-spin mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {progressLabel || 'Membuka & mengekstrak transaksi...'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Membaca Value Date, merchant, kategori, dan nominal dari dokumen yang diunggah
                </p>
              </>
            ) : (
              <>
                <Upload className="w-7 h-7 text-slate-400 mb-3" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {fileQueue.length > 0
                    ? 'Tarik atau klik untuk menambah file PDF, CSV, JPG, atau PNG lagi ke daftar'
                    : 'Tarik dan letakkan file PDF, CSV/TSV, JPG, atau PNG di sini, atau klik untuk memilih'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Mendukung hingga {MAX_BATCH_FILES} file (15 MB/file) · PDF terkunci sandi, ekspor CSV bank, struk, dan screenshot
                </p>
              </>
            )}
          </label>
        </div>

        {/* Multi-file batch queue list */}
        {fileQueue.length > 0 && (
          <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 font-mono tabular-nums">
                Daftar File ({fileQueue.filter((f) => f.status === 'done').length}/{fileQueue.length} selesai)
              </div>
              <div className="flex items-center gap-3">
                {failedItems.length > 0 && !parsing && (
                  <button
                    type="button"
                    onClick={() => void handleRetryFailedItems()}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Coba Ulang ({failedItems.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={parsing}
                  onClick={clearAllBatch}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Bersihkan Semua</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200/80 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {fileQueue.map((item) => (
                <div key={item.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.kind === 'pdf' ? (
                      <FileText className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    ) : item.kind === 'csv' ? (
                      <FileSpreadsheet className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white truncate">
                        {item.file.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {formatFileSize(item.file.size)}
                        {item.status === 'done' && ` · ${item.txCount} transaksi`}
                        {item.status === 'processing' && ' · Sedang mengekstrak...'}
                        {item.status === 'pending' && ' · Menunggu antrean'}
                        {item.status === 'locked' && ' · Memerlukan kode pembuka PDF'}
                        {item.status === 'error' && ` · ${item.errorMsg || 'Gagal diproses'}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'processing' && (
                      <RefreshCw className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 animate-spin" />
                    )}
                    {item.status === 'done' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                    {item.status === 'locked' && (
                      <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                    {item.status === 'error' && (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                        <button
                          type="button"
                          disabled={parsing}
                          onClick={() => void handleRetrySingleItem(item)}
                          aria-label={`Coba ulang ${item.file.name}`}
                          className="p-1 text-teal-700 dark:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={parsing}
                      onClick={() => removeQueueItem(item.id)}
                      aria-label={`Hapus ${item.file.name} dari daftar`}
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {imageQueueItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 pt-1">
                {imageQueueItems.map((img) => (
                  <div
                    key={img.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                  >
                    <img
                      src={img.previewUrl}
                      alt={img.file.name}
                      className="w-full h-20 object-cover bg-slate-100 dark:bg-slate-800"
                    />
                    <p className="px-2 py-1 text-[10px] text-slate-600 dark:text-slate-300 truncate">
                      {img.file.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Inline Password Unlock Prompt if any locked PDF is waiting */}
        {lockedItems.length > 0 && (
          <form
            onSubmit={handleUnlockLockedPdfs}
            className="mt-4 p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                {lockedItems.length === 1
                  ? `File "${lockedItems[0].file.name}" memerlukan kode pembuka PDF`
                  : `${lockedItems.length} file PDF memerlukan kode pembuka PDF`}
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                Masukkan kode pembuka dokumen Anda lalu tekan Buka & Ekstrak PDF.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type={showPdfPassword ? 'text' : 'password'}
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Kode pembuka PDF"
                autoFocus
                className="w-44 px-3 py-2 text-xs font-mono rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <button
                type="submit"
                disabled={parsing}
                className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                Buka & Ekstrak PDF
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Shield className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
          <span>
            Setelah ditinjau, seluruh transaksi akan langsung dienkripsi menggunakan kunci AES-256-GCM Anda sebelum disimpan dan disinkronkan ke perangkat lain.
          </span>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            {failedItems.length > 0 && (
              <button
                type="button"
                disabled={parsing}
                onClick={() => void handleRetryFailedItems()}
                className="px-3 py-1.5 rounded-md bg-teal-700 hover:bg-teal-800 text-white font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                Coba Lagi
              </button>
            )}
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </section>

      {statement && (
        <section className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Pratinjau Impor: {statement.bankName} ({statement.accountNumberMasked})
                </h3>
                {(statement.detectedDateColumn === 'Value Date' || previewSummary.valueDateCount > 0) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-[11px] font-medium text-teal-800 dark:text-teal-300">
                    <CalendarCheck2 className="w-3 h-3" />
                    <span>Tanggal: Value Date</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {statement.statementPeriod} · {statement.transactions.length} baris terdeteksi
                {previewSummary.dupCount > 0 && ` (${previewSummary.dupCount} kemungkinan duplikat dilewati)`}
                {' · '}Saldo Akhir:{' '}
                <span className="font-mono font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                  {formatMoney(statement.closingBalance, statement.currency)}
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={statement.currency}
                onChange={(e) =>
                  setStatement({
                    ...statement,
                    currency: e.target.value as SupportedCurrency,
                  })
                }
                aria-label="Mata uang dokumen"
                className="px-2.5 py-2 text-xs font-mono font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                {SUPPORTED_CURRENCIES.map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
              </select>

              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                aria-label="Pilih sumber dana tujuan impor"
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
              >
                <option value="CREATE_NEW">
                  + Buat Sumber Dana Baru ({statement.bankName} · {statement.currency})
                </option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    Simpan ke: {acc.name} ({formatAccountProviderLabel(acc.provider)} · {acc.currency})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving || previewSummary.selectedCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>
                  {saving
                    ? 'Mengenkripsi & Menyimpan...'
                    : `Enkripsi & Simpan (${previewSummary.selectedCount})`}
                </span>
              </button>
            </div>
          </div>

          <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-700 dark:text-slate-300">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  placeholder="Cari baris pratinjau..."
                  aria-label="Cari baris transaksi pratinjau"
                  className="pl-8 pr-3 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 w-44"
                />
              </div>

              {targetAccountId !== 'CREATE_NEW' && statement.closingBalance > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateBalanceToClosing}
                    onChange={(e) => setUpdateBalanceToClosing(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                  />
                  <span>
                    Perbarui saldo sumber dana ke{' '}
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMoney(statement.closingBalance, statement.currency)}
                    </span>
                  </span>
                </label>
              )}

              <select
                value={bulkCategory}
                onChange={(e) => applyBulkCategory(e.target.value)}
                aria-label="Terapkan kategori ke baris terpilih"
                className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
              >
                <option value="">Ubah Kategori Massal...</option>
                <optgroup label="Kategori Pengeluaran">
                  {expenseCategoryOptions.map((cat) => (
                    <option key={`bulk-exp-${cat}`} value={cat}>
                      Set Terpilih: {cat}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Kategori Pemasukan">
                  {incomeCategoryOptions.map((cat) => (
                    <option key={`bulk-inc-${cat}`} value={cat}>
                      Set Terpilih: {cat}
                    </option>
                  ))}
                </optgroup>
              </select>

              {previewSummary.dupCount > 0 && (
                <button
                  type="button"
                  onClick={selectNonDuplicatesOnly}
                  className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  Pilih Non-Duplikat
                </button>
              )}

              {previewSummary.selectedCount < statement.transactions.length && (
                <button
                  type="button"
                  onClick={removeUnselectedRows}
                  className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                >
                  Hapus Tidak Dipilih ({statement.transactions.length - previewSummary.selectedCount})
                </button>
              )}

              <button
                type="button"
                onClick={sortRowsByDate}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>Urutkan Tanggal</span>
              </button>

              {onCreateCategory && (
                addingInlineCat ? (
                  <div className="inline-flex flex-wrap items-center gap-1.5">
                    <select
                      value={newInlineCatType}
                      onChange={(e) =>
                        setNewInlineCatType(e.target.value === 'income' ? 'income' : 'expense')
                      }
                      aria-label="Tipe kategori baru"
                      className="px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    >
                      <option value="expense">Pengeluaran</option>
                      <option value="income">Pemasukan</option>
                    </select>
                    <input
                      type="text"
                      maxLength={50}
                      value={newInlineCatName}
                      onChange={(e) => setNewInlineCatName(e.target.value)}
                      placeholder="Nama kategori..."
                      className="w-36 px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={savingInlineCat || !newInlineCatName.trim()}
                      onClick={async () => {
                        setSavingInlineCat(true);
                        try {
                          await onCreateCategory(newInlineCatName, newInlineCatType);
                          setNewInlineCatName('');
                          setAddingInlineCat(false);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Gagal menambah kategori.');
                        } finally {
                          setSavingInlineCat(false);
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {savingInlineCat ? '...' : 'Simpan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingInlineCat(false);
                        setNewInlineCatName('');
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingInlineCat(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Kategori Baru</span>
                  </button>
                )
              )}

              <button
                type="button"
                onClick={addEmptyRow}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Baris</span>
              </button>
            </div>

            <div className="flex items-center gap-3 font-mono tabular-nums">
              <span className="text-emerald-700 dark:text-emerald-400">
                +{formatMoney(previewSummary.income, statement.currency)}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-red-600 dark:text-red-400">
                -{formatMoney(previewSummary.expense, statement.currency)}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAllRows(e.target.checked)}
                      aria-label="Pilih semua baris"
                      className="rounded border-slate-300 text-teal-700"
                    />
                  </th>
                  <th className="py-3 px-4">Value Date</th>
                  <th className="py-3 px-4">Merchant & Keterangan</th>
                  <th className="py-3 px-4">Kategori</th>
                  <th className="py-3 px-4">Tipe</th>
                  <th className="py-3 px-4 text-right">Nominal ({statement.currency})</th>
                  <th className="py-3 px-4 text-right w-12">Hapus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedPreviewTransactions.map((tx) => {
                  const dup = isPotentialDuplicate(tx);
                  const showPostingDiff = tx.postingDate && tx.postingDate !== tx.date;
                  return (
                    <tr
                      key={tx.id}
                      className={!tx.selected ? 'opacity-50' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'}
                    >
                      <td className="py-2.5 px-4 align-top">
                        <input
                          type="checkbox"
                          checked={tx.selected}
                          onChange={() => toggleRow(tx.id)}
                          className="rounded border-slate-300 text-teal-700 mt-1"
                        />
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap align-top">
                        <input
                          type="date"
                          value={tx.date}
                          onChange={(e) => updateRow(tx.id, { date: e.target.value })}
                          className="bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-white"
                        />
                        {showPostingDiff && (
                          <p className="text-[10px] text-slate-400 px-1.5 mt-0.5">
                            Posting: {tx.postingDate}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-4 min-w-[230px] align-top">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={tx.merchant}
                            onChange={(e) => updateRow(tx.id, { merchant: e.target.value })}
                            className="w-full bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-slate-700 rounded px-1.5 py-0.5 text-xs font-medium text-slate-900 dark:text-white"
                          />
                          {dup && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-medium">
                              Duplikat
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={tx.description}
                          onChange={(e) => updateRow(tx.id, { description: e.target.value })}
                          placeholder="Keterangan mutasi..."
                          className="w-full bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5"
                        />
                      </td>
                      <td className="py-2.5 px-4 align-top">
                        {(() => {
                          const rowCategoryOptions =
                            tx.type === 'income' ? incomeCategoryOptions : expenseCategoryOptions;
                          return (
                            <div className="inline-flex items-center gap-1.5">
                              <CategoryBadgeIcon
                                categoryName={tx.category}
                                customCategories={customCategories}
                                txType={tx.type}
                                size="xs"
                              />
                              <select
                                value={tx.category}
                                onChange={(e) => updateRow(tx.id, { category: e.target.value })}
                                className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200"
                              >
                                {tx.category && !rowCategoryOptions.includes(tx.category) && (
                                  <option value={tx.category}>{tx.category}</option>
                                )}
                                {rowCategoryOptions.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-2.5 px-4 align-top">
                        <select
                          value={tx.type}
                          onChange={(e) => {
                            const nextType: TransactionType =
                              e.target.value === 'income' ? 'income' : 'expense';
                            const targetOptions =
                              nextType === 'income'
                                ? incomeCategoryOptions
                                : expenseCategoryOptions;
                            let nextCategory = tx.category;
                            if (!targetOptions.includes(tx.category)) {
                              const inferred = inferCategoryFromMerchant(
                                `${tx.merchant} ${tx.description}`,
                                nextType === 'income',
                                nextType === 'income' ? 'Pemasukan' : 'Lainnya'
                              );
                              const resolved = resolveBuiltInCategoryName(
                                inferred,
                                customCategories,
                                nextType
                              );
                              nextCategory = targetOptions.includes(resolved)
                                ? resolved
                                : targetOptions[0] || resolved;
                            }
                            updateRow(tx.id, {
                              type: nextType,
                              category: nextCategory,
                            });
                          }}
                          className={`bg-transparent border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs font-medium ${
                            tx.type === 'income'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          <option value="expense">Pengeluaran</option>
                          <option value="income">Pemasukan</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap align-top">
                        <input
                          type="number"
                          step="0.01"
                          value={tx.amount}
                          onChange={(e) =>
                            updateRow(tx.id, { amount: Math.max(0, Number(e.target.value) || 0) })
                          }
                          className="w-28 text-right bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-slate-700 rounded px-1.5 py-0.5 font-semibold text-slate-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2.5 px-4 text-right align-top">
                        <button
                          type="button"
                          onClick={() => removeRow(tx.id)}
                          aria-label="Hapus baris"
                          className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredPreviewTransactions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                      Tidak ada baris yang cocok dengan pencarian "{previewSearch}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filteredPreviewTransactions.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                Menampilkan {previewPageStart + 1}–
                {Math.min(previewPageStart + PREVIEW_PAGE_SIZE, filteredPreviewTransactions.length)} dari{' '}
                {filteredPreviewTransactions.length} transaksi ({PREVIEW_PAGE_SIZE} per halaman)
              </p>

              {totalPreviewPages > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                    disabled={safePreviewPage === 1}
                    aria-label="Halaman pratinjau sebelumnya"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Sebelumnya</span>
                  </button>

                  {previewPageNumbers.map((item, idx) =>
                    item === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-1.5 text-xs text-slate-400 select-none"
                      >
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPreviewPage(item)}
                        aria-current={item === safePreviewPage ? 'page' : undefined}
                        className={`min-w-[30px] h-[30px] px-2 rounded-lg text-xs font-mono tabular-nums font-medium cursor-pointer transition-colors ${
                          item === safePreviewPage
                            ? 'bg-teal-700 text-white shadow-sm'
                            : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages, p + 1))}
                    disabled={safePreviewPage === totalPreviewPages}
                    aria-label="Halaman pratinjau berikutnya"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Berikutnya</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

interface PdfImportModalProps extends PdfImportViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PdfImportModal: React.FC<PdfImportModalProps> = ({
  isOpen,
  onClose,
  ...viewProps
}) => {
  return (
    <div
      className={
        isOpen
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-3 sm:p-6'
          : 'hidden'
      }
      aria-hidden={!isOpen}
    >
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Impor Dokumen & Mutasi (PDF / CSV / JPG / PNG)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tanggal dibaca otomatis dari kolom Value Date. Tinjau transaksi, lalu enkripsi ke brankas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup popup impor dokumen"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto">
          <PdfImportView {...viewProps} />
        </div>
      </div>
    </div>
  );
};
