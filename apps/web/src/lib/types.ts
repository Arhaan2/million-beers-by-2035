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

export interface LeaderboardEntry {
  contributor: string;
  netTotal: number;
  eventCount: number;
}

export interface DailyTotal {
  localDay: string;
  netTotal: number;
  eventCount: number;
}

export interface DashboardSummary {
  challenge: ChallengeConfig;
  stats: DashboardStats;
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
