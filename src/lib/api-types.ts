/** Shapes shared between API routes and the client. Never include credentials. */

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface GenerateResponse {
  requestId: string;
  status: JobStatus;
  mock: boolean;
  model: string;
  prompt: string;
  take: { id: string; label: string; outfit: string };
  submittedAt: string;
}

export interface StatusResponse {
  requestId: string;
  status: JobStatus;
  mock: boolean;
  terminal: boolean;
  videoUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
  checkedAt: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  fieldErrors?: Record<string, string>;
}

export interface HealthResponse {
  ok: true;
  higgsfieldConfigured: boolean;
  model: string;
  /** true/false when the account catalog could be read; null when unknown. */
  modelAvailable: boolean | null;
  videoModels: string[];
  totalModels: number | null;
  takes: number;
}
