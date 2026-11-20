import { describe, expect, it } from 'vitest';
import { parseCsvStatementFile } from '../lib/csvStatementParser';

function makeCsvFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('CSV / TSV Statement Parser (Value Date Priority)', () => {
  it('strictly prioritizes Value Date over Posting Date for ADCB multi-column CSV', async () => {
    const csv = [
      'Account Number,AE1234567890123456',
      'Posting Date,Value Date,Description,Reference,Debit,Credit,Balance',
      '2026-11-03,2026-11-01,IKEA YAS MALL ABU DHABI,REF1001,450.00,,12500.00',
      '2026-11-06,2026-11-05,MONTHLY SALARY PAYROLL,REF1002,,18500.00,31000.00',
    ].join('\n');

    const result = await parseCsvStatementFile(makeCsvFile('adcb-november.csv', csv));

    expect(result.bankName).toBe('ADCB Bank');
    expect(result.currency).toBe('AED');
    expect(result.detectedDateColumn).toBe('Value Date');
    expect(result.closingBalance).toBe(31000);
    expect(result.transactions).toHaveLength(2);

    expect(result.transactions[0]).toMatchObject({
      date: '2026-11-01',
      postingDate: '2026-11-03',
      dateSource: 'value_date',
      amount: 450,
      type: 'expense',
      category: 'Barang Rumah Tangga',
    });

    expect(result.transactions[1]).toMatchObject({
      date: '2026-11-05',
      postingDate: '2026-11-06',
      dateSource: 'value_date',
      amount: 18500,
      type: 'income',
      category: 'Gaji',
    });
  });

  it('parses semicolon-delimited Indonesian IDR statements with comma decimals', async () => {
    const csv = [
      'Bank BCA;Mutasi Rekening',
      'Tanggal Valuta;Keterangan;Nominal;DR/CR',
      '10/11/2026;STARBUCKS GRAND INDONESIA;75.500,00;DR',
      '12/11/2026;TRANSFER MASUK KLIEN;2.500.000,00;CR',
    ].join('\n');

    const result = await parseCsvStatementFile(makeCsvFile('mutasi-bca.csv', csv));
    expect(result.bankName).toBe('Bank BCA');
    expect(result.currency).toBe('IDR');
    expect(result.transactions).toHaveLength(2);

    expect(result.transactions[0]).toMatchObject({
      date: '2026-11-10',
      amount: 75500,
      type: 'expense',
      category: 'Makan & Minum',
    });

    expect(result.transactions[1]).toMatchObject({
      date: '2026-11-12',
      amount: 2500000,
      type: 'income',
    });
  });

  it('throws a clear Indonesian error when required date/amount headers are missing', async () => {
    const badCsv = 'KolomA,KolomB\nFoo,Bar';
    await expect(parseCsvStatementFile(makeCsvFile('invalid.csv', badCsv))).rejects.toThrow(
      /Header kolom/i
    );
  });
});
