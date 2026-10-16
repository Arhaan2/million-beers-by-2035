export function validPeriod(period: string): boolean {
  return /^(?!0000)[0-9]{4}(?:-(?:0[1-9]|1[0-2]))?$/u.test(period);
}
export function periodLabel(period: string): string {
  if (!validPeriod(period)) return period;
  if (period.length === 4) return period;
  const date = new Date(`${period}-01T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
export function adjacentPeriod(period: string, direction: -1 | 1): string | null {
  if (!validPeriod(period)) return null;
  let year = Number(period.slice(0, 4));
  let month = Number(period.slice(5) || 1);
  if (period.length === 4) year += direction;
  else {
    month += direction;
    if (month === 0) {
      month = 12;
      year--;
    }
    if (month === 13) {
      month = 1;
      year++;
    }
  }
  if (year < 1 || year > 9999) return null;
  return (
    String(year).padStart(4, '0') +
    (period.length === 4 ? '' : `-${String(month).padStart(2, '0')}`)
  );
}
export function periodRange(period: string): { from: string; to: string } {
  if (!validPeriod(period)) throw new Error('Choose a valid recap month or year.');
  const year = Number(period.slice(0, 4));
  if (period.length === 4) return { from: `${period}-01-01`, to: `${period}-12-31` };
  const month = Number(period.slice(5));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return { from: `${period}-01`, to: `${period}-${days}` };
}
