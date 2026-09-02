/**
 * i18n key-parity check for task #332 (i18n migration: Dashboard).
 * Verifies every `dashboard.*` key added by this migration (DashboardPage,
 * StatCard) exists with a non-empty value in all three shipped locale files
 * (es/en/ar), that the es value reproduces the original hardcoded Spanish
 * copy it replaced, that genuine prose keys have a distinct translation per
 * locale, and that interpolated keys carry their placeholder token in all
 * three locales (so interpolation is real, not string concatenation).
 *
 * Unlike task-331's `settings.*` (which has a pre-existing, out-of-scope
 * orphan), the whole `dashboard.*` tree is already symmetric across
 * es/en/ar before this migration, so a full identical-leaf-key check under
 * `dashboard.*` is safe here — it will not trip on an unrelated pre-existing
 * gap. Follows the pattern established by task-325-doctors-keys.test.ts
 * (#325), task-326-labworks-expenses-keys.test.ts (#326), and
 * task-331-settings-layout-keys.test.ts (#331).
 */
import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'
import ar from './locales/ar.json'

const locales = { es, en, ar } as const

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in acc) {
      return (acc as Record<string, unknown>)[segment]
    }
    return undefined
  }, obj)
}

// Recursively collect every leaf (non-object) key path under a node, e.g.
// { form: { validation: { x: '...' } } } -> ['form.validation.x'].
function collectLeafPaths(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      collectLeafPaths(value, prefix ? `${prefix}.${key}` : key)
    )
  }
  return [prefix]
}

// Every dashboard.* key added by the #332 migration (DashboardPage,
// StatCard), per the implementer's diff to locales/*.json.
// `dashboard.title` pre-dates this task (already migrated) and is
// intentionally excluded.
const DASHBOARD_NEW_KEYS = [
  'welcomeUser',
  'trendVsLastMonth',
  'appointmentStatusTitle',
  'statCards.activePatients',
  'statCards.doctors',
  'statCards.appointmentsThisMonth',
  'statCards.completedCount',
  'statCards.monthlyRevenue',
  'statCards.pendingAmount',
  'statCards.pendingLabworks',
  'statCards.unpaidCount',
  'statCards.totalAppointments',
  'statCards.totalAppointmentsSubtitle',
  'statCards.newPatients',
  'statCards.lastMonthCount',
  'charts.appointmentsByDay',
  'charts.noAppointmentData',
  'charts.revenueByMonth',
  'charts.noRevenueData',
  'charts.revenueTooltipLabel',
  'doctorPerformance.title',
  'doctorPerformance.doctor',
  'doctorPerformance.appointments',
  'doctorPerformance.completed',
  'doctorPerformance.rate',
  'doctorPerformance.revenue',
] as const

// Expected es value for every key above — the exact Spanish copy the
// implementer moved out of DashboardPage.tsx and into es.json. Pins the
// migration down to a literal string, not just "some non-empty value".
const EXPECTED_ES_VALUES: Record<(typeof DASHBOARD_NEW_KEYS)[number], string> = {
  welcomeUser: 'Bienvenido, {{name}}. Aquí está el resumen de tu clínica.',
  trendVsLastMonth: 'vs mes anterior',
  appointmentStatusTitle: 'Estado de Citas (Este Mes)',
  'statCards.activePatients': 'Pacientes Activos',
  'statCards.doctors': 'Doctores',
  'statCards.appointmentsThisMonth': 'Citas del Mes',
  'statCards.completedCount': '{{count}} completadas',
  'statCards.monthlyRevenue': 'Ingresos del Mes',
  // Retexted by #396: the figure is now the net outstanding across all
  // patient-billable work, so the copy names that basis instead of the bare
  // "pendientes" the #332 migration moved over.
  'statCards.pendingAmount': '{{amount}} por cobrar a pacientes',
  'statCards.pendingLabworks': 'Labworks Pendientes',
  'statCards.unpaidCount': '{{count}} sin pagar',
  'statCards.totalAppointments': 'Total de Citas',
  'statCards.totalAppointmentsSubtitle': 'Histórico completo',
  'statCards.newPatients': 'Nuevos Pacientes (Mes)',
  'statCards.lastMonthCount': '{{count}} el mes pasado',
  'charts.appointmentsByDay': 'Citas por Día (Últimos 14 días)',
  'charts.noAppointmentData': 'No hay datos de citas para mostrar',
  'charts.revenueByMonth': 'Ingresos por Mes',
  'charts.noRevenueData': 'No hay datos de ingresos para mostrar',
  'charts.revenueTooltipLabel': 'Ingresos',
  'doctorPerformance.title': 'Rendimiento de Doctores (Este Mes)',
  'doctorPerformance.doctor': 'Doctor',
  'doctorPerformance.appointments': 'Citas',
  'doctorPerformance.completed': 'Completadas',
  'doctorPerformance.rate': 'Tasa',
  'doctorPerformance.revenue': 'Ingresos',
}

// Keys that carry an i18next interpolation placeholder, and the exact token
// each one must contain in every locale (so the placeholder itself — not
// just surrounding prose — survived translation).
const INTERPOLATED_KEYS: Partial<Record<(typeof DASHBOARD_NEW_KEYS)[number], string>> = {
  welcomeUser: '{{name}}',
  'statCards.completedCount': '{{count}}',
  'statCards.pendingAmount': '{{amount}}',
  'statCards.unpaidCount': '{{count}}',
  'statCards.lastMonthCount': '{{count}}',
}

// Subset of DASHBOARD_NEW_KEYS that are genuine translated prose — expected
// to have a distinct string per locale. Excludes:
// - doctorPerformance.doctor: "Doctor" is a Spanish/English cognate (both
//   locales literally use "Doctor"); ar is distinct ("الطبيب"). Not a
//   copy-paste miss — same rationale as labworks.stats.total in #326.
// - charts.revenueTooltipLabel / doctorPerformance.revenue: both literally
//   "Ingresos" in es, but distinct in en ("Revenue") and ar; the check below
//   is per-key (across locales), so this repeat between two *different* keys
//   does not affect either key's own es/en/ar distinctness.
const DASHBOARD_DISTINCT_PER_LOCALE_KEYS = DASHBOARD_NEW_KEYS.filter(
  (key) => key !== 'doctorPerformance.doctor'
)

describe('task #332 i18n key parity — dashboard.* (new keys only)', () => {
  describe.each(DASHBOARD_NEW_KEYS)('key "dashboard.%s"', (key) => {
    it('exists as a non-empty string in es, en, and ar', () => {
      for (const [code, dict] of Object.entries(locales)) {
        const value = getByPath((dict as { dashboard: unknown }).dashboard, key)
        expect(value, `${code}.json dashboard.${key} is missing`).toBeTypeOf('string')
        expect(
          (value as string).length,
          `${code}.json dashboard.${key} has an empty value`
        ).toBeGreaterThan(0)
      }
    })

    it('has the expected es value (reproduces the original Spanish source copy)', () => {
      const value = getByPath((es as { dashboard: unknown }).dashboard, key)
      expect(value, `es.json dashboard.${key}`).toBe(EXPECTED_ES_VALUES[key])
    })
  })

  describe.each(DASHBOARD_DISTINCT_PER_LOCALE_KEYS)('key "dashboard.%s" (translatable prose)', (key) => {
    it('has a distinct value per locale (no locale silently reusing another’s string)', () => {
      const values = Object.values(locales).map(
        (dict) => getByPath((dict as { dashboard: unknown }).dashboard, key) as string
      )
      const unique = new Set(values)
      expect(
        unique.size,
        `expected 3 distinct translations for dashboard.${key}, got ${JSON.stringify(values)}`
      ).toBe(3)
    })
  })

  describe.each(Object.entries(INTERPOLATED_KEYS) as [(typeof DASHBOARD_NEW_KEYS)[number], string][])(
    'interpolated key "dashboard.%s"',
    (key, placeholder) => {
      it(`carries the "${placeholder}" placeholder in es, en, and ar`, () => {
        for (const [code, dict] of Object.entries(locales)) {
          const value = getByPath((dict as { dashboard: unknown }).dashboard, key) as string
          expect(
            value.includes(placeholder),
            `${code}.json dashboard.${key} ("${value}") is missing the ${placeholder} placeholder`
          ).toBe(true)
        }
      })
    }
  )

  // dashboard.* is already fully symmetric across es/en/ar before this
  // migration (no pre-existing orphans, unlike settings.* in #331), so a
  // full identical-leaf-key check under the whole tree is safe and covers
  // both the new keys and a regression guard against future drift.
  it('has an IDENTICAL leaf-key set under dashboard.* across es, en, and ar (no missing/extra keys)', () => {
    const keySets = Object.entries(locales).map(([code, dict]) => ({
      code,
      keys: collectLeafPaths((dict as { dashboard: unknown }).dashboard).sort(),
    }))
    const [reference, ...rest] = keySets
    for (const other of rest) {
      const missingInOther = reference.keys.filter((k) => !other.keys.includes(k))
      const extraInOther = other.keys.filter((k) => !reference.keys.includes(k))
      expect(
        missingInOther,
        `${other.code}.json is missing dashboard.* keys present in ${reference.code}.json`
      ).toEqual([])
      expect(
        extraInOther,
        `${other.code}.json has extra dashboard.* keys not present in ${reference.code}.json`
      ).toEqual([])
    }
  })
})
