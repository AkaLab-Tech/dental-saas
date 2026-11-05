// Calendar-day helpers in an explicit IANA zone, Intl only (same technique as
// isUnderPrimaryTeethAge in patient.service.ts). Pure: no Prisma, no host-zone reads.

export function zonedDayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

// Zone offset (ms, wall clock minus UTC) at an instant. Intl exposes no milliseconds, so the
// instant is floored to the second first.
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function zonedMonthKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).format(instant)
}

// Wall clock `year-month-dayT00:00:00` in the zone -> instant. Two passes so the offset is
// read at (approximately) the right side of a DST transition.
//
// `Date.UTC` normalizes out-of-range month and day arguments, so callers may pass month 13,
// month 0, day 32 or day -2 and get the expected calendar date.
//
// When that local midnight does not exist (DST spring-forward), the two passes land on the
// first instant that does exist after the skip. Chile's 2026 transition is the worked example:
// midnight on 2026-09-06 never happens in America/Santiago and the result is
// 2026-09-06T03:00:00.000Z, i.e. 01:00 local. The symmetric fall-back case (a local midnight
// that occurs twice) is undecided; no tenant on this deployment is in such a zone.
function dayStartInstant(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day)
  const firstGuess = target - offsetMs(new Date(target), timeZone)
  return new Date(target - offsetMs(new Date(firstGuess), timeZone))
}

// First and last instants of a month as the zone reads it. `monthOffset` counts months from
// `now`'s month: 0 is the current month, -1 the previous one. `end` is derived from the next
// month's start (ms field 0) rather than a formatted 23:59:59.999, which Intl would truncate
// to the second.
export function zonedMonthRange(
  now: Date,
  timeZone: string,
  monthOffset = 0
): { start: Date; end: Date } {
  const { year, month } = zonedParts(now, timeZone)
  const start = dayStartInstant(year, month + monthOffset, 1, timeZone)
  const nextStart = dayStartInstant(year, month + monthOffset + 1, 1, timeZone)
  return { start, end: new Date(nextStart.getTime() - 1) }
}

// First and last instants of `now`'s calendar day as the zone reads it. See dayStartInstant
// for what happens when that local midnight does not exist.
export function zonedDayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month, day } = zonedParts(now, timeZone)
  const start = dayStartInstant(year, month, day, timeZone)
  const nextStart = dayStartInstant(year, month, day + 1, timeZone)
  return { start, end: new Date(nextStart.getTime() - 1) }
}

// First and last instants of the Sunday-to-Saturday week containing `now`, as the zone reads
// it. Sunday start preserves the `getDay()` convention the host-zone version used.
export function zonedWeekRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month, day } = zonedParts(now, timeZone)
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const start = dayStartInstant(year, month, day - dayOfWeek, timeZone)
  const nextStart = dayStartInstant(year, month, day - dayOfWeek + 7, timeZone)
  return { start, end: new Date(nextStart.getTime() - 1) }
}
