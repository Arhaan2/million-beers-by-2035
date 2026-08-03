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
  id: string;
  contributor: string;
  amount: number;
}

export interface BeerEntry {
  id: string;
  totalAmount: number;
  note: string | null;
  createdAt: number;
  localDay: string;
  isCorrection: boolean;
  isGroup: boolean;
  allocations: BeerAllocation[];
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
  challenge: ChallengeConfig;
  stats: DashboardStats;
  recentEntries: BeerEntry[];
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
  contributor: string;
  amount: number;
}

export interface EntryPayload {
  totalAmount: number;
  allocations: EntryAllocationPayload[];
  note: string;
  idempotencyKey: string;
}
