// Child-process driver for patient-primary-teeth.zone.test.ts (#658). Not a test file.
// Runs in a fresh process whose TZ is set by the parent BEFORE start, so the host zone is a
// fact of the process rather than a runtime stub. Prints the helper's result as JSON.
import { isUnderPrimaryTeethAge } from './patient.service.js'

const [hostZone, tenantZone, nowIso, dobIso] = process.argv.slice(2)

const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
if (resolved !== hostZone) {
  console.error(`host zone pin did not take: wanted ${hostZone}, resolved ${resolved}`)
  process.exit(2)
}

const RealDate = Date
const fixed = new RealDate(nowIso).getTime()
class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length === 0 ? [fixed] : args) as [number]))
  }
  static override now() {
    return fixed
  }
}
globalThis.Date = FixedDate as DateConstructor

console.log(JSON.stringify({ result: isUnderPrimaryTeethAge(new RealDate(dobIso), tenantZone) }))
process.exit(0)
