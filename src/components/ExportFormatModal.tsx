import React from 'react';
import { Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import { useLanguage } from '../lib/i18n';

interface ExportFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordCount: number;
  currencyLabel: string;
  onExportPdf: () => void;
  onExportCsv: () => void;
}

export const ExportFormatModal: React.FC<ExportFormatModalProps> = ({
  isOpen,
  onClose,
  recordCount,
  currencyLabel,
  onExportPdf,
  onExportCsv,
}) => {
  const { tr } = useLanguage();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Download className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {tr('Pilih Format Ekspor', 'Choose Export Format')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Tutup popup ekspor', 'Close export modal')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {tr('Ingin mengekspor ', 'Export ')}
            <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
              {recordCount}
            </span>{' '}
            {tr(`transaksi (${currencyLabel}) dalam format PDF atau CSV?`, `transactions (${currencyLabel}) as PDF or CSV?`)}
          </p>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => {
                onExportPdf();
                onClose();
              }}
              className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/70 dark:bg-slate-950/50 hover:bg-teal-50/50 dark:hover:bg-teal-950/30 flex items-start gap-3.5 text-left transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {tr('Ekspor sebagai PDF (.pdf)', 'Export as PDF (.pdf)')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'Laporan keuangan rapi lengkap dengan ringkasan saldo, distribusi kategori, dan tabel mutasi siap cetak.',
                    'Formatted financial report with balance summary, category breakdown, and print-ready ledger table.'
                  )}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                onExportCsv();
                onClose();
              }}
              className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/70 dark:bg-slate-950/50 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 flex items-start gap-3.5 text-left transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {tr('Ekspor sebagai CSV (.csv)', 'Export as CSV (.csv)')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tr(
                    'Data tabel terstruktur yang siap dibuka dan diolah di Microsoft Excel atau Google Sheets.',
                    'Structured spreadsheet table ready for Microsoft Excel or Google Sheets.'
                  )}
                </p>
              </div>
            </button>
          </div>

          <div className="pt-1 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {tr('Batal', 'Cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
