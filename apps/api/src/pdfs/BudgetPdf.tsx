import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { BudgetPdfData, BudgetItemStatus } from '../services/pdf.service.js'
import { t, formatDate as formatDateI18n, type Language } from '@dental/shared'

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
  notesBox: {
    backgroundColor: '#f5f5f5',
    padding: 10,
    borderRadius: 4,
    marginTop: 4,
  },
  notesText: {
    fontSize: 9,
    color: '#333333',
    lineHeight: 1.4,
  },
  // Items table styles
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
  colItem: {
    width: '6%',
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
    width: '16%',
    fontSize: 8,
    textAlign: 'right',
  },
  colLineTotal: {
    width: '16%',
    fontSize: 8,
    textAlign: 'right',
  },
  colStatus: {
    width: '14%',
    fontSize: 8,
  },
  headerText: {
    fontWeight: 'bold',
    color: '#333333',
    fontSize: 8,
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
  statusApproved: {
    backgroundColor: '#dbeafe',
    color: '#1e40af',
  },
  statusPartial: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  statusCancelled: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  statusDraft: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
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

function getStatusStyle(status: BudgetItemStatus | 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED') {
  switch (status) {
    case 'EXECUTED':
    case 'COMPLETED':
      return styles.statusCompleted
    case 'APPROVED':
    case 'SCHEDULED':
    case 'IN_PROGRESS':
      return styles.statusApproved
    case 'PARTIAL':
      return styles.statusPartial
    case 'CANCELLED':
      return styles.statusCancelled
    default:
      return styles.statusDraft
  }
}

interface BudgetPdfProps {
  data: BudgetPdfData
}

export function BudgetPdf({ data }: BudgetPdfProps) {
  const { tenant, patient, budget, generatedAt } = data
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
        <Text style={styles.title}>{t(language, 'pdf.budget.title')}</Text>

        {/* Budget Information */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.budget.budgetFor')}:</Text>
            <Text style={styles.value}>
              {patient.firstName} {patient.lastName}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.budget.createdOn')}:</Text>
            <Text style={styles.value}>{formatDateI18n(budget.createdAt, language, timezone)}</Text>
          </View>
          {budget.validUntil && (
            <View style={styles.row}>
              <Text style={styles.label}>{t(language, 'pdf.budget.validUntil')}:</Text>
              <Text style={styles.value}>{formatDateI18n(budget.validUntil, language, timezone)}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>{t(language, 'pdf.budget.table.status')}:</Text>
            <Text style={[styles.value, styles.statusBadge, getStatusStyle(budget.status)]}>
              {t(language, `pdf.budget.status.${budget.status}`)}
            </Text>
          </View>
        </View>

        {/* Items table */}
        <View style={styles.section}>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.colItem, styles.headerText]}>{t(language, 'pdf.budget.table.item')}</Text>
              <Text style={[styles.colDescription, styles.headerText]}>
                {t(language, 'pdf.budget.table.description')}
              </Text>
              <Text style={[styles.colTooth, styles.headerText]}>{t(language, 'pdf.budget.table.tooth')}</Text>
              <Text style={[styles.colQty, styles.headerText]}>{t(language, 'pdf.budget.table.qty')}</Text>
              <Text style={[styles.colUnitPrice, styles.headerText]}>
                {t(language, 'pdf.budget.table.unitPrice')}
              </Text>
              <Text style={[styles.colLineTotal, styles.headerText]}>
                {t(language, 'pdf.budget.table.lineTotal')}
              </Text>
              <Text style={[styles.colStatus, styles.headerText]}>{t(language, 'pdf.budget.table.status')}</Text>
            </View>
            {budget.items.map((item, index) => (
              <View
                key={item.id}
                style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
              >
                <Text style={styles.colItem}>{index + 1}</Text>
                <Text style={styles.colDescription}>{item.description}</Text>
                <Text style={styles.colTooth}>{item.toothNumber || '-'}</Text>
                <Text style={styles.colQty}>{item.quantity}</Text>
                <Text style={styles.colUnitPrice}>
                  {tenant.currency} {item.unitPrice}
                </Text>
                <Text style={styles.colLineTotal}>
                  {tenant.currency} {item.totalPrice}
                </Text>
                <View style={styles.colStatus}>
                  <Text style={[styles.statusBadge, getStatusStyle(item.status)]}>
                    {t(language, `pdf.budget.itemStatus.${item.status}`)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Total */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t(language, 'pdf.budget.total')}:</Text>
            <Text style={styles.totalValue}>
              {tenant.currency} {budget.totalAmount}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {budget.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t(language, 'pdf.budget.notes')}</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{budget.notes}</Text>
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t(language, 'pdf.common.generatedOn')} {formatDateI18n(generatedAt, language, timezone)}
          </Text>
          <Text style={styles.footerText}>{t(language, 'pdf.budget.footer')}</Text>
        </View>
      </Page>
    </Document>
  )
}
