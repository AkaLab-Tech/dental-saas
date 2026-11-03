import esTranslations from './pdf-emails.es.js'
import enTranslations from './pdf-emails.en.js'
import arTranslations from './pdf-emails.ar.js'

export type Language = 'es' | 'en' | 'ar'

// Define AppointmentStatus locally to avoid dependency on @dental/database
// This must match the enum in the database package
export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'

const translations = {
  es: esTranslations,
  en: enTranslations,
  ar: arTranslations,
}

// Simple interpolation: replaces {{var}} with values
function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(new RegExp(`{{${key}}}`, 'g'), String(value)),
    template
  )
}

// Get nested value from object using dot notation
function getNestedValue(obj: any, path: string): string | undefined {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

// Main translation function
export function t(
  language: Language,
  key: string,
  values?: Record<string, string | number>
): string {
  const translation = getNestedValue(translations[language], key)
  if (!translation) {
    // In production environments without console, fail silently
    if (typeof console !== 'undefined') {
      console.warn(`Translation missing: ${language}.${key}`)
    }
    return key
  }
  return interpolate(translation, values)
}

// Format date based on language
export function formatDate(
  date: Date,
  language: Language,
  timezone: string,
  style: 'long' | 'short' = 'long'
): string {
  const localeMap: Record<Language, string> = {
    es: 'es-ES',
    en: 'en-US',
    ar: 'ar-SA',
  }
  return date.toLocaleDateString(localeMap[language], {
    year: 'numeric',
    month: style,
    day: 'numeric',
    timeZone: timezone,
  })
}

/**
 * Format a CALENDAR DAY (date stored at UTC midnight, e.g. DOB, labwork date, validUntil)
 * in the requested language. Pins timeZone: 'UTC' so the day rendered is the day entered,
 * regardless of tenant timezone or host location.
 *
 * CALENDAR DAYS ONLY. Real instants (appointment startTime, createdAt, generatedAt) must
 * continue to use formatDate with the tenant's timezone.
 */
export function formatCalendarDay(
  date: Date,
  language: Language,
  style: 'long' | 'short' = 'long'
): string {
  const localeMap: Record<Language, string> = {
    es: 'es-ES',
    en: 'en-US',
    ar: 'ar-SA',
  }
  return date.toLocaleDateString(localeMap[language], {
    year: 'numeric',
    month: style,
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Format time based on language
export function formatTime(date: Date, language: Language, timezone: string): string {
  const localeMap: Record<Language, string> = {
    es: 'es-ES',
    en: 'en-US',
    ar: 'ar-SA',
  }
  return date.toLocaleTimeString(localeMap[language], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

// Format date and time
export function formatDateTime(date: Date, language: Language, timezone: string): string {
  const localeMap: Record<Language, string> = {
    es: 'es-ES',
    en: 'en-US',
    ar: 'ar-SA',
  }
  return date.toLocaleString(localeMap[language], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

// Translate appointment status
export function translateStatus(status: AppointmentStatus, language: Language): string {
  const statusKey = status.toLowerCase()
  const key = `status.${statusKey}`
  const translated = t(language, key)
  // If translation is missing, t() returns the key itself, so we return the original status
  return translated === key ? status : translated
}

// Translate gender
export function translateGender(gender: string, language: Language): string {
  const key = `gender.${gender}`
  const translated = t(language, key)
  // If translation is missing, t() returns the key itself, so we return the original gender value
  return translated === key ? gender : translated
}

// Keep sanitizeFilename here since it's not language-specific
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_').substring(0, 100)
}
