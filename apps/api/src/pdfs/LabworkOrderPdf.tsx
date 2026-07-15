import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { LabworkOrderData } from '../services/pdf.service.js'
import { t, formatDate as formatDateI18n, formatTime as formatTimeI18n, type Language } from '@dental/shared'

const styles = StyleSheet.create({
  page: { flexDirection: 'column', backgroundColor: '#ffffff', padding: 40, fontFamily: 'Helvetica' },
  header: { marginBottom: 24, borderBottomWidth: 2, borderBottomColor: '#0066cc', paddingBottom: 16 },
  clinicName: { fontSize: 22, fontWeight: 'bold', color: '#0066cc', marginBottom: 6 },
  clinicInfo: { fontSize: 10, color: '#666666', marginBottom: 2 },
  title: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 16, color: '#333333' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#0066cc', marginBottom: 6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', marginBottom: 4 },
  label: { fontSize: 10, color: '#666666', width: 140 },
  value: { fontSize: 10, color: '#333333', flex: 1 },
  notesBox: { backgroundColor: '#f5f5f5', padding: 10, borderRadius: 4, marginTop: 4, fontSize: 10, color: '#333333' },
  statusRow: { flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingTop: 12 },
  statusBadge: { fontSize: 10, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 4, marginRight: 10 },
  statusPositive: { backgroundColor: '#dcfce7', color: '#166534' },
  statusNegative: { backgroundColor: '#fef3c7', color: '#92400e' },
  footer: { position: 'absolute', bottom: 40, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingTop: 12 },
  footerText: { fontSize: 8, color: '#999999', textAlign: 'center' },
})

interface LabworkOrderPdfProps {
  data: LabworkOrderData
}

export function LabworkOrderPdf({ data }: LabworkOrderPdfProps) {
  const { tenant, patient, doctors, labwork, generatedAt } = data
  const timezone = tenant.timezone || 'UTC'
  const language = (tenant.language || 'es') as Language
  const doctorNames = doctors.map((d) => `${d.firstName} ${d.lastName}`).join(', ')

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinicName}>{tenant.name}</Text>
          {tenant.address && <Text style={styles.clinicInfo}>{tenant.address}</Text>}
          {tenant.phone && (
            <Text style={styles.clinicInfo}>
              {t(language, 'pdf.common.phone')}: {tenant.phone}
            </Text>
          )}
        </View>

        <Text style={styles.title}>{t(language, 'pdf.labwork.title')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(language, 'pdf.labwork.orderDetails')}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.labwork.labName')}:</Text>
            <Text style={styles.value}>{labwork.lab}</Text>
          </View>
          {labwork.phoneNumber && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.common.phone')}:</Text>
              <Text style={styles.value}>{labwork.phoneNumber}</Text>
            </View>
          )}
          {patient && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.labwork.patient')}:</Text>
              <Text style={styles.value}>
                {patient.firstName} {patient.lastName}
              </Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.appointment.date')}:</Text>
            <Text style={styles.value}>{formatDateI18n(labwork.date, language, timezone)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.labwork.assignedDoctors')}:</Text>
            <Text style={styles.value}>{doctorNames}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.labwork.price')}:</Text>
            <Text style={styles.value}>
              {tenant.currency} {labwork.price}
            </Text>
          </View>
        </View>

        {labwork.note && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t(language, 'pdf.labwork.notes')}</Text>
            <Text style={styles.notesBox}>{labwork.note}</Text>
          </View>
        )}

        <View style={styles.statusRow}>
          <Text style={[styles.statusBadge, labwork.isPaid ? styles.statusPositive : styles.statusNegative]}>
            {labwork.isPaid ? t(language, 'pdf.appointment.paid') : t(language, 'pdf.appointment.pending')}
          </Text>
          <Text style={[styles.statusBadge, labwork.isDelivered ? styles.statusPositive : styles.statusNegative]}>
            {labwork.isDelivered ? t(language, 'pdf.labwork.delivered') : t(language, 'pdf.labwork.pendingDelivery')}
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t(language, 'pdf.common.generatedOn')} {formatDateI18n(generatedAt, language, timezone)}{' '}
            {t(language, 'pdf.common.at')} {formatTimeI18n(generatedAt, language, timezone)}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
