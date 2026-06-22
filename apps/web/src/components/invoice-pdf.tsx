import React from 'react';
import {
  Document, Page, Text, View, Image, StyleSheet,
} from '@react-pdf/renderer';

const DARK  = '#3a3736';
const CORAL = '#C0392B';
const SAGE  = '#2A5A3D';

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#333333',
    paddingTop: 40,
    paddingHorizontal: 42,
    paddingBottom: 60, // reserve space for fixed footer bar
  },

  // ── Header ───────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  logo: { width: 165, height: 72 },
  titleBlock: { alignItems: 'flex-end' },
  invoiceTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 28,
    color: '#1a1a1a',
    textAlign: 'right',
    lineHeight: 1.1,
    letterSpacing: 1.5,
  },
  infoGrid: { marginTop: 8 },
  infoRow: { flexDirection: 'row', marginBottom: 2.5, justifyContent: 'flex-end' },
  infoLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textAlign: 'right',
    marginRight: 8,
    width: 66,
  },
  infoValue: { fontSize: 9, textAlign: 'right', width: 74 },

  // ── From / Bill To / Total row ────────────────────────────────────────────────
  addressRow: {
    flexDirection: 'row',
    marginBottom: 20,
    paddingTop: 14,
    borderTopWidth: 0.75,
    borderTopColor: '#cccccc',
    borderTopStyle: 'solid',
  },
  fromBlock: { flex: 1.1 },
  toBlock:   { flex: 1.2, paddingLeft: 20 },
  totalBlock:{ flex: 1.0, alignItems: 'flex-end' },
  blockLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: '#111111',
    marginBottom: 4,
  },
  blockLine:  { fontSize: 9, color: '#555555', lineHeight: 1.55 },
  totalDueLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#333333' },
  totalDueValue: { fontFamily: 'Helvetica-Bold', fontSize: 19, color: '#111111', marginTop: 3 },

  // ── Table ────────────────────────────────────────────────────────────────────
  tableHead: {
    flexDirection: 'row',
    backgroundColor: DARK,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  th: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 9 },

  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#dddddd',
    borderBottomStyle: 'solid',
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 22,
  },
  tableRowAlt: { backgroundColor: '#f8f8f8' },
  cell: { fontSize: 9, lineHeight: 1.45 },

  colDate:     { width: 72 },
  colDesc:     { flex: 1, paddingRight: 8 },
  colCharges:  { width: 66, textAlign: 'right' },
  colPayments: { width: 60, textAlign: 'right' },

  // ── Fixed page footer bar ────────────────────────────────────────────────────
  footerBar: {
    position: 'absolute',
    bottom: 20,
    left: 42,
    right: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: DARK,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  footerText: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 9 },

  // ── Payment section (last-page, in normal flow) ───────────────────────────────
  paySection: {
    flexDirection: 'row',
    marginTop: 22,
    alignItems: 'flex-start',
  },
  payBox: {
    flex: 1.5,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    padding: 12,
    marginRight: 16,
  },
  payBoxText: { fontSize: 9, lineHeight: 1.75, color: '#333333' },
  payRight:   { flex: 1, alignItems: 'flex-end' },
  payTotal:   { fontFamily: 'Helvetica-Bold', fontSize: 15, color: '#111111' },
  payBtn: {
    marginTop: 10,
    backgroundColor: DARK,
    borderRadius: 14,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  payBtnText: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 9 },

  // ── PAID watermark ────────────────────────────────────────────────────────────
  watermarkWrap: {
    position: 'absolute',
    top: 200,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  watermarkInner: { transform: 'rotate(-45deg)' },
  watermarkText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 110,
    color: CORAL,
    opacity: 0.18,
    letterSpacing: 12,
  },
});

export interface InvoicePDFData {
  number: string;
  status: string;
  total: number;
  issuedOn: string;
  dueDate: string;
  notes: string | null;
  family: {
    name: string;
    email: string | null;
    address?: string | null;
  } | null;
  lineItems: {
    id: string;
    description: string;
    amount: number;
    date?: string;
  }[];
}

export interface OrgPDFData {
  name: string;
  address?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  invoiceNotes?: string;
}

export function InvoicePDF({
  invoice,
  org,
  logoSrc,
}: {
  invoice: InvoicePDFData;
  org: OrgPDFData | null;
  logoSrc: string;
}) {
  const isPaid     = invoice.status === 'paid';
  const studioName = org?.name ?? 'Music & Life';

  const bankLines = [
    org?.bankAccountNumber ? `Please pay to:\n${studioName}` : '',
    org?.bankSortCode       ? `Sort code: ${org.bankSortCode}` : '',
    org?.bankAccountNumber  ? `Account no.: ${org.bankAccountNumber}` : '',
    org?.bankAccountName    ? org.bankAccountName : '',
    org?.invoiceNotes       ? `\n${org.invoiceNotes}` : '',
  ].filter(Boolean).join('\n');

  const hasPaymentSection = !!(org?.bankAccountNumber || org?.invoiceNotes);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* PAID watermark — repeats on every page */}
        {isPaid && (
          <View style={s.watermarkWrap} fixed>
            <View style={s.watermarkInner}>
              <Text style={s.watermarkText}>PAID</Text>
            </View>
          </View>
        )}

        {/* ── Header ── */}
        <View style={s.header}>
          {logoSrc
            ? <Image src={logoSrc} style={s.logo} />
            : <View style={s.logo} />
          }
          <View style={s.titleBlock}>
            <Text style={s.invoiceTitle}>{'MUSIC\nLESSONS'}</Text>
            <View style={s.infoGrid}>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Date:</Text>
                <Text style={s.infoValue}>{invoice.issuedOn}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Due Date:</Text>
                <Text style={s.infoValue}>{invoice.dueDate}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Invoice #:</Text>
                <Text style={s.infoValue}>{invoice.number}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── From / Bill To / Total ── */}
        <View style={s.addressRow}>
          <View style={s.fromBlock}>
            <Text style={s.blockLabel}>{studioName}</Text>
            {org?.address
              ? org.address.split(',').map((line, i) => (
                  <Text key={i} style={s.blockLine}>{line.trim()}</Text>
                ))
              : null}
          </View>
          <View style={s.toBlock}>
            <Text style={s.blockLabel}>Bill To:</Text>
            {invoice.family?.name  && <Text style={s.blockLine}>{invoice.family.name}</Text>}
            {invoice.family?.address && (
              invoice.family.address.split(',').map((line, i) => (
                <Text key={i} style={s.blockLine}>{line.trim()}</Text>
              ))
            )}
            {invoice.family?.email && <Text style={s.blockLine}>{invoice.family.email}</Text>}
          </View>
          <View style={s.totalBlock}>
            <Text style={s.totalDueLabel}>Total Due:</Text>
            <Text style={s.totalDueValue}>
              £{(invoice.total / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        {/* ── Table header ── */}
        <View style={s.tableHead}>
          <Text style={[s.th, s.colDate]}>Date</Text>
          <Text style={[s.th, s.colDesc]}>Description</Text>
          <Text style={[s.th, s.colCharges]}>Charges</Text>
          <Text style={[s.th, s.colPayments]}>Payments</Text>
        </View>

        {/* ── Line items ── */}
        {invoice.lineItems.map((item, i) => (
          <View key={item.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={[s.cell, s.colDate]}>{item.date ?? ''}</Text>
            <Text style={[s.cell, s.colDesc]}>{item.description}</Text>
            <Text style={[s.cell, s.colCharges]}>
              {item.amount !== 0
                ? (item.amount < 0 ? '-' : '') + '£' + (Math.abs(item.amount) / 100).toFixed(2)
                : ''}
            </Text>
            <Text style={[s.cell, s.colPayments]} />
          </View>
        ))}

        {/* ── Payment section (flows after last line item) ── */}
        {hasPaymentSection && (
          <View style={s.paySection}>
            <View style={s.payBox}>
              <Text style={s.payBoxText}>{bankLines}</Text>
            </View>
            <View style={s.payRight}>
              <Text style={s.payTotal}>
                Total Due: £{(invoice.total / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>
        )}

        {/* ── Footer bar — fixed, appears on every page ── */}
        <View style={s.footerBar} fixed>
          <Text style={s.footerText}>{studioName}</Text>
          <Text style={s.footerText}>Music Lessons</Text>
        </View>

      </Page>
    </Document>
  );
}
