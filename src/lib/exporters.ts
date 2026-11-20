import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DisplayCurrency,
  FinancialAccount,
  FinancialTransaction,
  SupportedCurrency,
} from '../types';
import {
  convertCurrency,
  formatMoney,
  formatMonthLabel,
  formatShortDate,
} from './formatters';

function escapeCsvField(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTransactionsToCsv(
  transactions: FinancialTransaction[],
  accounts: FinancialAccount[],
  fileName: string
): void {
  const accountMap = new Map(accounts.map((acc) => [acc.id, acc]));

  const headers = [
    'Tanggal',
    'Sumber Dana',
    'Institusi',
    'Merchant / Pihak',
    'Keterangan',
    'Kategori',
    'Tipe',
    'Nominal',
    'Mata Uang',
    'Sumber Impor',
    'Referensi',
  ];

  const rows = transactions.map((tx) => {
    const acc = accountMap.get(tx.accountId);
    return [
      tx.date,
      acc?.name || 'Sumber Dana',
      acc?.institution || '-',
      tx.merchant,
      tx.description,
      tx.category,
      tx.txType === 'income' ? 'Pemasukan' : 'Pengeluaran',
      tx.amount,
      tx.currency,
      tx.source === 'adcb_api'
        ? 'ADCB API'
        : tx.source === 'pdf'
          ? 'Impor PDF'
          : 'Manual',
      tx.reference || '-',
    ].map(escapeCsvField);
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportReportToPdf(params: {
  transactions: FinancialTransaction[];
  accounts: FinancialAccount[];
  monthFilter: string;
  displayCurrency: DisplayCurrency;
  aedToIdrRate: number;
  fxRates?: Partial<Record<SupportedCurrency, number>>;
  userName: string;
  fileName: string;
  lang?: 'id' | 'en';
}): void {
  const {
    transactions,
    accounts,
    monthFilter,
    displayCurrency,
    aedToIdrRate,
    fxRates,
    userName,
    fileName,
    lang = 'id',
  } = params;

  const isEn = lang === 'en';
  const rateInput = fxRates ?? aedToIdrRate;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const accountMap = new Map(accounts.map((acc) => [acc.id, acc]));

  const totalIncome = transactions
    .filter((t) => t.txType === 'income')
    .reduce(
      (sum, t) => sum + convertCurrency(t.amount, t.currency, displayCurrency, rateInput),
      0
    );
  const totalExpense = transactions
    .filter((t) => t.txType === 'expense')
    .reduce(
      (sum, t) => sum + convertCurrency(t.amount, t.currency, displayCurrency, rateInput),
      0
    );
  const netFlow = totalIncome - totalExpense;
  const totalBalance = accounts.reduce(
    (sum, a) => sum + convertCurrency(a.balance, a.currency, displayCurrency, rateInput),
    0
  );

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text(
    isEn ? 'My Expenses — Personal Financial Report' : 'My Expenses — Laporan Keuangan Pribadi',
    14,
    18
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  const periodTitle =
    monthFilter === 'ALL'
      ? isEn
        ? 'All Periods'
        : 'Semua Periode'
      : formatMonthLabel(monthFilter);
  doc.text(
    isEn
      ? `Vault Owner: ${userName}  ·  Period: ${periodTitle}  ·  Report Currency: ${displayCurrency}`
      : `Pemilik Brankas: ${userName}  ·  Periode: ${periodTitle}  ·  Mata Uang Laporan: ${displayCurrency}`,
    14,
    24
  );
  doc.text(
    isEn
      ? `Decrypted locally (AES-256-GCM) on ${new Date().toLocaleString('en-US')}`
      : `Didekripsi secara lokal (AES-256-GCM) pada ${new Date().toLocaleString('id-ID')}`,
    14,
    29
  );

  doc.setDrawColor(226, 232, 240);
  doc.line(14, 33, 196, 33);

  // Summary Table
  autoTable(doc, {
    startY: 37,
    head: [
      [
        isEn ? 'Financial Summary' : 'Ringkasan Keuangan',
        (isEn ? 'Value (' : 'Nilai (') + displayCurrency + ')',
      ],
    ],
    body: [
      [
        isEn ? 'Total Balance (All Funding Sources)' : 'Total Saldo Seluruh Sumber Dana',
        formatMoney(totalBalance, displayCurrency),
      ],
      [
        isEn ? 'Total Period Income' : 'Total Pemasukan Periode Ini',
        formatMoney(totalIncome, displayCurrency),
      ],
      [
        isEn ? 'Total Period Expenses' : 'Total Pengeluaran Periode Ini',
        formatMoney(totalExpense, displayCurrency),
      ],
      [isEn ? 'Net Cash Flow' : 'Arus Kas Bersih', formatMoney(netFlow, displayCurrency)],
      [
        isEn ? 'Recorded Transactions' : 'Jumlah Transaksi Tercatat',
        String(transactions.length) + (isEn ? ' entries' : ' entri'),
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontSize: 9.5 },
    bodyStyles: { fontSize: 9, textColor: [15, 23, 42] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  });

  // Category Breakdown
  const categoryTotals = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.txType === 'expense') {
      const converted = convertCurrency(tx.amount, tx.currency, displayCurrency, rateInput);
      categoryTotals.set(tx.category, (categoryTotals.get(tx.category) || 0) + converted);
    }
  }
  const categoryRows = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => [
      cat,
      totalExpense > 0 ? `${((val / totalExpense) * 100).toFixed(1)}%` : '0%',
      formatMoney(val, displayCurrency),
    ]);

  const afterSummaryY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 80;

  if (categoryRows.length > 0) {
    autoTable(doc, {
      startY: afterSummaryY + 6,
      head: [
        [
          isEn ? 'Expense Breakdown by Category' : 'Distribusi Pengeluaran per Kategori',
          isEn ? 'Share' : 'Porsi',
          'Total (' + displayCurrency + ')',
        ],
      ],
      body: categoryRows,
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    });
  }

  const afterCatY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || afterSummaryY + 10;

  // Ledger table — Sumber Dana column uses the Funding Source name (acc.name)
  const ledgerRows = transactions.map((tx) => {
    const acc = accountMap.get(tx.accountId);
    const sign = tx.txType === 'income' ? '+' : '-';
    return [
      formatShortDate(tx.date),
      acc?.name || '-',
      tx.merchant,
      tx.category,
      `${sign} ${formatMoney(tx.amount, tx.currency)}`,
    ];
  });

  autoTable(doc, {
    startY: afterCatY + 6,
    head: [
      isEn
        ? ['Date', 'Funding Source', 'Merchant / Description', 'Category', 'Amount']
        : ['Tanggal', 'Sumber Dana', 'Merchant / Keterangan', 'Kategori', 'Nominal'],
    ],
    body:
      ledgerRows.length > 0
        ? ledgerRows
        : [
            [
              '-',
              '-',
              isEn ? 'No transactions in this period' : 'Tidak ada transaksi pada periode ini',
              '-',
              '-',
            ],
          ],
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      4: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
