// Match a civil time against its IANA zone; JS Date alone silently normalizes
// nonexistent DST times and arbitrarily chooses one repeated hour.
export function occurrencePayload(
  date: string,
  time: string,
  timezone: string,
):
  | { occurredAt: string; occurrenceTimezone: string; occurrencePrecision: 'day' | 'minute' }
  | undefined {
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || (time && !/^\d{2}:\d{2}$/u.test(time)))
    throw new Error('Enter a valid date and time.');
  const civil = `${date}T${time || '00:00'}`;
  const nominal = Date.parse(`${civil}:00Z`);
  if (!Number.isFinite(nominal)) throw new Error('Enter a valid date.');
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error('Enter a valid IANA timezone, for example America/Los_Angeles.');
  }
  const matches: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = nominal + offset * 60_000;
    const parts = formatter.formatToParts(candidate);
    const part = (name: string) => parts.find((value) => value.type === name)?.value ?? '';
    if (
      `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}` === civil
    )
      matches.push(candidate);
  }
  if (!matches.length)
    throw new Error(
      'That local date/time does not exist in this timezone. Check the date or daylight-saving transition.',
    );
  if (matches.length > 1 && time)
    throw new Error(
      'That local time occurs twice during the daylight-saving transition. Leave the time blank to record only the date.',
    );
  const instant = matches[0] ?? nominal;
  if (instant > Date.now() + 300_000)
    throw new Error('The occurrence date cannot be in the future.');
  const offsetMinutes = (nominal - instant) / 60_000;
  const absolute = Math.abs(offsetMinutes);
  const offset = `${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return {
    occurredAt: `${civil}:00${offset}`,
    occurrenceTimezone: timezone,
    occurrencePrecision: time ? 'minute' : 'day',
  };
}
