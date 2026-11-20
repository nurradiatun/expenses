import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  inferCategoryFromMerchant,
  type ExtractedPdfStatement,
  type ExtractedPdfTransaction,
  type SupportedCurrency,
} from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class PdfPasswordError extends Error {
  code: 'NEED_PASSWORD' | 'INCORRECT_PASSWORD';

  constructor(code: 'NEED_PASSWORD' | 'INCORRECT_PASSWORD', message: string) {
    super(message);
    this.name = 'PdfPasswordError';
    this.code = code;
  }
}

function classifyPdfJsError(err: unknown): never {
  if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'PasswordException') {
    const code = (err as { code?: number }).code;
    if (code === 2) {
      throw new PdfPasswordError(
        'INCORRECT_PASSWORD',
        'Kode pembuka PDF salah. Periksa kembali kata sandi/kode dokumen Anda.'
      );
    }
    throw new PdfPasswordError(
      'NEED_PASSWORD',
      'File PDF ini dilindungi kata sandi. Masukkan kode pembuka PDF untuk melanjutkan.'
    );
  }
  throw err instanceof Error ? err : new Error(String(err));
}

const DATE_TOKEN_REGEX_SOURCE =
  '(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}[\\s-/]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mei|Agu|Okt|Des)[a-z]*[\\s-/]+\\d{2,4})';

function normalizeDateToken(raw: string): string {
  const cleaned = raw.trim();
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch) {
    const a = Number(dmyMatch[1]);
    const b = Number(dmyMatch[2]);
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    const day = (b > 12 ? b : a).toString().padStart(2, '0');
    const month = (b > 12 ? a : b).toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const monthNames: Record<string, string> = {
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12',
    MEI: '05',
    AGU: '08',
    Okt: '10',
    OKT: '10',
    DES: '12',
  };
  const textMatch = cleaned.toUpperCase().match(/^(\d{1,2})[\s-/]+([A-Z]{3})[A-Z]*[\s-/]+(\d{2,4})$/);
  if (textMatch && monthNames[textMatch[2]]) {
    const day = textMatch[1].padStart(2, '0');
    const year = textMatch[3].length === 2 ? `20${textMatch[3]}` : textMatch[3];
    return `${year}-${monthNames[textMatch[2]]}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function parseNumericToken(raw: string): number {
  const cleaned = raw.replace(/\s+/g, '').replace(/(CR|DR)$/i, '').replace(/^[+-]/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return Number(cleaned.replace(/,/g, ''));
}

async function openPdfDocument(file: File, password?: string) {
  const buffer = await file.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({
      data: buffer,
      password: password ? password : undefined,
    }).promise;
  } catch (err) {
    classifyPdfJsError(err);
  }
}

interface PdfTextCell {
  str: string;
  x: number;
  y: number;
}

async function extractTextLinesForPage(page: pdfjsLib.PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent();
  const cells: PdfTextCell[] = [];

  for (const item of content.items) {
    if (!('str' in item)) continue;
    const text = item.str.trim();
    if (!text) continue;
    cells.push({
      str: text,
      x: Number(item.transform?.[4] ?? 0),
      y: Number(item.transform?.[5] ?? 0),
    });
  }

  // Group into horizontal rows (top-to-bottom), then sort left-to-right by X coordinate
  cells.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: PdfTextCell[][] = [];
  for (const cell of cells) {
    const lastRow = rows[rows.length - 1];
    if (!lastRow || Math.abs(lastRow[0].y - cell.y) > 4) {
      rows.push([cell]);
    } else {
      lastRow.push(cell);
    }
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const joined = row.map((c) => c.str).join(' ').replace(/\s+/g, ' ').trim();
    if (joined) lines.push(joined);
  }
  return lines;
}

async function extractTextLinesFromPdf(pdf: pdfjsLib.PDFDocumentProxy): Promise<string[]> {
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const pageLines = await extractTextLinesForPage(page);
    lines.push(...pageLines);
  }
  return lines;
}

export interface PdfAiChunk {
  mode: 'raw_pdf' | 'page_images';
  extractedText?: string;
  pageImages?: string[];
  chunkInfo: string;
  totalPages: number;
}

/**
 * Unlocks a PDF locally in the browser using pdfjs-dist (throwing PdfPasswordError if a code
 * is required or incorrect) and splits multi-page or password-protected PDFs into 4-page chunks
 * covering ALL pages so every transaction across every uploaded PDF is extracted completely.
 */
export async function preparePdfChunksForAiExtraction(
  file: File,
  password?: string,
  pagesPerChunk = 4
): Promise<PdfAiChunk[]> {
  const pdf = await openPdfDocument(file, password);
  const totalPages = pdf.numPages;

  // For short unlocked PDFs (<= 4 pages), send the native PDF + ordered text in a single request
  if (!password && totalPages <= pagesPerChunk) {
    const lines = await extractTextLinesFromPdf(pdf);
    const extractedText = lines.join('\n').trim();
    return [
      {
        mode: 'raw_pdf',
        ...(extractedText ? { extractedText } : {}),
        chunkInfo: `Halaman 1-${totalPages} dari ${totalPages}`,
        totalPages,
      },
    ];
  }

  const chunks: PdfAiChunk[] = [];
  for (let startPage = 1; startPage <= totalPages; startPage += pagesPerChunk) {
    const endPage = Math.min(totalPages, startPage + pagesPerChunk - 1);
    const pageImages: string[] = [];
    const chunkTextLines: string[] = [];

    for (let p = startPage; p <= endPage; p++) {
      const page = await pdf.getPage(p);
      const pageLines = await extractTextLinesForPage(page);
      if (pageLines.length > 0) {
        chunkTextLines.push(`--- Halaman ${p} ---`, ...pageLines);
      }
      const viewport = page.getViewport({ scale: 1.65 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        pageImages.push(canvas.toDataURL('image/jpeg', 0.85));
      }
    }

    chunks.push({
      mode: 'page_images',
      pageImages,
      extractedText: chunkTextLines.join('\n').trim(),
      chunkInfo: `Halaman ${startPage}-${endPage} dari ${totalPages}`,
      totalPages,
    });
  }

  return chunks;
}

export async function preparePdfForAiExtraction(
  file: File,
  password?: string
): Promise<{ isEncrypted: boolean; extractedText?: string; pageImages?: string[] }> {
  const chunks = await preparePdfChunksForAiExtraction(file, password, 12);
  const first = chunks[0];
  if (!first || first.mode === 'raw_pdf') {
    return {
      isEncrypted: false,
      extractedText: first?.extractedText,
    };
  }
  return {
    isEncrypted: true,
    extractedText: first.extractedText,
    pageImages: first.pageImages,
  };
}

export async function parsePdfStatementLocally(
  file: File,
  password?: string
): Promise<ExtractedPdfStatement> {
  const pdf = await openPdfDocument(file, password);
  const lines = await extractTextLinesFromPdf(pdf);

  const fullText = lines.join('\n');
  let bankName = 'Bank Umum';
  let currency: SupportedCurrency = 'IDR';
  if (/ADCB|ABU DHABI COMMERCIAL BANK/i.test(fullText)) {
    bankName = 'ADCB Bank';
    currency = 'AED';
  } else if (/EMIRATES\s*NBD|ENBD/i.test(fullText)) {
    bankName = 'Emirates NBD';
    currency = 'AED';
  } else if (/FAB|FIRST ABU DHABI/i.test(fullText)) {
    bankName = 'First Abu Dhabi Bank';
    currency = 'AED';
  } else if (/BCA|BANK CENTRAL ASIA/i.test(fullText)) {
    bankName = 'Bank BCA';
    currency = 'IDR';
  } else if (/MANDIRI/i.test(fullText)) {
    bankName = 'Bank Mandiri';
    currency = 'IDR';
  } else if (/BNI|BANK NEGARA INDONESIA/i.test(fullText)) {
    bankName = 'Bank BNI';
    currency = 'IDR';
  } else if (/BRI|BANK RAKYAT INDONESIA/i.test(fullText)) {
    bankName = 'Bank BRI';
    currency = 'IDR';
  } else if (/\bAED\b/i.test(fullText)) {
    currency = 'AED';
  } else if (/\bUSD\b/i.test(fullText)) {
    currency = 'USD';
  } else if (/\bSGD\b/i.test(fullText)) {
    currency = 'SGD';
  } else if (/\bEUR\b/i.test(fullText)) {
    currency = 'EUR';
  }

  const accountMatch = fullText.match(/(?:IBAN|Account\s*(?:No|Number)?|Rekening)[:\s#]*([A-Z0-9*\s-]{6,28})/i);
  const accountNumberMasked = accountMatch
    ? `****${accountMatch[1].replace(/\s+/g, '').slice(-4)}`
    : '****';

  let detectedOpeningBalance = 0;
  const openingMatch = fullText.match(/(?:Opening Balance|Saldo Awal)[^\d]*(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?)/i);
  if (openingMatch) {
    detectedOpeningBalance = parseNumericToken(openingMatch[1]) || 0;
  }

  let detectedClosingBalance = 0;
  const closingMatch = fullText.match(/(?:Closing Balance|Saldo Akhir)[^\d]*(\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?)/i);
  if (closingMatch) {
    detectedClosingBalance = parseNumericToken(closingMatch[1]) || 0;
  }

  // Detect column ordering from table header: Value Date vs Posting Date
  let valueDateOrder: 'first' | 'second' = 'second';
  let sawValueDateHeader = false;

  const twoLeadingDatesRegex = new RegExp(
    `^(${DATE_TOKEN_REGEX_SOURCE})\\s+(${DATE_TOKEN_REGEX_SOURCE})\\b(.*)$`,
    'i'
  );
  const singleLeadingDateRegex = new RegExp(`^(${DATE_TOKEN_REGEX_SOURCE})\\b(.*)$`, 'i');
  const embeddedDateRegex = new RegExp(`(${DATE_TOKEN_REGEX_SOURCE})`, 'i');
  const amountPattern = /([+-]?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})?)\s*(CR|DR)?$/i;

  const transactions: ExtractedPdfTransaction[] = [];
  let usedValueDateCount = 0;

  lines.forEach((line, idx) => {
    // Check if this line is a column header declaring Posting Date vs Value Date order
    const valHdrMatch = line.match(/\b(value\s*date|val\.?\s*date|tanggal\s*valuta|effective\s*date)\b/i);
    const postHdrMatch = line.match(/\b(posting\s*date|post\s*date|book\s*date|trans(?:action)?\s*date)\b/i);
    if (valHdrMatch) {
      sawValueDateHeader = true;
      if (postHdrMatch && valHdrMatch.index !== undefined && postHdrMatch.index !== undefined) {
        valueDateOrder = valHdrMatch.index < postHdrMatch.index ? 'first' : 'second';
      }
      return;
    }

    let primaryDateRaw: string | null = null;
    let postingDateRaw: string | null = null;
    let rest = '';
    let hasValueDate = false;

    const twoDates = line.match(twoLeadingDatesRegex);
    if (twoDates) {
      const firstDate = twoDates[1];
      const secondDate = twoDates[2];
      rest = twoDates[3].trim();
      hasValueDate = true;
      if (valueDateOrder === 'first') {
        primaryDateRaw = firstDate;
        postingDateRaw = secondDate;
      } else {
        // Default & standard bank statement order: Posting Date first, Value Date second
        postingDateRaw = firstDate;
        primaryDateRaw = secondDate;
      }
    } else {
      const oneDate = line.match(singleLeadingDateRegex);
      if (!oneDate) return;
      const firstDate = oneDate[1];
      const afterFirst = oneDate[2].trim();

      // Check if a second date appears shortly after within the first ~45 chars (e.g. "01 Nov 2026 REF123 02 Nov 2026 ...")
      const headChunk = afterFirst.slice(0, 45);
      const secondEmbedded = headChunk.match(embeddedDateRegex);
      if (secondEmbedded && secondEmbedded.index !== undefined) {
        hasValueDate = true;
        if (valueDateOrder === 'first') {
          primaryDateRaw = firstDate;
          postingDateRaw = secondEmbedded[1];
        } else {
          postingDateRaw = firstDate;
          primaryDateRaw = secondEmbedded[1];
        }
        rest =
          (
            afterFirst.slice(0, secondEmbedded.index) +
            ' ' +
            afterFirst.slice(secondEmbedded.index + secondEmbedded[0].length)
          ).trim();
      } else {
        primaryDateRaw = firstDate;
        rest = afterFirst;
        hasValueDate = sawValueDateHeader;
      }
    }

    if (!primaryDateRaw) return;

    const amounts = [...rest.matchAll(/([+-]?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2})?)\s*(CR|DR)?/gi)];
    if (amounts.length === 0) return;

    const candidate = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
    const parsedAmt = parseNumericToken(candidate[1]);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) return;

    const flag = (candidate[2] || '').toUpperCase();
    const isIncome =
      flag === 'CR' ||
      candidate[1].startsWith('+') ||
      /\b(CREDIT|CR|SALARY|DEPOSIT|CASHBACK|REFUND|INCOMING|MASUK|SETORAN)\b/i.test(rest);

    const aMatch = rest.match(amountPattern);
    const cleanDesc = rest
      .slice(0, candidate.index ?? (aMatch ? rest.length - aMatch[0].length : rest.length))
      .replace(/\b(Rp|IDR|AED|USD|SGD|EUR)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanDesc || /OPENING BALANCE|CLOSING BALANCE|SALDO AWAL|SALDO AKHIR/i.test(cleanDesc)) {
      return;
    }

    const normalizedPrimary = normalizeDateToken(primaryDateRaw);
    const normalizedPosting = postingDateRaw ? normalizeDateToken(postingDateRaw) : undefined;
    if (hasValueDate) usedValueDateCount++;

    transactions.push({
      id: `local-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      selected: true,
      date: normalizedPrimary,
      ...(normalizedPosting ? { postingDate: normalizedPosting } : {}),
      dateSource: hasValueDate ? 'value_date' : 'document_date',
      description: cleanDesc.slice(0, 220),
      merchant: cleanDesc.split(/\s{2,}|\s-\s/)[0].slice(0, 80) || cleanDesc.slice(0, 60),
      amount: parsedAmt,
      type: isIncome ? 'income' : 'expense',
      category: inferCategoryFromMerchant(cleanDesc, isIncome),
      reference: '',
    });
  });

  return {
    bankName,
    accountNumberMasked,
    currency,
    statementPeriod: 'Ekstraksi Lokal PDF',
    openingBalance: detectedOpeningBalance,
    closingBalance: detectedClosingBalance,
    detectedDateColumn: usedValueDateCount > 0 ? 'Value Date' : 'Tanggal Transaksi',
    transactions,
  };
}
