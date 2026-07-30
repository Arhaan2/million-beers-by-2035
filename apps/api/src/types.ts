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
}

export interface EntryInput {
  totalAmount: number;
  allocations: AllocationInput[];
  note: string | null;
  idempotencyKey: string;
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
}

export interface EntryStats {
  total: number;
  remaining: number;
  entryCount: number;
  allocationCount: number;
}

export interface CreateEntryResult {
  entry: PublicEntry;
  stats: EntryStats;
  idempotent: boolean;
}

export interface RecordEventResult {
  event: PublicEvent;
  entry: PublicEntry;
  total: number;
  idempotent: boolean;
}

export interface RequestContext {
  requestId: string;
  corsOrigin: string | null;
}
