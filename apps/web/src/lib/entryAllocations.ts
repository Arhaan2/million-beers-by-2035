import type { EntryAllocationPayload } from './types';

export interface AllocationDraft {
  contributor: string;
  amount: number;
}

export function equalSplit(total: number, participantCount: number): number[] {
  if (
    !Number.isInteger(total) ||
    !Number.isInteger(participantCount) ||
    total < participantCount ||
    participantCount < 1
  ) {
    return [];
  }
  const base = Math.floor(total / participantCount);
  const remainder = total % participantCount;
  return Array.from({ length: participantCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function allocationSum(allocations: Array<Pick<AllocationDraft, 'amount'>>): number {
  return allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
}

export function remainingAllocation(total: number, allocations: AllocationDraft[]): number {
  return total - allocationSum(allocations);
}

export function normalizeParticipantName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').normalize('NFKC').toLocaleLowerCase('en-US');
}

export function hasDuplicateParticipantNames(names: string[]): boolean {
  const seen = new Set<string>();
  for (const name of names) {
    const normalized = normalizeParticipantName(name);
    if (!normalized) continue;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

export function toSignedAllocations(
  allocations: AllocationDraft[],
  correction: boolean,
): EntryAllocationPayload[] {
  const sign = correction ? -1 : 1;
  return allocations.map((allocation) => ({
    contributor: allocation.contributor.trim().replace(/\s+/gu, ' '),
    amount: Math.abs(allocation.amount) * sign,
  }));
}

export function validateGroupEntry(
  total: number,
  allocations: AllocationDraft[],
  correction: boolean,
  note: string,
): string | null {
  if (!Number.isInteger(total) || total < 1 || total > 250) {
    return 'Choose a whole total from 1 to 250.';
  }
  if (allocations.length < 2 || allocations.length > 25) {
    return 'A group entry needs 2 to 25 people.';
  }
  if (allocations.some((allocation) => !normalizeParticipantName(allocation.contributor))) {
    return 'Enter a name for every participant.';
  }
  if (hasDuplicateParticipantNames(allocations.map((allocation) => allocation.contributor))) {
    return 'Each participant name must be unique.';
  }
  if (
    allocations.some(
      (allocation) =>
        !Number.isInteger(allocation.amount) || allocation.amount < 1 || allocation.amount > 250,
    )
  ) {
    return 'Every participant needs a whole allocation from 1 to 250.';
  }
  const remaining = remainingAllocation(total, allocations);
  if (remaining > 0) return `${remaining} beer${remaining === 1 ? '' : 's'} left to allocate.`;
  if (remaining < 0) {
    const over = Math.abs(remaining);
    return `Allocated ${over} beer${over === 1 ? '' : 's'} too many.`;
  }
  if (correction && note.trim().length < 4) {
    return 'Corrections require a reason of at least 4 characters.';
  }
  if (note.trim().length > 140) return 'Keep the note to 140 characters or fewer.';
  return null;
}
