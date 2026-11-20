import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
let hydrogenCooldownUntil = 0;

function formatFriendlyAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.toLowerCase().includes('high demand')) {
    return 'Layanan AI sedang mengalami lonjakan trafik sementara (503). Silakan klik Coba Lagi beberapa detik lagi.';
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return 'Batas permintaan AI sementara tercapai (429). Mohon tunggu sebentar lalu coba lagi.';
  }
  if (raw.includes('AbortError') || raw.toLowerCase().includes('aborted') || raw.toLowerCase().includes('timeout')) {
    return 'Waktu pemrosesan AI habis. Jika gambar berukuran besar, coba unggah 1-2 gambar per batch.';
  }
  if (raw.trimStart().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed?.error?.message) return parsed.error.message;
    } catch {
      // fall through
    }
  }
  return raw || 'Gagal mengekstrak dokumen keuangan.';
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY tidak tersedia di konfigurasi server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ParsedStatementTransaction {
  date: string;
  valueDate?: string;
  postingDate?: string;
  description: string;
  merchant: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  reference: string;
}

interface ParsedStatementResult {
  bankName: string;
  accountNumberMasked: string;
  currency: 'AED' | 'IDR' | 'USD' | 'SGD' | 'EUR';
  statementPeriod: string;
  openingBalance: number;
  closingBalance: number;
  detectedDateColumn?: string;
  transactions: ParsedStatementTransaction[];
}

function normalizeStatementDate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const a = Number(dmyMatch[1]);
    const b = Number(dmyMatch[2]);
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    // Assume DD/MM/YYYY unless middle > 12 (MM/DD/YYYY)
    const day = (b > 12 ? b : a).toString().padStart(2, '0');
    const month = (b > 12 ? a : b).toString().padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const monthNames: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    MEI: '05', AGU: '08', OKT: '10', DES: '12',
  };
  const textMatch = trimmed.toUpperCase().match(/^(\d{1,2})[\s-/]+([A-Z]{3})[A-Z]*[\s-/]+(\d{2,4})/);
  if (textMatch && monthNames[textMatch[2]]) {
    const day = textMatch[1].padStart(2, '0');
    const year = textMatch[3].length === 2 ? `20${textMatch[3]}` : textMatch[3];
    return `${year}-${monthNames[textMatch[2]]}-${day}`;
  }

  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Live Exchange Rates Cache (15 minutes TTL)
  let cachedFxPayload: {
    ratesToIdr: { AED: number; IDR: number; USD: number; SGD: number; EUR: number };
    source: string;
    updatedAtIso: string;
    providerUpdatedAt?: string;
    isLive: boolean;
    cachedAtMs: number;
  } | null = null;
  const FX_CACHE_TTL_MS = 15 * 60 * 1000;

  async function fetchJsonWithTimeout(url: string, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  app.get('/api/exchange-rates', async (req: Request, res: Response) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force && cachedFxPayload && Date.now() - cachedFxPayload.cachedAtMs < FX_CACHE_TTL_MS) {
      res.json({
        ratesToIdr: cachedFxPayload.ratesToIdr,
        source: cachedFxPayload.source,
        updatedAtIso: cachedFxPayload.updatedAtIso,
        providerUpdatedAt: cachedFxPayload.providerUpdatedAt,
        isLive: cachedFxPayload.isLive,
      });
      return;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    // Provider 1: open.er-api.com (keyless, supports AED, IDR, USD, SGD, EUR)
    try {
      const data = (await fetchJsonWithTimeout('https://open.er-api.com/v6/latest/AED')) as {
        result?: string;
        time_last_update_utc?: string;
        rates?: Record<string, number>;
      };
      const r = data?.rates;
      if (
        data?.result === 'success' &&
        r &&
        Number.isFinite(r.IDR) &&
        r.IDR > 0 &&
        Number.isFinite(r.USD) &&
        r.USD > 0 &&
        Number.isFinite(r.SGD) &&
        r.SGD > 0 &&
        Number.isFinite(r.EUR) &&
        r.EUR > 0
      ) {
        const ratesToIdr = {
          AED: round2(r.IDR),
          IDR: 1,
          USD: round2(r.IDR / r.USD),
          SGD: round2(r.IDR / r.SGD),
          EUR: round2(r.IDR / r.EUR),
        };
        cachedFxPayload = {
          ratesToIdr,
          source: 'ExchangeRate-API (Otomatis)',
          updatedAtIso: new Date().toISOString(),
          providerUpdatedAt: data.time_last_update_utc,
          isLive: true,
          cachedAtMs: Date.now(),
        };
        res.json({
          ratesToIdr: cachedFxPayload.ratesToIdr,
          source: cachedFxPayload.source,
          updatedAtIso: cachedFxPayload.updatedAtIso,
          providerUpdatedAt: cachedFxPayload.providerUpdatedAt,
          isLive: true,
        });
        return;
      }
    } catch (err) {
      console.warn('Primary FX provider open.er-api.com failed:', err);
    }

    // Provider 2: jsDelivr fawazahmed0 currency-api (keyless CDN fallback)
    try {
      const data = (await fetchJsonWithTimeout(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/aed.json'
      )) as {
        date?: string;
        aed?: Record<string, number>;
      };
      const r = data?.aed;
      if (
        r &&
        Number.isFinite(r.idr) &&
        r.idr > 0 &&
        Number.isFinite(r.usd) &&
        r.usd > 0 &&
        Number.isFinite(r.sgd) &&
        r.sgd > 0 &&
        Number.isFinite(r.eur) &&
        r.eur > 0
      ) {
        const ratesToIdr = {
          AED: round2(r.idr),
          IDR: 1,
          USD: round2(r.idr / r.usd),
          SGD: round2(r.idr / r.sgd),
          EUR: round2(r.idr / r.eur),
        };
        cachedFxPayload = {
          ratesToIdr,
          source: 'Currency API CDN (Otomatis)',
          updatedAtIso: new Date().toISOString(),
          providerUpdatedAt: data.date,
          isLive: true,
          cachedAtMs: Date.now(),
        };
        res.json({
          ratesToIdr: cachedFxPayload.ratesToIdr,
          source: cachedFxPayload.source,
          updatedAtIso: cachedFxPayload.updatedAtIso,
          providerUpdatedAt: cachedFxPayload.providerUpdatedAt,
          isLive: true,
        });
        return;
      }
    } catch (err) {
      console.warn('Secondary FX provider failed:', err);
    }

    // Fallback to last cached live rate if available
    if (cachedFxPayload) {
      res.json({
        ratesToIdr: cachedFxPayload.ratesToIdr,
        source: `${cachedFxPayload.source} (Cache)`,
        updatedAtIso: cachedFxPayload.updatedAtIso,
        providerUpdatedAt: cachedFxPayload.providerUpdatedAt,
        isLive: cachedFxPayload.isLive,
      });
      return;
    }

    // Offline baseline fallback
    res.json({
      ratesToIdr: {
        AED: 4350,
        IDR: 1,
        USD: 15950,
        SGD: 11900,
        EUR: 17150,
      },
      source: 'Kurs Referensi Offline',
      updatedAtIso: new Date().toISOString(),
      isLive: false,
    });
  });

  // 1. Automatic PDF Bank Statement Parser via Gemini 4 Hydrogen
  app.post('/api/parse-statement', async (req: Request, res: Response) => {
    try {
      const { pdfBase64, pageImages, extractedText, fileName, accountHint, chunkInfo, customCategories } = req.body as {
        pdfBase64?: string;
        pageImages?: string[];
        extractedText?: string;
        fileName?: string;
        accountHint?: string;
        chunkInfo?: string;
        customCategories?: string[];
      };

      const sanitizedCustomCategories = Array.isArray(customCategories)
        ? customCategories
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.trim().slice(0, 50))
            .filter(Boolean)
            .slice(0, 30)
        : [];

      const hasImages = Array.isArray(pageImages) && pageImages.length > 0;
      const hasRawPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0;

      if (!hasImages && !hasRawPdf) {
        res.status(400).json({ error: 'File PDF atau gambar tidak ditemukan atau format tidak valid.' });
        return;
      }

      if (hasRawPdf && pdfBase64!.length > 20 * 1024 * 1024) {
        res.status(413).json({ error: 'Ukuran file PDF melebihi batas maksimal 15 MB.' });
        return;
      }

      const ai = getGeminiClient();

      const customCategoryHint =
        sanitizedCustomCategories.length > 0
          ? ` Pengguna juga memiliki kategori kustom berikut yang boleh digunakan jika sesuai: ${sanitizedCustomCategories.map((c) => `"${c}"`).join(', ')}.`
          : '';

      const prompt = [
        'Anda adalah analis ekstraksi dokumen keuangan presisi tinggi.',
        `Nama file: ${fileName || 'dokumen_keuangan'}.`,
        chunkInfo ? `Bagian dokumen: ${chunkInfo}.` : '',
        accountHint ? `Petunjuk sumber dana pengguna: ${accountHint}.` : '',
        'Ekstrak seluruh informasi sumber dana/dokumen dan daftar transaksi dari file PDF atau gambar (JPG, JPEG, PNG, WEBP) terlampir (baik laporan mutasi bank, tangkapan layar m-banking, kartu kredit, dompet tunai/cash, maupun struk belanja/nota/invoice) secara lengkap dan akurat.',
        'Aturan ketat:',
        '1. PRIORITAS TANGGAL (WAJIB DIPATUHI): Jika laporan mutasi bank memiliki kolom "Value Date" (atau "Val Date", "Val. Date", "Tanggal Valuta", "Effective Date") DAN kolom "Posting Date" ("Post Date", "Book Date", "Trans Date", "Transaction Date"), WAJIB baca dan masukkan tanggal dari kolom VALUE DATE ke field "valueDate" dan field "date" (BUKAN dari kolom Posting Date!). Masukkan tanggal kolom Posting Date ke field "postingDate" hanya sebagai referensi. Jika hanya ada satu tanggal (misal mutasi tanpa Value Date atau struk belanja), isi "date" dengan tanggal tersebut dan kosongkan "valueDate" (""). Semua tanggal wajib berformat YYYY-MM-DD.',
        '2. Nilai amount harus selalu angka positif (> 0). Gunakan field type: "income" untuk kredit/dana masuk/setoran/bunga/cashback/gaji/pemasukan, dan "expense" untuk debit/tarik tunai/pembayaran/tagihan/struk belanja/invoice/transfer keluar/biaya admin. Perhatikan kolom Debit vs Credit secara terpisah jika ada.',
        '3. Jika gambar berupa struk belanja tunggal (misal struk supermarket/restoran dengan banyak item belanja lalu ada Total Akhir / Grand Total), catat sebagai 1 transaksi utama sebesar Grand Total (jangan memecah setiap barang menjadi transaksi terpisah), kecuali dokumen memang daftar mutasi / banyak struk terpisah.',
        `4. Kategorikan setiap transaksi sesuai tipenya. Untuk PENGELUARAN ("expense"), pilih dari: "Makan & Minum", "Transportasi", "Belanja & Groceries", "Barang Rumah Tangga", "Tagihan & Utilitas", "Tempat Tinggal", "Kesehatan", "Hiburan & Gaya Hidup", "Transfer & Pengiriman", "Biaya Bank", atau "Lainnya". Untuk PEMASUKAN ("income"), pilih dari: "Gaji", "Bonus & Tunjangan", "Usaha & Freelance", "Investasi & Bunga", "Cashback & Refund", "Transfer Masuk", "Pemasukan", atau "Pemasukan Lainnya".${customCategoryHint} Khusus transaksi di IKEA, Homecentre (Home Centre), Homebox (Home Box), Informa, Ace Hardware, atau toko furnitur & perlengkapan rumah tangga, WAJIB gunakan kategori "Barang Rumah Tangga".`,
        '5. Untuk mata uang, gunakan kode ISO 3 huruf ("AED", "IDR", "USD", "SGD", atau "EUR"). Jika bank adalah ADCB / Emirates NBD / bank UEA dan tertulis AED, gunakan "AED". Jika bank Indonesia (BCA/Mandiri/BNI/BRI/e-wallet Indonesia) atau tertulis Rp/IDR, gunakan "IDR".',
        '6. Isi field "detectedDateColumn" dengan nama kolom tanggal utama yang dipakai (misal "Value Date" jika kolom Value Date ditemukan, atau "Posting Date" / "Tanggal Transaksi" jika tidak ada Value Date).',
        '7. EKSTRAKSI LENGKAP: Ekstrak SEMUA baris transaksi dari halaman pertama hingga halaman terakhir lampiran ini tanpa melewatkan satu pun transaksi (jangan meringkas atau memotong daftar). Jika ini bagian lanjutan halaman mutasi, tetap ekstrak semua baris tabel meski header tabel tidak diulang.',
        '8. DILARANG KERAS mengarang, menebak, atau membuat data contoh fiktif. Hanya ekstrak transaksi yang benar-benar terlihat tertulis di dokumen/gambar. Jika gambar kosong, buram, atau tidak memuat transaksi keuangan yang jelas, kembalikan transactions: [] (array kosong), bankName: "Tidak Terdeteksi", accountNumberMasked: "****", openingBalance: 0, dan closingBalance: 0.',
        extractedText ? `\nTeks hasil pembacaan dokumen (urutan kiri-ke-kanan per baris):\n${extractedText.slice(0, 60000)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

      if (hasImages) {
        for (const img of pageImages!.slice(0, 12)) {
          const match = img.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
          if (match) {
            const rawMime = match[1].toLowerCase();
            const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
            parts.push({
              inlineData: {
                mimeType: normalizedMime,
                data: match[2],
              },
            });
          }
        }
      } else if (hasRawPdf) {
        const cleanBase64 = pdfBase64!.replace(/^data:application\/pdf;base64,/, '');
        parts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: cleanBase64,
          },
        });
      }

      if (parts.length === 0) {
        res.status(400).json({ error: 'Format file PDF atau gambar (JPG, JPEG, PNG, WEBP) tidak valid.' });
        return;
      }

      parts.push({ text: prompt });

      const schemaConfig = {
        systemInstruction:
          'You are a strict financial OCR extractor. Always prioritize the Value Date column over the Posting Date / Transaction Date column whenever both date columns exist in a bank statement. Only extract numbers, dates, and merchants visibly present in the provided PDF or images. Never invent or fabricate sample data when an image is blank or unreadable; return empty transactions: [] instead.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bankName: { type: Type.STRING, description: 'Nama bank atau penerbit dokumen keuangan' },
            accountNumberMasked: { type: Type.STRING, description: 'Nomor rekening tersamar, misal ****8912' },
            currency: { type: Type.STRING, description: 'Kode mata uang AED, IDR, USD, SGD, atau EUR' },
            statementPeriod: { type: Type.STRING, description: 'Periode laporan mutasi, misal 01 Nov 2026 - 30 Nov 2026' },
            openingBalance: { type: Type.NUMBER, description: 'Saldo awal periode mutasi' },
            closingBalance: { type: Type.NUMBER, description: 'Saldo akhir periode mutasi' },
            detectedDateColumn: {
              type: Type.STRING,
              description: 'Nama kolom tanggal yang digunakan untuk field date (misal Value Date atau Tanggal Transaksi)',
            },
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  valueDate: {
                    type: Type.STRING,
                    description: 'Tanggal dari kolom Value Date / Val Date / Tanggal Valuta format YYYY-MM-DD (string kosong jika kolom Value Date tidak ada)',
                  },
                  postingDate: {
                    type: Type.STRING,
                    description: 'Tanggal dari kolom Posting Date / Book Date / Transaction Date format YYYY-MM-DD jika ada (atau string kosong)',
                  },
                  date: {
                    type: Type.STRING,
                    description: 'Tanggal utama transaksi format YYYY-MM-DD. WAJIB sama dengan valueDate jika kolom Value Date tersedia, BUKAN postingDate.',
                  },
                  description: { type: Type.STRING, description: 'Keterangan asli mutasi bank atau item transaksi' },
                  merchant: { type: Type.STRING, description: 'Nama merchant atau pihak penerima/pengirim yang dirapikan' },
                  amount: { type: Type.NUMBER, description: 'Nominal positif transaksi' },
                  type: { type: Type.STRING, description: 'income atau expense' },
                  category: { type: Type.STRING, description: 'Kategori pengeluaran atau pemasukan' },
                  reference: { type: Type.STRING, description: 'Nomor referensi mutasi jika ada, atau string kosong' },
                },
                required: ['valueDate', 'postingDate', 'date', 'description', 'merchant', 'amount', 'type', 'category', 'reference'],
              },
            },
          },
          required: [
            'bankName',
            'accountNumberMasked',
            'currency',
            'statementPeriod',
            'openingBalance',
            'closingBalance',
            'detectedDateColumn',
            'transactions',
          ],
        },
      };

      const callModelWithTimeout = async (
        model: string,
        thinkingLevel: ThinkingLevel,
        timeoutMs: number
      ) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              ...schemaConfig,
              abortSignal: controller.signal,
              thinkingConfig: { thinkingLevel },
            },
          });
        } finally {
          clearTimeout(timer);
        }
      };

      const attempts: Array<{
        model: string;
        thinkingLevel: ThinkingLevel;
        timeoutMs: number;
        delayMs: number;
      }> =
        Date.now() < hydrogenCooldownUntil
          ? [
              { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 55_000, delayMs: 800 },
              { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 45_000, delayMs: 0 },
            ]
          : [
              { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, timeoutMs: 65_000, delayMs: 400 },
              { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 45_000, delayMs: 0 },
            ];

      let responseText: string | undefined;
      let lastError: unknown;
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          const response = await callModelWithTimeout(
            attempt.model,
            attempt.thinkingLevel,
            attempt.timeoutMs
          );
          responseText = response.text;
          break;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.toLowerCase().includes('high demand') ||
            msg.includes('429') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('AbortError') ||
            msg.toLowerCase().includes('aborted') ||
            msg.toLowerCase().includes('timeout');
          if (attempt.model === 'gemini-4-hydrogen' && isTransient) {
            hydrogenCooldownUntil = Date.now() + 60_000;
          }
          if (!isTransient || i === attempts.length - 1) {
            throw err;
          }
          if (attempt.delayMs > 0) {
            await new Promise((r) => setTimeout(r, attempt.delayMs));
          }
        }
      }

      if (!responseText && lastError) {
        throw lastError;
      }

      const rawText = (responseText ?? '{}')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      const parsed = JSON.parse(rawText) as ParsedStatementResult;

      const allowedCurrencies = new Set(['AED', 'IDR', 'USD', 'SGD', 'EUR']);
      const normalizedCurrency = allowedCurrencies.has(parsed.currency) ? parsed.currency : 'IDR';

      let usedValueDateCount = 0;
      const normalizedTransactions = (parsed.transactions || [])
        .filter((tx) => tx && typeof tx.amount === 'number' && tx.amount > 0 && tx.description)
        .map((tx) => {
          const cleanDesc = String(tx.description).slice(0, 240);
          const cleanMerchant = String(tx.merchant || tx.description).slice(0, 120);
          const txType = tx.type === 'income' ? ('income' as const) : ('expense' as const);
          const isHouseholdMerchant =
            txType === 'expense' &&
            /\b(IKEA|HOME\s*CENTRE|HOMECENTRE|HOME\s*BOX|HOMEBOX|ACE\s*HARDWARE|INFORMA|MR\.?\s*DIY|ATRIA)\b/i.test(
              `${cleanMerchant} ${cleanDesc}`
            );

          const normValueDate = normalizeStatementDate(tx.valueDate);
          const normDate = normalizeStatementDate(tx.date);
          const normPostingDate = normalizeStatementDate(tx.postingDate);
          const resolvedDate =
            normValueDate || normDate || normPostingDate || new Date().toISOString().slice(0, 10);
          const dateSource = normValueDate
            ? ('value_date' as const)
            : normPostingDate && resolvedDate === normPostingDate
              ? ('posting_date' as const)
              : ('document_date' as const);
          if (normValueDate) usedValueDateCount++;

          return {
            date: resolvedDate,
            ...(normPostingDate ? { postingDate: normPostingDate } : {}),
            dateSource,
            description: cleanDesc,
            merchant: cleanMerchant,
            amount: Math.abs(Number(tx.amount)),
            type: txType,
            category: isHouseholdMerchant
              ? 'Barang Rumah Tangga'
              : String(tx.category || 'Lainnya').slice(0, 60),
            reference: String(tx.reference || '').slice(0, 80),
          };
        });

      const resolvedDetectedDateColumn =
        usedValueDateCount > 0
          ? 'Value Date'
          : parsed.detectedDateColumn || 'Tanggal Transaksi';

      res.json({
        bankName: parsed.bankName || 'Bank Umum',
        accountNumberMasked: parsed.accountNumberMasked || '****',
        currency: normalizedCurrency,
        statementPeriod: parsed.statementPeriod || 'Periode Terbaru',
        openingBalance: Number(parsed.openingBalance) || 0,
        closingBalance: Number(parsed.closingBalance) || 0,
        detectedDateColumn: resolvedDetectedDateColumn,
        transactions: normalizedTransactions,
      });
    } catch (error) {
      console.error('Error parsing statement:', error);
      res.status(500).json({ error: formatFriendlyAiError(error) });
    }
  });


  // Ensure unmatched /api routes and Express body-parser errors always return JSON (never HTML)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next(err);
      return;
    }
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? ((err as { status: number }).status >= 502 && (err as { status: number }).status <= 504
            ? 500
            : (err as { status: number }).status)
        : 500;
    const rawMsg = err instanceof Error ? err.message : 'Terjadi kesalahan pada server API.';
    const message =
      (err as { type?: string })?.type === 'entity.too.large'
        ? 'Ukuran file yang dikirim terlalu besar (maksimal 20 MB).'
        : rawMsg;
    res.status(status).json({ error: message });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output tidak ditemukan.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`My Expenses server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
