/** Shapes shared between API routes and the client. Never include credentials. */

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

/** Pipeline stages. Mock runs are single-stage; real runs are backdrop → video. */
export type Stage = "mock" | "backdrop" | "video";

export interface PipelineParams {
  mediaId: string;
  scene: string;
  dialogue: string;
  duration: number;
  aspectRatio: "16:9" | "9:16";
  model: string;
  backdropPrompt?: string | null;
}

export interface GenerateResponse {
  requestId: string;
  status: JobStatus;
  stage: Stage;
  mock: boolean;
  model: string;
  modelLabel: string;
  prompt: string;
  take: { id: string; label: string; outfit: string };
  pipeline: PipelineParams;
  submittedAt: string;
  /** Present on the video stage: the composited presenter-over-backdrop frame sent to the model. */
  compositeUrl?: string;
}

export interface StatusResponse {
  requestId: string;
  status: JobStatus;
  mock: boolean;
  terminal: boolean;
  videoUrl: string | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
  checkedAt: string;
}

export interface EstimateResponse {
  model: string;
  modelLabel: string;
  duration: number;
  animationCredits: string;
  animationUsd: string;
  backdropCredits: string;
  backdropUsd: string;
  totalCredits: string;
  totalUsd: string;
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
  modelPath: string;
  /** true/false when the model path could be probed; null when unknown. */
  modelAvailable: boolean | null;
  backdropAvailable: boolean | null;
  takes: number;
}
