import { describe, expect, it } from 'vitest';
import {
  allocationSum,
  equalSplit,
  hasDuplicateParticipantNames,
  remainingAllocation,
  toSignedAllocations,
  validateGroupEntry,
} from './entryAllocations';

describe('entry allocation helpers', () => {
  it('splits 10 beers across 3 people as 4, 3, 3', () => {
    expect(equalSplit(10, 3)).toEqual([4, 3, 3]);
  });

  it('splits 12 evenly and gives the remainder to the first people', () => {
    expect(equalSplit(12, 4)).toEqual([3, 3, 3, 3]);
    expect(equalSplit(13, 4)).toEqual([4, 3, 3, 3]);
  });

  it('blocks equal splitting when the total is below the participant count', () => {
    expect(equalSplit(2, 3)).toEqual([]);
  });

  it('calculates allocation sums, remaining values, and over-allocation', () => {
    const allocations = [
      { contributor: 'A', amount: 4 },
      { contributor: 'B', amount: 3 },
    ];
    expect(allocationSum(allocations)).toBe(7);
    expect(remainingAllocation(10, allocations)).toBe(3);
    expect(remainingAllocation(6, allocations)).toBe(-1);
  });

  it('detects duplicate normalized names', () => {
    expect(hasDuplicateParticipantNames(['Arhaan', ' arhaan '])).toBe(true);
    expect(hasDuplicateParticipantNames(['Sam  Lee', 'sam lee'])).toBe(true);
    expect(hasDuplicateParticipantNames(['Arhaan', 'Sam'])).toBe(false);
  });

  it('converts visible correction values to signed API allocations', () => {
    expect(
      toSignedAllocations(
        [
          { contributor: ' Arhaan ', amount: 2 },
          { contributor: 'Sam', amount: 1 },
        ],
        true,
      ),
    ).toEqual([
      { contributor: 'Arhaan', amount: -2 },
      { contributor: 'Sam', amount: -1 },
    ]);
  });

  it('requires an exact manual split and a valid correction reason', () => {
    const allocations = [
      { contributor: 'A', amount: 4 },
      { contributor: 'B', amount: 3 },
      { contributor: 'C', amount: 3 },
    ];
    expect(validateGroupEntry(11, allocations, false, '')).toMatch(/left to allocate/u);
    expect(validateGroupEntry(9, allocations, false, '')).toMatch(/too many/u);
    expect(validateGroupEntry(10, allocations, true, 'no')).toMatch(/reason/u);
    expect(validateGroupEntry(10, allocations, true, 'Valid correction')).toBeNull();
  });
});
