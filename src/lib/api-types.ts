/** Shapes shared between API routes and the client. Never include credentials. */

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

/** Pipeline stages. Mock runs are single-stage; real runs are backdrop → video. */
export type Stage = "mock" | "backdrop" | "video";

export type Engine = "higgsfield" | "heygen";

export interface PipelineParams {
  engine: Engine;
  mediaId: string;
  scene: string;
  dialogue: string;
  duration: number;
  aspectRatio: "16:9" | "9:16";
  model: string;
  backdropPrompt?: string | null;
  /** HeyGen only: animate the composited take ("image") or render one of the account's own looks ("look"). */
  heygenSource?: "image" | "look";
  heygenLookId?: string | null;
  heygenVoiceId?: string | null;
}

export interface GenerateResponse {
  requestId: string;
  status: JobStatus;
  stage: Stage;
  engine: Engine;
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
  /** HeyGen reports duration on completion. */
  durationSeconds?: number | null;
}

export interface EstimateResponse {
  engine: Engine;
  model: string;
  modelLabel: string;
  duration: number;
  animationCredits: string;
  animationUsd: string;
  backdropCredits: string;
  backdropUsd: string;
  totalCredits: string;
  totalUsd: string;
  /** HeyGen: no per-request estimate endpoint; wallet balance and billing note instead. */
  note?: string;
  walletUsd?: number | null;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  fieldErrors?: Record<string, string>;
}

export interface HealthResponse {
  ok: true;
  higgsfieldConfigured: boolean;
  heygenConfigured: boolean;
  model: string;
  modelPath: string;
  /** true/false when the model path could be probed; null when unknown. */
  modelAvailable: boolean | null;
  backdropAvailable: boolean | null;
  takes: number;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender: string;
  previewUrl: string | null;
  type: "public" | "private";
}

export interface LookOption {
  id: string;
  name: string;
  previewUrl: string | null;
  defaultVoiceId: string | null;
}
