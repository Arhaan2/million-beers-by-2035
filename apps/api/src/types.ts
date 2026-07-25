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

export interface PublicEvent {
  id: string;
  amount: number;
  contributor: string;
  note: string | null;
  createdAt: number;
  localDay: string;
}

export interface RecordEventResult {
  event: PublicEvent;
  total: number;
  idempotent: boolean;
}

export interface RequestContext {
  requestId: string;
  corsOrigin: string | null;
}
