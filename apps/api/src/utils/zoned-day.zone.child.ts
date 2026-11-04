// Child-process driver for zoned-day.zone.test.ts (#654). Not a test file.
// Runs in a fresh process whose TZ is set by the parent BEFORE start, so the host zone is a
// fact of the process rather than a runtime stub. Prints the helper's result as JSON.
// argv: hostZone, tenantZone, mode ('day' | 'range'), instantIso (the instant, or `now`)
import { zonedDayKey, zonedMonthRange } from './zoned-day.js'

const [hostZone, tenantZone, mode, instantIso] = process.argv.slice(2)

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

if (mode === 'day') {
  console.log(JSON.stringify({ result: zonedDayKey(new RealDate(instantIso), tenantZone) }))
} else {
  const { start, end } = zonedMonthRange(new Date(), tenantZone)
  console.log(JSON.stringify({ result: { start: start.toISOString(), end: end.toISOString() } }))
}
process.exit(0)
