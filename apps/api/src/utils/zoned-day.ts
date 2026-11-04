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

// Wall clock `year-month-01T00:00:00` in the zone -> instant. Two passes so the offset is
// read at (approximately) the right side of a DST transition.
function monthStartInstant(year: number, month: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, 1)
  const firstGuess = target - offsetMs(new Date(target), timeZone)
  return new Date(target - offsetMs(new Date(firstGuess), timeZone))
}

// First and last instants of `now`'s month as the zone reads it. `end` is derived from the
// next month's start (ms field 0) rather than a formatted 23:59:59.999, which Intl would
// truncate to the second.
export function zonedMonthRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const { year, month } = zonedParts(now, timeZone)
  const start = monthStartInstant(year, month, timeZone)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextStart = monthStartInstant(nextYear, nextMonth, timeZone)
  return { start, end: new Date(nextStart.getTime() - 1) }
}
