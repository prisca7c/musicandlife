'use client';

import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { InvoicePDF, type InvoicePDFData, type OrgPDFData } from './invoice-pdf';

interface Props {
  invoice: InvoicePDFData;
  org: OrgPDFData | null;
  logoSrc: string;
}

export function PdfDownloadButton({ invoice, org, logoSrc }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (!logoSrc) return;
    setLoading(true);
    try {
      const blob = await pdf(
        <InvoicePDF invoice={invoice} org={org} logoSrc={logoSrc} />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `invoice-${invoice.number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading || !logoSrc}
      className="ui-btn-ghost text-sm"
    >
      {loading ? 'Generating…' : '↓ Download PDF'}
    </button>
  );
}
