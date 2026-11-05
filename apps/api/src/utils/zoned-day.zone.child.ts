// Child-process driver for zoned-day.zone.test.ts (#654). Not a test file.
// Runs in a fresh process whose TZ is set by the parent BEFORE start, so the host zone is a
// fact of the process rather than a runtime stub. Prints the helper's result as JSON.
// argv: hostZone, tenantZone, mode, instantIso (the instant, or `now`), monthOffset (range only)
// modes: 'day' | 'monthkey' (key of the instant) | 'range' | 'dayrange' | 'weekrange' (of `now`)
import {
  zonedDayKey,
  zonedMonthKey,
  zonedMonthRange,
  zonedDayRange,
  zonedWeekRange,
} from './zoned-day.js'

const [hostZone, tenantZone, mode, instantIso, monthOffset] = process.argv.slice(2)

const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
if (resolved !== hostZone) {
  console.error(`host zone pin did not take: wanted ${hostZone}, resolved ${resolved}`)
  process.exit(2)
}

const RealDate = Date
const fixed = new RealDate(instantIso).getTime()
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length === 0 ? [fixed] : args) as [number]))
  }
  static override now() {
    return fixed
  }
}
globalThis.Date = FixedDate as DateConstructor

const iso = ({ start, end }: { start: Date; end: Date }) => ({
  start: start.toISOString(),
  end: end.toISOString(),
})

let result: unknown
if (mode === 'day') {
  result = zonedDayKey(new RealDate(instantIso), tenantZone)
} else if (mode === 'monthkey') {
  result = zonedMonthKey(new RealDate(instantIso), tenantZone)
} else if (mode === 'dayrange') {
  result = iso(zonedDayRange(new Date(), tenantZone))
} else if (mode === 'weekrange') {
  result = iso(zonedWeekRange(new Date(), tenantZone))
} else {
  result = iso(zonedMonthRange(new Date(), tenantZone, Number(monthOffset ?? 0)))
}
console.log(JSON.stringify({ result }))
process.exit(0)
