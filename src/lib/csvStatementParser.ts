import {
  inferCategoryFromMerchant,
  isHouseholdGoodsMerchant,
  resolveBuiltInCategoryName,
  type CustomCategory,
  type ExtractedPdfStatement,
  type ExtractedPdfTransaction,
  type SupportedCurrency,
} from '../types';

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

function detectDelimiter(lines: string[]): ',' | ';' | '\t' {
  const sample = lines.slice(0, 15).join('\n');
  const counts: Record<',' | ';' | '\t', number> = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
  };
  if (counts['\t'] >= counts[','] && counts['\t'] >= counts[';'] && counts['\t'] > 0) {
    return '\t';
  }
  if (counts[';'] > counts[',']) {
    return ';';
  }
  return ',';
}

function parseDelimitedRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function normalizeCsvDate(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^'+/, '');
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const a = Number(dmyMatch[1]);
    const b = Number(dmyMatch[2]);
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    const day = (b > 12 ? b : a).toString().padStart(2, '0');
    const month = (b > 12 ? a : b).toString().padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
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
    OKT: '10',
    DES: '12',
  };
  const textMatch = trimmed.toUpperCase().match(/^(\d{1,2})[\s-/]+([A-Z]{3})[A-Z]*[\s-/]+(\d{2,4})/);
  if (textMatch && monthNames[textMatch[2]]) {
    const day = textMatch[1].padStart(2, '0');
    const year = textMatch[3].length === 2 ? `20${textMatch[3]}` : textMatch[3];
    return `${year}-${monthNames[textMatch[2]]}-${day}`;
  }

  return null;
}

function parseCsvAmount(raw?: string): number {
  if (!raw) return 0;
  let cleaned = raw
    .trim()
    .replace(/\b(AED|IDR|USD|SGD|EUR|RP)\b/gi, '')
    .replace(/\s+/g, '');

  let sign = 1;
  if (/^\(.*\)$/.test(cleaned)) {
    sign = -1;
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith('-')) {
    sign = -1;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  cleaned = cleaned.replace(/(CR|DR)$/i, '');
  if (!cleaned) return 0;

  let value = 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    value = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d+(,\d{1,2})$/.test(cleaned)) {
    value = Number(cleaned.replace(',', '.'));
  } else {
    value = Number(cleaned.replace(/,/g, ''));
  }

  return Number.isFinite(value) ? value * sign : 0;
}

export async function parseCsvStatementFile(
  file: File,
  customCategories: CustomCategory[] = []
): Promise<ExtractedPdfStatement> {
  const rawText = stripBom(await file.text());
  const nonEmptyLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (nonEmptyLines.length < 2) {
    throw new Error(`File ${file.name} tidak memiliki baris transaksi yang valid.`);
  }

  const delimiter = detectDelimiter(nonEmptyLines);
  const rows = parseDelimitedRows(rawText, delimiter);

  // Find table header row (within first 20 rows)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const joined = rows[i].join(' ').toLowerCase();
    const hasDateHdr = /(value\s*date|val\.?\s*date|posting\s*date|post\s*date|trans(?:action)?\s*date|tanggal|date)/i.test(
      joined
    );
    const hasAmtOrDescHdr = /(description|keterangan|merchant|narration|particular|amount|debit|credit|nominal|mutasi)/i.test(
      joined
    );
    if (rows[i].length >= 3 && hasDateHdr && hasAmtOrDescHdr) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error(
      `Header kolom (seperti Value Date / Date, Description, Amount / Debit / Credit) tidak ditemukan pada ${file.name}.`
    );
  }

  const preambleText = rows
    .slice(0, headerIdx)
    .map((r) => r.join(' '))
    .join('\n');

  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const findCol = (patterns: RegExp[]): number => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h) => pat.test(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // STRICT PRIORITY: Value Date column first, Posting Date separately for audit/fallback
  const valueDateCol = findCol([
    /\bvalue\s*date\b/i,
    /\bval\.?\s*date\b/i,
    /\bvaluedate\b/i,
    /\btanggal\s*valuta\b/i,
    /\btgl\s*valuta\b/i,
    /\beffective\s*date\b/i,
  ]);
  const postingDateCol = findCol([
    /\bposting\s*date\b/i,
    /\bpost\s*date\b/i,
    /\bbook\s*date\b/i,
    /\btanggal\s*posting\b/i,
    /\btrans(?:action)?\s*date\b/i,
  ]);
  const genericDateCol = findCol([/^(date|tanggal|tgl)$/i, /\bdate\b/i, /\btanggal\b/i]);

  const descCol = findCol([
    /\bdescription\b/i,
    /\bketerangan\b/i,
    /\bparticulars?\b/i,
    /\bnarration\b/i,
    /\bdetails?\b/i,
    /\buraian\b/i,
  ]);
  const merchantCol = findCol([/\bmerchant\b/i, /\bpayee\b/i, /\bpenerima\b/i]);
  const debitCol = findCol([/\bdebit\b/i, /\bwithdrawal\b/i, /\bpengeluaran\b/i, /\bkeluar\b/i, /\bdr\b/i]);
  const creditCol = findCol([/\bcredit\b/i, /\bdeposit\b/i, /\bpemasukan\b/i, /\bmasuk\b/i, /\bcr\b/i]);
  const amountCol = findCol([/\bamount\b/i, /\bnominal\b/i, /\bjumlah\b/i, /\bmutasi\b/i]);
  const typeCol = findCol([/^(type|tipe|dr\/cr|dc|db\/cr)$/i, /\bdr\/cr\b/i, /\bcredit\/debit\b/i]);
  const refCol = findCol([/\breference\b/i, /\bref\b/i, /\bno\.?\s*ref/i]);
  const balanceCol = findCol([/\bbalance\b/i, /\bsaldo\b/i]);
  const currencyCol = findCol([/\bcurrency\b/i, /\bmata\s*uang\b/i, /\bccy\b/i]);
  const categoryCol = findCol([/\bcategory\b/i, /\bkategori\b/i]);

  if (valueDateCol === -1 && postingDateCol === -1 && genericDateCol === -1) {
    throw new Error(`Kolom tanggal tidak ditemukan pada file ${file.name}.`);
  }

  let bankName = 'Impor CSV Mutasi';
  let currency: SupportedCurrency = 'IDR';
  const combinedHint = `${file.name}\n${preambleText}\n${rows.slice(headerIdx + 1, headerIdx + 6).map((r) => r.join(' ')).join('\n')}`;

  if (/ADCB|ABU DHABI COMMERCIAL/i.test(combinedHint)) {
    bankName = 'ADCB Bank';
    currency = 'AED';
  } else if (/EMIRATES\s*NBD|ENBD/i.test(combinedHint)) {
    bankName = 'Emirates NBD';
    currency = 'AED';
  } else if (/BCA/i.test(combinedHint)) {
    bankName = 'Bank BCA';
    currency = 'IDR';
  } else if (/MANDIRI/i.test(combinedHint)) {
    bankName = 'Bank Mandiri';
    currency = 'IDR';
  } else if (/BNI/i.test(combinedHint)) {
    bankName = 'Bank BNI';
    currency = 'IDR';
  } else if (/BRI/i.test(combinedHint)) {
    bankName = 'Bank BRI';
    currency = 'IDR';
  } else if (/\bAED\b/i.test(combinedHint)) {
    currency = 'AED';
  } else if (/\bUSD\b/i.test(combinedHint)) {
    currency = 'USD';
  } else if (/\bSGD\b/i.test(combinedHint)) {
    currency = 'SGD';
  } else if (/\bEUR\b/i.test(combinedHint)) {
    currency = 'EUR';
  }

  const accountMatch = preambleText.match(/(?:IBAN|Account\s*(?:No|Number)?|Rekening)[:\s#]*([A-Z0-9*\s-]{6,28})/i);
  const accountNumberMasked = accountMatch
    ? `****${accountMatch[1].replace(/\s+/g, '').slice(-4)}`
    : '****';

  const transactions: ExtractedPdfTransaction[] = [];
  let lastBalance = 0;
  let usedValueDateCount = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0) continue;

    const rawValueDate = valueDateCol !== -1 ? r[valueDateCol] : undefined;
    const rawPostingDate = postingDateCol !== -1 ? r[postingDateCol] : undefined;
    const rawGenericDate = genericDateCol !== -1 ? r[genericDateCol] : undefined;

    const normValueDate = normalizeCsvDate(rawValueDate);
    const normPostingDate = normalizeCsvDate(rawPostingDate);
    const normGenericDate = normalizeCsvDate(rawGenericDate);

    // Strictly prefer Value Date over Posting Date / Generic Date
    const resolvedDate = normValueDate || normGenericDate || normPostingDate;
    if (!resolvedDate) continue;
    if (normValueDate) usedValueDateCount++;

    const rawDesc = (descCol !== -1 ? r[descCol] : '') || (merchantCol !== -1 ? r[merchantCol] : '');
    const rawMerch = (merchantCol !== -1 ? r[merchantCol] : '') || rawDesc;
    const cleanDesc = rawDesc.replace(/\s+/g, ' ').trim();
    const cleanMerchant = (rawMerch || cleanDesc).split(/\s{2,}|\s-\s/)[0].replace(/\s+/g, ' ').trim();

    if (
      !cleanDesc ||
      /^(OPENING BALANCE|CLOSING BALANCE|SALDO AWAL|SALDO AKHIR|TOTAL)$/i.test(cleanDesc)
    ) {
      continue;
    }

    let amount = 0;
    let txType: 'income' | 'expense' = 'expense';

    if (debitCol !== -1 || creditCol !== -1) {
      const debitVal = debitCol !== -1 ? Math.abs(parseCsvAmount(r[debitCol])) : 0;
      const creditVal = creditCol !== -1 ? Math.abs(parseCsvAmount(r[creditCol])) : 0;
      if (creditVal > 0 && debitVal === 0) {
        amount = creditVal;
        txType = 'income';
      } else if (debitVal > 0) {
        amount = debitVal;
        txType = 'expense';
      }
    }

    if (amount === 0 && amountCol !== -1) {
      const rawAmtStr = r[amountCol] || '';
      const signed = parseCsvAmount(rawAmtStr);
      amount = Math.abs(signed);
      const rawTypeStr = (typeCol !== -1 ? r[typeCol] : rawAmtStr).toUpperCase();
      if (/\b(CR|CREDIT|MASUK|INCOME|KREDIT)\b/.test(rawTypeStr) || signed > 0 && /\+/.test(rawAmtStr)) {
        txType = 'income';
      } else if (/\b(DR|DEBIT|KELUAR|EXPENSE|DEBET)\b/.test(rawTypeStr) || signed < 0) {
        txType = 'expense';
      } else if (signed > 0 && /\b(CREDIT|CR|SALARY|DEPOSIT|CASHBACK|REFUND|INCOMING|MASUK|SETORAN)\b/i.test(cleanDesc)) {
        txType = 'income';
      }
    }

    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (balanceCol !== -1 && r[balanceCol]) {
      const bal = parseCsvAmount(r[balanceCol]);
      if (bal > 0) lastBalance = bal;
    }
    if (currencyCol !== -1 && r[currencyCol]) {
      const c = r[currencyCol].trim().toUpperCase();
      if (c === 'AED' || c === 'IDR' || c === 'USD' || c === 'SGD' || c === 'EUR') {
        currency = c;
      }
    }

    const rawCat = categoryCol !== -1 && r[categoryCol] ? r[categoryCol].trim() : 'Lainnya';
    const baseCat =
      txType === 'expense' && isHouseholdGoodsMerchant(`${cleanMerchant} ${cleanDesc}`)
        ? 'Barang Rumah Tangga'
        : rawCat === 'Lainnya'
          ? inferCategoryFromMerchant(
              `${cleanMerchant} ${cleanDesc}`,
              txType === 'income',
              txType === 'income' ? 'Pemasukan' : 'Lainnya'
            )
          : rawCat;
    const resolvedCat = resolveBuiltInCategoryName(baseCat, customCategories, txType);

    transactions.push({
      id: `csv-${i}-${Math.random().toString(36).slice(2, 6)}`,
      selected: true,
      date: resolvedDate,
      ...(normPostingDate ? { postingDate: normPostingDate } : {}),
      dateSource: normValueDate ? 'value_date' : normPostingDate && resolvedDate === normPostingDate ? 'posting_date' : 'document_date',
      description: cleanDesc.slice(0, 240),
      merchant: (cleanMerchant || cleanDesc).slice(0, 120),
      amount,
      type: txType,
      category: resolvedCat,
      reference: (refCol !== -1 ? r[refCol] : '').slice(0, 80),
    });
  }

  const dates = transactions.map((t) => t.date).sort();
  const statementPeriod =
    dates.length > 0 ? `${dates[0]} s/d ${dates[dates.length - 1]}` : 'Impor CSV Mutasi';

  return {
    bankName,
    accountNumberMasked,
    currency,
    statementPeriod,
    openingBalance: 0,
    closingBalance: lastBalance,
    detectedDateColumn:
      usedValueDateCount > 0
        ? 'Value Date'
        : postingDateCol !== -1 && genericDateCol === -1
          ? 'Posting Date'
          : 'Tanggal CSV',
    transactions,
  };
}
