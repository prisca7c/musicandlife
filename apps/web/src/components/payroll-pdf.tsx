import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatMoney } from '@/lib/money';

const SAGE = '#2A5A3D';
const DARK = '#3a3736';

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#333', paddingTop: 40, paddingHorizontal: 42, paddingBottom: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 0.75, borderBottomColor: '#ccc', borderBottomStyle: 'solid' },
  titleBlock: { alignItems: 'flex-end' },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: '#1a1a1a', letterSpacing: 1 },
  sub: { fontSize: 9, color: '#777', marginTop: 3 },
  infoRow: { flexDirection: 'row', marginBottom: 2, justifyContent: 'flex-end' },
  infoLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginRight: 8, width: 60, textAlign: 'right' },
  infoValue: { fontSize: 9, width: 80, textAlign: 'right' },
  staffBlock: { marginBottom: 20 },
  blockLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#111', marginBottom: 4 },
  blockLine: { fontSize: 9, color: '#555', lineHeight: 1.55 },
  tableHead: { flexDirection: 'row', backgroundColor: DARK, paddingVertical: 7, paddingHorizontal: 10 },
  th: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', borderBottomStyle: 'solid', paddingVertical: 6, paddingHorizontal: 10, minHeight: 20 },
  tableRowAlt: { backgroundColor: '#f8f8f8' },
  cell: { fontSize: 8.5, lineHeight: 1.4 },
  colDate: { width: 64 }, colStudent: { flex: 1 }, colInstrument: { width: 70 }, colType: { width: 80 }, colMins: { width: 40, textAlign: 'right' }, colAmount: { width: 56, textAlign: 'right' },
  totalsRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: '#333', borderTopStyle: 'solid', marginTop: 2, backgroundColor: '#f0f0f0' },
  totalLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, flex: 1 },
  totalValue: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  grossBox: { marginTop: 20, alignItems: 'flex-end' },
  grossLabel: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: SAGE },
  grossValue: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: '#111', marginTop: 2 },
  footer: { position: 'absolute', bottom: 20, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: DARK, paddingVertical: 7, paddingHorizontal: 10 },
  footerText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
});

export interface PayrollPDFData {
  staff: { name: string; hourlyRate: number };
  org: { name: string };
  period: { from: string; to: string };
  rows: { id: string; date: string; studentName: string; instrument: string; minutes: number; type: string; amount: number }[];
  totalMinutes: number;
  totalHours: number;
  gross: number;
}

export function PayrollPDF({ data }: { data: PayrollPDFData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.staffBlock}>
            <Text style={s.blockLabel}>{data.staff.name}</Text>
            <Text style={s.blockLine}>Rate: {formatMoney(data.staff.hourlyRate)}/hr</Text>
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>PAYROLL RECORD</Text>
            <Text style={s.sub}>{data.org.name}</Text>
            <View style={{ marginTop: 6 }}>
              <View style={s.infoRow}><Text style={s.infoLabel}>Period:</Text><Text style={s.infoValue}>{data.period.from}</Text></View>
              <View style={s.infoRow}><Text style={s.infoLabel}>to:</Text><Text style={s.infoValue}>{data.period.to}</Text></View>
            </View>
          </View>
        </View>

        <View style={s.tableHead}>
          <Text style={[s.th, s.colDate]}>Date</Text>
          <Text style={[s.th, s.colStudent]}>Student</Text>
          <Text style={[s.th, s.colInstrument]}>Instrument</Text>
          <Text style={[s.th, s.colType]}>Type</Text>
          <Text style={[s.th, s.colMins]}>Mins</Text>
          <Text style={[s.th, s.colAmount]}>Amount</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={r.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={[s.cell, s.colDate]}>{r.date}</Text>
            <Text style={[s.cell, s.colStudent]}>{r.studentName}</Text>
            <Text style={[s.cell, s.colInstrument, { textTransform: 'capitalize' }]}>{r.instrument}</Text>
            <Text style={[s.cell, s.colType]}>{r.type}</Text>
            <Text style={[s.cell, s.colMins]}>{r.minutes}</Text>
            <Text style={[s.cell, s.colAmount]}>{formatMoney(r.amount)}</Text>
          </View>
        ))}

        <View style={s.totalsRow}>
          <Text style={s.totalLabel}>Total: {data.totalHours} hrs ({data.totalMinutes} min)</Text>
          <Text style={s.totalValue}>{formatMoney(data.gross)}</Text>
        </View>

        <View style={s.grossBox}>
          <Text style={s.grossLabel}>Gross Pay</Text>
          <Text style={s.grossValue}>{formatMoney(data.gross)}</Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{data.org.name}</Text>
          <Text style={s.footerText}>Payroll Record · Confidential</Text>
        </View>
      </Page>
    </Document>
  );
}
