import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { PatientHistoryData, AppointmentStatus } from '../services/pdf.service.js'
import {
  t,
  formatDate as formatDateI18n,
  formatCalendarDay as formatCalendarDayI18n,
  formatDateTime as formatDateTimeI18n,
  translateStatus,
  translateGender,
  type Language,
} from '@dental/shared'

// Create styles
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 40,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 25,
    borderBottomWidth: 2,
    borderBottomColor: '#0066cc',
    paddingBottom: 15,
  },
  clinicName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: 6,
  },
  clinicInfo: {
    fontSize: 9,
    color: '#666666',
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333333',
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: 8,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  label: {
    fontSize: 9,
    color: '#666666',
    width: 100,
  },
  value: {
    fontSize: 9,
    color: '#333333',
    flex: 1,
  },
  // Dental Chart styles
  teethGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  toothItem: {
    width: '23%',
    backgroundColor: '#f5f5f5',
    padding: 6,
    borderRadius: 4,
    marginBottom: 4,
  },
  toothNumber: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0066cc',
    marginBottom: 2,
  },
  toothNote: {
    fontSize: 8,
    color: '#333333',
  },
  // Appointment table styles
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableRowAlt: {
    backgroundColor: '#fafafa',
  },
  colDate: {
    width: '15%',
    fontSize: 8,
  },
  colType: {
    width: '18%',
    fontSize: 8,
  },
  colDoctor: {
    width: '20%',
    fontSize: 8,
  },
  colStatus: {
    width: '12%',
    fontSize: 8,
  },
  colCost: {
    width: '12%',
    fontSize: 8,
    textAlign: 'right',
  },
  colNotes: {
    width: '23%',
    fontSize: 8,
  },
  headerText: {
    fontWeight: 'bold',
    color: '#333333',
    fontSize: 8,
  },
  noData: {
    fontSize: 10,
    color: '#999999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 7,
    color: '#999999',
    textAlign: 'center',
  },
  pageNumber: {
    fontSize: 8,
    color: '#999999',
    textAlign: 'right',
  },
  statusBadge: {
    fontSize: 7,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  statusCompleted: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  statusScheduled: {
    backgroundColor: '#dbeafe',
    color: '#1e40af',
  },
  statusCancelled: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  statusDefault: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
  },
})

function getStatusStyle(status: AppointmentStatus) {
  switch (status) {
    case 'COMPLETED':
      return styles.statusCompleted
    case 'SCHEDULED':
    case 'CONFIRMED':
      return styles.statusScheduled
    case 'CANCELLED':
    case 'NO_SHOW':
      return styles.statusCancelled
    default:
      return styles.statusDefault
  }
}

export function calculateAge(dob: Date, timezone: string): number {
  // dob is a calendar day (UTC midnight); "today" is the tenant's day, not the host's.
  const [ty, tm, td] = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number)
  let age = ty - dob.getUTCFullYear()
  const monthDiff = tm - (dob.getUTCMonth() + 1)
  if (monthDiff < 0 || (monthDiff === 0 && td < dob.getUTCDate())) {
    age--
  }
  return age
}

interface PatientHistoryPdfProps {
  data: PatientHistoryData
}

export function PatientHistoryPdf({ data }: PatientHistoryPdfProps) {
  const { tenant, patient, appointments, teethNotes, generatedAt } = data
  const timezone = tenant.timezone || 'UTC'
  const language = (tenant.language || 'es') as Language

  // Sort teeth notes by tooth number
  const sortedTeeth = teethNotes
    ? Object.entries(teethNotes).sort(([a], [b]) => {
        const numA = parseInt(a, 10)
        const numB = parseInt(b, 10)
        return numA - numB
      })
    : []

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header - Clinic Info */}
        <View style={styles.header}>
          <Text style={styles.clinicName}>{tenant.name}</Text>
          {tenant.address && <Text style={styles.clinicInfo}>{tenant.address}</Text>}
          {tenant.phone && <Text style={styles.clinicInfo}>Tel: {tenant.phone}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>{t(language, 'pdf.patient.title')}</Text>

        {/* Patient Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t(language, 'pdf.patient.information')}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.patient.fullName')}:</Text>
            <Text style={styles.value}>
              {patient.firstName} {patient.lastName}
            </Text>
          </View>
          {patient.dob && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>{t(language, 'pdf.patient.dateOfBirth')}:</Text>
                <Text style={styles.value}>{formatCalendarDayI18n(patient.dob, language)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>{t(language, 'pdf.patient.age')}:</Text>
                <Text style={styles.value}>
                  {calculateAge(patient.dob, timezone)} {t(language, 'pdf.patient.years')}
                </Text>
              </View>
            </>
          )}
          {patient.gender && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.patient.gender')}:</Text>
              <Text style={styles.value}>{translateGender(patient.gender, language)}</Text>
            </View>
          )}
          {patient.phone && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.patient.phone')}:</Text>
              <Text style={styles.value}>{patient.phone}</Text>
            </View>
          )}
          {patient.email && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.patient.email')}:</Text>
              <Text style={styles.value}>{patient.email}</Text>
            </View>
          )}
          {patient.address && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.patient.address')}:</Text>
              <Text style={styles.value}>{patient.address}</Text>
            </View>
          )}
        </View>

        {/* Dental Chart Summary */}
        {sortedTeeth.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t(language, 'pdf.patient.dentalChartNotes')}</Text>
            <View style={styles.teethGrid}>
              {sortedTeeth.map(([toothNum, note]) => (
                <View key={toothNum} style={styles.toothItem}>
                  <Text style={styles.toothNumber}>#{toothNum}</Text>
                  <Text style={styles.toothNote}>{note}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Appointment History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t(language, 'pdf.patient.appointmentHistory')} ({appointments.length}{' '}
            {t(language, 'pdf.patient.records')})
          </Text>
          {appointments.length === 0 ? (
            <Text style={styles.noData}>{t(language, 'pdf.patient.noAppointments')}</Text>
          ) : (
            <View style={styles.table}>
              {/* Table Header */}
              <View style={styles.tableHeader}>
                <Text style={[styles.colDate, styles.headerText]}>{t(language, 'pdf.table.date')}</Text>
                <Text style={[styles.colType, styles.headerText]}>{t(language, 'pdf.table.type')}</Text>
                <Text style={[styles.colDoctor, styles.headerText]}>{t(language, 'pdf.table.doctor')}</Text>
                <Text style={[styles.colStatus, styles.headerText]}>{t(language, 'pdf.table.status')}</Text>
                <Text style={[styles.colCost, styles.headerText]}>{t(language, 'pdf.table.cost')}</Text>
                <Text style={[styles.colNotes, styles.headerText]}>{t(language, 'pdf.table.notes')}</Text>
              </View>
              {/* Table Rows */}
              {appointments.slice(0, 25).map((apt, index) => (
                <View
                  key={apt.id}
                  style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
                >
                  <Text style={styles.colDate}>
                    {formatDateI18n(apt.date, language, timezone, 'short')}
                  </Text>
                  <Text style={styles.colType}>{apt.type || '-'}</Text>
                  <Text style={styles.colDoctor}>{apt.doctorName}</Text>
                  <View style={styles.colStatus}>
                    <Text style={[styles.statusBadge, getStatusStyle(apt.status)]}>
                      {translateStatus(apt.status, language)}
                    </Text>
                  </View>
                  <Text style={styles.colCost}>
                    {apt.cost ? `${tenant.currency} ${apt.cost}` : '-'}
                  </Text>
                  <Text style={styles.colNotes}>
                    {apt.notes ? apt.notes.substring(0, 50) + (apt.notes.length > 50 ? '...' : '') : '-'}
                  </Text>
                </View>
              ))}
              {appointments.length > 25 && (
                <Text style={styles.noData}>
                  {t(language, 'pdf.table.andMore', { count: appointments.length - 25 })}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t(language, 'pdf.common.generatedOn')} {formatDateTimeI18n(generatedAt, language, timezone)} |{' '}
            {tenant.name}
          </Text>
          <Text style={styles.footerText}>{t(language, 'pdf.patient.confidentialNotice')}</Text>
        </View>
      </Page>
    </Document>
  )
}
