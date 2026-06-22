import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const SAGE = '#2A5A3D';
const DARK = '#3a3736';

const STATUS_COLOR: Record<string, string> = {
  completed: '#2A5A3D',
  cancelled_makeup: '#D97706',
  cancelled_no_makeup: '#C0392B',
  cancelled_no_pay: '#777',
  cancelled_teacher: '#777',
  scheduled: '#2563EB',
  makeup: '#2A5A3D',
};

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#333', paddingTop: 40, paddingHorizontal: 42, paddingBottom: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottomWidth: 0.75, borderBottomColor: '#ccc', borderBottomStyle: 'solid' },
  titleBlock: { alignItems: 'flex-end' },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: '#1a1a1a', letterSpacing: 1 },
  sub: { fontSize: 9, color: '#777', marginTop: 3 },
  infoRow: { flexDirection: 'row', marginBottom: 2, justifyContent: 'flex-end' },
  infoLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginRight: 8, width: 60, textAlign: 'right' },
  infoValue: { fontSize: 9, width: 90, textAlign: 'right' },
  summaryRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  summaryBox: { backgroundColor: '#f5f5f5', borderRadius: 4, padding: 10, alignItems: 'center', minWidth: 80 },
  summaryNum: { fontFamily: 'Helvetica-Bold', fontSize: 18, color: '#111' },
  summaryLabel: { fontSize: 8, color: '#777', marginTop: 2 },
  tableHead: { flexDirection: 'row', backgroundColor: DARK, paddingVertical: 7, paddingHorizontal: 10 },
  th: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ddd', borderBottomStyle: 'solid', paddingVertical: 6, paddingHorizontal: 10, minHeight: 20 },
  tableRowAlt: { backgroundColor: '#f8f8f8' },
  cell: { fontSize: 8.5, lineHeight: 1.4 },
  colDate: { width: 100 }, colTime: { width: 42 }, colInstrument: { width: 72 }, colTeacher: { width: 90 }, colMins: { width: 36, textAlign: 'right' }, colStatus: { flex: 1 },
  footer: { position: 'absolute', bottom: 20, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: DARK, paddingVertical: 7, paddingHorizontal: 10 },
  footerText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
});

export interface AttendancePDFData {
  student: { name: string; family: { name: string } | null };
  period: { from: string; to: string };
  rows: { id: string; date: string; time: string; teacher: string; instrument: string; duration: number; isTrial: boolean; status: string; attendanceLabel: string }[];
  summary: { present: number; total: number; attendanceRate: number | null };
}

export function AttendancePDF({ data }: { data: AttendancePDFData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#111' }}>{data.student.name}</Text>
            {data.student.family && <Text style={{ fontSize: 9, color: '#777', marginTop: 2 }}>{data.student.family.name}</Text>}
            <View style={s.summaryRow}>
              <View style={s.summaryBox}>
                <Text style={s.summaryNum}>{data.summary.present}</Text>
                <Text style={s.summaryLabel}>Attended</Text>
              </View>
              <View style={s.summaryBox}>
                <Text style={s.summaryNum}>{data.summary.total}</Text>
                <Text style={s.summaryLabel}>Total lessons</Text>
              </View>
              {data.summary.attendanceRate !== null && (
                <View style={[s.summaryBox, { backgroundColor: '#e8f5ee' }]}>
                  <Text style={[s.summaryNum, { color: SAGE }]}>{data.summary.attendanceRate}%</Text>
                  <Text style={[s.summaryLabel, { color: SAGE }]}>Attendance</Text>
                </View>
              )}
            </View>
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>ATTENDANCE</Text>
            <Text style={s.sub}>Student Record</Text>
            <View style={{ marginTop: 6 }}>
              <View style={s.infoRow}><Text style={s.infoLabel}>Period:</Text><Text style={s.infoValue}>{data.period.from}</Text></View>
              <View style={s.infoRow}><Text style={s.infoLabel}>to:</Text><Text style={s.infoValue}>{data.period.to}</Text></View>
            </View>
          </View>
        </View>

        <View style={s.tableHead}>
          <Text style={[s.th, s.colDate]}>Date</Text>
          <Text style={[s.th, s.colTime]}>Time</Text>
          <Text style={[s.th, s.colInstrument]}>Subject</Text>
          <Text style={[s.th, s.colTeacher]}>Teacher</Text>
          <Text style={[s.th, s.colMins]}>Min</Text>
          <Text style={[s.th, s.colStatus]}>Status</Text>
        </View>

        {data.rows.map((r, i) => (
          <View key={r.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={[s.cell, s.colDate]}>{r.date}{r.isTrial ? ' (trial)' : ''}</Text>
            <Text style={[s.cell, s.colTime]}>{r.time}</Text>
            <Text style={[s.cell, s.colInstrument, { textTransform: 'capitalize' }]}>{r.instrument}</Text>
            <Text style={[s.cell, s.colTeacher]}>{r.teacher}</Text>
            <Text style={[s.cell, s.colMins]}>{r.duration}</Text>
            <Text style={[s.cell, s.colStatus, { color: STATUS_COLOR[r.status] ?? '#333' }]}>
              {r.attendanceLabel}
            </Text>
          </View>
        ))}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{data.student.name} · Attendance Record</Text>
          <Text style={s.footerText}>Generated {new Date().toLocaleDateString('en-GB')}</Text>
        </View>
      </Page>
    </Document>
  );
}
