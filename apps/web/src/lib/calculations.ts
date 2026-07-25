const DAY_MS = 86_400_000;

export interface CountdownValue {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  complete: boolean;
}

export function remainingCount(total: number, target: number): number {
  return Math.max(0, target - total);
}

export function percentComplete(total: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(100, Math.max(0, (total / target) * 100));
}

export function countdownTo(deadlineAt: string, now = Date.now()): CountdownValue {
  const difference = new Date(deadlineAt).getTime() - now;
  if (!Number.isFinite(difference) || difference <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, complete: true };
  }
  const totalSeconds = Math.floor(difference / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    complete: false,
  };
}

export function averagePerElapsedDay(
  total: number,
  startAt: string,
  now = Date.now(),
): number | null {
  if (total <= 0) return null;
  const elapsed = now - new Date(startAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
  return total / Math.max(1, elapsed / DAY_MS);
}

export function requiredPerDay(
  total: number,
  target: number,
  deadlineAt: string,
  now = Date.now(),
): number {
  if (total >= target) return 0;
  const remainingDays = (new Date(deadlineAt).getTime() - now) / DAY_MS;
  if (!Number.isFinite(remainingDays) || remainingDays <= 0) return Number.POSITIVE_INFINITY;
  return (target - total) / remainingDays;
}

export function projectedFinishAt(total: number, startAt: string, now = Date.now()): number | null {
  const pace = averagePerElapsedDay(total, startAt, now);
  if (!pace || pace <= 0) return null;
  const start = new Date(startAt).getTime();
  return start + (total / pace) * DAY_MS;
}

export function projectedTargetFinishAt(
  total: number,
  target: number,
  startAt: string,
  now = Date.now(),
): number | null {
  const pace = averagePerElapsedDay(total, startAt, now);
  if (!pace || pace <= 0) return null;
  return new Date(startAt).getTime() + (target / pace) * DAY_MS;
}

export function nextMilestone(total: number, target: number): number {
  if (total >= target) return target;
  const milestones = [
    100,
    500,
    1_000,
    5_000,
    10_000,
    25_000,
    50_000,
    100_000,
    250_000,
    500_000,
    750_000,
    target,
  ];
  return milestones.find((milestone) => milestone > total) ?? target;
}
