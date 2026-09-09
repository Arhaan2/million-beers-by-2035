export interface SessionPayload {
  v: 1;
  scope: 'editor';
  iat: number;
  exp: number;
  jti: string;
}

export interface EventInput {
  amount: number;
  contributor: string;
  note: string | null;
  idempotencyKey: string;
}

export interface AllocationInput {
  contributor: string;
  contributorKey: string;
  amount: number;
  memberId?: string;
  sourceAllocationId?: string;
}

export interface MemoryInput {
  title: string | null;
  shortNote: string | null;
  venue: string | null;
  city: string | null;
  beer: string | null;
  brewery: string | null;
  visibility: 'public' | 'private';
}

export interface EntryInput {
  totalAmount: number;
  allocations: AllocationInput[];
  note: string | null;
  idempotencyKey: string;
  occurredAt?: string | null;
  occurrenceTimezone?: string | null;
  occurrencePrecision?: 'day' | 'minute' | null;
  memory?: MemoryInput | null;
  correctionOfEntryId?: string | null;
}

export interface PublicEvent {
  id: string;
  amount: number;
  contributor: string;
  note: string | null;
  createdAt: number;
  localDay: string;
}

export interface PublicAllocation {
  id: string;
  contributor: string;
  amount: number;
  memberId?: string | null;
  remainingCorrectable?: number;
  sourceAllocationId?: string | null;
}

export interface PublicEntry {
  id: string;
  totalAmount: number;
  note: string | null;
  createdAt: number;
  localDay: string;
  isCorrection: boolean;
  isGroup: boolean;
  allocations: PublicAllocation[];
  occurredAt?: string | null;
  occurrenceTimezone?: string | null;
  occurrencePrecision?: 'day' | 'minute' | null;
  occurrenceSource?: 'provided' | 'unknown';
  memory?: MemoryInput | null;
  metadataVersion?: number;
  correctionOfEntryId?: string | null;
  correctionKind?: 'linked' | 'legacy' | null;
  isSystem?: boolean;
}

export interface EntryStats {
  total: number;
  remaining: number;
  entryCount: number;
  allocationCount: number;
  revision?: number;
}

export interface CreateEntryResult {
  entry: PublicEntry;
  stats: EntryStats;
  idempotent: boolean;
  revision?: number;
}

export interface RecordEventResult {
  event: PublicEvent;
  entry: PublicEntry;
  total: number;
  idempotent: boolean;
  revision?: number;
}

export interface RequestContext {
  requestId: string;
  corsOrigin: string | null;
}
