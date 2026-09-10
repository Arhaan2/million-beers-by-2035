export interface ChallengeConfig {
  target: number;
  startAt: string;
  deadlineAt: string;
  timezone: string;
}

export interface DashboardStats {
  total: number;
  remaining: number;
  eventCount: number;
  entryCount: number;
  allocationCount: number;
  crewSize: number;
  percentComplete: number;
  updatedAt: number;
  revision?: number;
}

export interface BeerEvent {
  id: string;
  amount: number;
  contributor: string;
  note: string | null;
  createdAt: number;
  localDay: string;
}

export interface BeerAllocation {
  memberId?: string | null;
  remainingCorrectable?: number;
  id: string;
  contributor: string;
  amount: number;
}

export interface BeerEntry {
  isSystem?: boolean;
  id: string;
  totalAmount: number;
  note: string | null;
  createdAt: number;
  localDay: string;
  isCorrection: boolean;
  isGroup: boolean;
  allocations: BeerAllocation[];
  occurredAt?: string | null;
  occurrenceTimezone?: string | null;
  occurrencePrecision?: 'day' | 'minute' | null;
  memory?: MemoryMetadata | null;
  metadataVersion?: number;
  correctionOfEntryId?: string | null;
  correctionKind?: 'linked' | 'legacy' | null;
}

export interface LeaderboardEntry {
  contributor: string;
  netTotal: number;
  eventCount: number;
}

export interface DailyTotal {
  localDay: string;
  netTotal: number;
  eventCount: number;
  allocationCount?: number;
}

export interface DashboardSummary {
  revision?: number;
  capabilities?: Capabilities;
  community?: CommunityMetrics;
  challenge: ChallengeConfig;
  stats: DashboardStats;
  recentEntries: BeerEntry[];
  recentCommunityEntries?: BeerEntry[];
  recentEvents: BeerEvent[];
  leaderboard: LeaderboardEntry[];
  dailyTotals: DailyTotal[];
}

export interface EditorSession {
  token: string;
  expiresAt: number;
}

export interface EventPayload {
  amount: number;
  contributor: string;
  note: string;
  idempotencyKey: string;
}

export interface EntryAllocationPayload {
  memberId?: string;
  sourceAllocationId?: string;
  contributor: string;
  amount: number;
}

export interface EntryPayload {
  occurredAt?: string;
  occurrenceTimezone?: string;
  occurrencePrecision?: 'day' | 'minute';
  memory?: MemoryMetadata;
  correctionOfEntryId?: string;
  totalAmount: number;
  allocations: EntryAllocationPayload[];
  note: string;
  idempotencyKey: string;
}

export interface MemoryMetadata {
  title?: string;
  shortNote?: string;
  venue?: string;
  city?: string;
  beer?: string;
  brewery?: string;
  visibility?: 'public' | 'private';
}
export interface Capabilities {
  enhancedLogging?: boolean;
  memberCreation?: boolean;
  crew: boolean;
  history: boolean;
  memories: boolean;
  occurrence: boolean;
  linkedCorrections: boolean;
  metadataEditing: boolean;
  photos: boolean;
  strongIdentity: boolean;
}
export interface CommunityMetrics {
  directorySize: number;
  namedContributors: number;
  activeParticipants: number;
  entryCount: number;
  definitions?: Record<string, string>;
}
export interface CrewMember {
  id: string;
  displayName: string;
  aliases: string[];
  allocationCount: number;
  participationCount: number;
  netTotal: number;
  lastRecordedAt: number | null;
}
export interface EntryPage {
  entries: BeerEntry[];
  nextCursor: string | null;
}
export interface MemberPage {
  members: CrewMember[];
  nextCursor: string | null;
}
export interface EntryResult {
  entry?: BeerEntry;
  stats: {
    total: number;
    remaining?: number;
    entryCount: number;
    allocationCount: number;
    revision?: number;
  };
  revision?: number;
  idempotent: boolean;
}
export interface Recap extends EntryPage {
  period: string;
  dateBasis: 'recorded';
  netTotal: number;
  entryCount: number;
  participantCount: number;
}
