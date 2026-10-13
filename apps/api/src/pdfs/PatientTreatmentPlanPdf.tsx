import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { PatientTreatmentPlanData } from '../services/pdf.service.js'
import { t, formatDate as formatDateI18n, type Language } from '@dental/shared'

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
  colIndex: {
    width: '6%',
    fontSize: 8,
  },
  colDate: {
    width: '16%',
    fontSize: 8,
  },
  colDescription: {
    width: '30%',
    fontSize: 8,
  },
  colTooth: {
    width: '10%',
    fontSize: 8,
  },
  colQty: {
    width: '8%',
    fontSize: 8,
    textAlign: 'right',
  },
  colUnitPrice: {
    width: '15%',
    fontSize: 8,
    textAlign: 'right',
  },
  colLineTotal: {
    width: '15%',
    fontSize: 8,
    textAlign: 'right',
  },
  headerText: {
    fontWeight: 'bold',
    color: '#333333',
    fontSize: 8,
  },
  emptyText: {
    fontSize: 9,
    color: '#666666',
    marginTop: 8,
  },
  totalSection: {
    marginTop: 16,
    alignItems: 'flex-end',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333333',
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0066cc',
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
})

interface PatientTreatmentPlanPdfProps {
  data: PatientTreatmentPlanData
}

/**
 * The patient's whole planned treatment as one document: one row per budget
 * item, across every budget, with a single grand total. One flat table on
 * purpose — the clinic enters one item per budget, so per-budget sub-sections
 * would print nine headings whose subtotal equals their only line.
 */
export function PatientTreatmentPlanPdf({ data }: PatientTreatmentPlanPdfProps) {
  const { tenant, patient, items, totalAmount, generatedAt } = data
  const timezone = tenant.timezone || 'UTC'
  const language = (tenant.language || 'es') as Language

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header - Clinic Info */}
        <View style={styles.header}>
          <Text style={styles.clinicName}>{tenant.name}</Text>
          {tenant.address && <Text style={styles.clinicInfo}>{tenant.address}</Text>}
          {tenant.phone && (
            <Text style={styles.clinicInfo}>
              {t(language, 'pdf.common.phone')}: {tenant.phone}
            </Text>
          )}
          {tenant.email && <Text style={styles.clinicInfo}>{tenant.email}</Text>}
        </View>

        {/* Title */}
        <Text style={styles.title}>{t(language, 'pdf.treatmentPlan.title')}</Text>

        {/* Patient */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.treatmentPlan.planFor')}:</Text>
            <Text style={styles.value}>
              {patient.firstName} {patient.lastName}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.treatmentPlan.itemsCount')}:</Text>
            <Text style={styles.value}>{items.length}</Text>
          </View>
        </View>

        {/* Items table */}
        <View style={styles.section}>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>{t(language, 'pdf.treatmentPlan.noItems')}</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.colIndex, styles.headerText]}>
                  {t(language, 'pdf.budget.table.item')}
                </Text>
                <Text style={[styles.colDate, styles.headerText]}>{t(language, 'pdf.table.date')}</Text>
                <Text style={[styles.colDescription, styles.headerText]}>
                  {t(language, 'pdf.budget.table.description')}
                </Text>
                <Text style={[styles.colTooth, styles.headerText]}>
                  {t(language, 'pdf.budget.table.tooth')}
                </Text>
                <Text style={[styles.colQty, styles.headerText]}>
                  {t(language, 'pdf.budget.table.qty')}
                </Text>
                <Text style={[styles.colUnitPrice, styles.headerText]}>
                  {t(language, 'pdf.budget.table.unitPrice')}
                </Text>
                <Text style={[styles.colLineTotal, styles.headerText]}>
                  {t(language, 'pdf.budget.table.lineTotal')}
                </Text>
              </View>
              {items.map((item, index) => (
                <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}>
                  <Text style={styles.colIndex}>{index + 1}</Text>
                  <Text style={styles.colDate}>
                    {formatDateI18n(item.budgetDate, language, timezone, 'short')}
                  </Text>
                  <Text style={styles.colDescription}>{item.description}</Text>
                  <Text style={styles.colTooth}>{item.toothNumber || '-'}</Text>
                  <Text style={styles.colQty}>{item.quantity}</Text>
                  <Text style={styles.colUnitPrice}>
                    {tenant.currency} {item.unitPrice}
                  </Text>
                  <Text style={styles.colLineTotal}>
                    {tenant.currency} {item.totalPrice}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Total */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(language, 'pdf.treatmentPlan.total')}:</Text>
            <Text style={styles.totalValue}>
              {tenant.currency} {totalAmount}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t(language, 'pdf.common.generatedOn')} {formatDateI18n(generatedAt, language, timezone)}
          </Text>
          <Text style={styles.footerText}>{t(language, 'pdf.treatmentPlan.footer')}</Text>
        </View>
      </Page>
    </Document>
  )
}
