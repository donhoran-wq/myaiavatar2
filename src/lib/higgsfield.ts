import "server-only";

/**
 * Minimal server-side client for the official Higgsfield API.
 * Docs: https://docs.higgsfield.ai/docs
 *
 * - Base URL: https://api.higgsfield.ai
 * - Auth:     Authorization: Key <KEY_ID>:<KEY_SECRET>
 * - Submit:   POST /<model-path>  -> { request_id, status, status_url, ... }
 * - Status:   GET  /requests/{request_id}/status
 *             status: queued | in_progress | completed | failed | nsfw | canceled
 *             completed responses carry `video: { url }`.
 *
 * Credentials are only ever read here and are never returned to callers.
 */

export const HIGGSFIELD_API_BASE = "https://api.higgsfield.ai";

/** Model path used for generation. Override with HIGGSFIELD_MODEL if needed. */
export const DEFAULT_MODEL_PATH = "veo3.1/reference-to-video";

export type HiggsfieldStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HiggsfieldRequestStatus {
  status: HiggsfieldStatus;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  video?: { url: string } | null;
  images?: { url: string }[];
}

interface Credentials {
  keyId: string;
  keySecret: string;
}

function firstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export function getCredentials(): Credentials | null {
  // Vercel project variables are `higgsfieldapi` (key id) and `higgsfieldkey`
  // (key secret). Uppercase aliases are also honoured.
  const keyId = firstEnv("HIGGSFIELD_API_KEY_ID", "higgsfieldapi", "HIGGSFIELDAPI");
  const keySecret = firstEnv("HIGGSFIELD_API_KEY_SECRET", "higgsfieldkey", "HIGGSFIELDKEY");
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export function isConfigured(): boolean {
  return getCredentials() !== null;
}

export function getModelPath(): string {
  return (firstEnv("HIGGSFIELD_MODEL") ?? DEFAULT_MODEL_PATH).replace(/^\/+/, "");
}

export type HiggsfieldErrorCode =
  | "not_configured"
  | "unauthorized"
  | "not_found"
  | "model_not_found"
  | "bad_request"
  | "rate_limited"
  | "upstream"
  | "network";

export class HiggsfieldError extends Error {
  readonly httpStatus: number;
  readonly code: HiggsfieldErrorCode;
  constructor(message: string, httpStatus: number, code: HiggsfieldErrorCode) {
    super(message);
    this.name = "HiggsfieldError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/** Remove any accidental echo of credentials from text we might surface. */
function redact(text: string, creds: Credentials | null): string {
  let out = text;
  if (creds) {
    for (const secret of [creds.keySecret, creds.keyId]) {
      if (secret.length >= 4) out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

function authHeaders(creds: Credentials): Record<string, string> {
  return {
    Authorization: `Key ${creds.keyId}:${creds.keySecret}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "avatar-studio/1.0 (+server)",
  };
}

async function readErrorMessage(res: Response, creds: Credentials): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { detail?: unknown; error?: unknown; message?: unknown };
      const d = json.detail ?? json.error ?? json.message;
      detail = typeof d === "string" ? d : d ? JSON.stringify(d) : text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  detail = redact(detail, creds).slice(0, 500);
  return detail || res.statusText || `HTTP ${res.status}`;
}

function mapHttpError(res: Response, detail: string): HiggsfieldError {
  if (res.status === 401 || res.status === 403) {
    return new HiggsfieldError(
      `Higgsfield rejected the server credentials (HTTP ${res.status}). Check the higgsfieldapi / higgsfieldkey environment variables.`,
      502,
      "unauthorized",
    );
  }
  if (res.status === 404 && /model_not_found/i.test(detail)) {
    return new HiggsfieldError(
      `The configured model "${getModelPath()}" is not available on this Higgsfield account (model_not_found). Check GET /api/models for the models your API key can use, or set HIGGSFIELD_MODEL to one of them.`,
      404,
      "model_not_found",
    );
  }
  if (res.status === 404) return new HiggsfieldError(`Higgsfield could not find that request: ${detail}`, 404, "not_found");
  if (res.status === 402) return new HiggsfieldError(`Higgsfield reported insufficient credits: ${detail}`, 402, "bad_request");
  if (res.status === 422 || res.status === 400) return new HiggsfieldError(`Higgsfield rejected the request: ${detail}`, 400, "bad_request");
  if (res.status === 429) return new HiggsfieldError(`Higgsfield rate limit reached. Try again shortly. ${detail}`, 429, "rate_limited");
  return new HiggsfieldError(`Higgsfield returned HTTP ${res.status}: ${detail}`, 502, "upstream");
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new HiggsfieldError(
      "Higgsfield credentials are not configured on the server. Set the higgsfieldapi and higgsfieldkey (or HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET) environment variables.",
      503,
      "not_configured",
    );
  }
  const url = `${HIGGSFIELD_API_BASE}/${path.replace(/^\/+/, "")}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: authHeaders(creds), cache: "no-store" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HiggsfieldError(`Could not reach the Higgsfield API: ${redact(msg, creds)}`, 502, "network");
  }
  if (!res.ok) {
    const detail = await readErrorMessage(res, creds);
    throw mapHttpError(res, detail);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new HiggsfieldError("Higgsfield returned a non-JSON response.", 502, "upstream");
  }
}

export interface ReferenceToVideoInput {
  prompt: string;
  image_urls: string[];
  duration: "4" | "6" | "8";
  resolution: "720" | "1080";
  aspect_ratio: "16:9" | "9:16";
  generate_audio: boolean;
}

/** Submit an asynchronous generation request. Returns the initial request status. */
export async function submitGeneration(input: ReferenceToVideoInput): Promise<HiggsfieldRequestStatus> {
  availabilityCache = null; // a submission is the ground truth; re-read the catalog next time
  return request<HiggsfieldRequestStatus>(getModelPath(), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** List the models available to this account (GET /models). Shape is passed through as returned by Higgsfield. */
export async function listModels(query = ""): Promise<unknown> {
  return request<unknown>(query ? `models?${query}` : "models", { method: "GET" });
}

export interface ModelAvailability {
  /** true/false when the catalog could be read; null when it could not (network, auth, not configured). */
  configuredModelAvailable: boolean | null;
  configuredModel: string;
  videoModels: string[];
  totalModels: number | null;
  error: string | null;
}

interface CatalogItem {
  slug?: string;
  output_type?: string;
  operation_type?: string[];
}

let availabilityCache: { at: number; value: ModelAvailability } | null = null;
const AVAILABILITY_TTL_MS = 60_000;

/**
 * Reads the account's model catalog and reports whether the configured model
 * can be used and which video models exist. Cached for a minute. Never throws.
 */
export async function getModelAvailability(): Promise<ModelAvailability> {
  const configuredModel = getModelPath();
  if (availabilityCache && Date.now() - availabilityCache.at < AVAILABILITY_TTL_MS && availabilityCache.value.configuredModel === configuredModel) {
    return availabilityCache.value;
  }
  let value: ModelAvailability;
  if (!isConfigured()) {
    value = { configuredModelAvailable: null, configuredModel, videoModels: [], totalModels: null, error: "not_configured" };
  } else {
    try {
      const raw = (await listModels("size=100")) as { total?: number; items?: CatalogItem[] };
      const items = Array.isArray(raw?.items) ? raw.items : [];
      const slugs = items.map((m) => (m.slug ?? "").replace(/^\/+/, ""));
      const videoModels = items.filter((m) => m.output_type === "video" || (m.operation_type ?? []).some((o) => /video/i.test(o))).map((m) => m.slug ?? "");
      value = {
        configuredModelAvailable: slugs.includes(configuredModel),
        configuredModel,
        videoModels,
        totalModels: typeof raw?.total === "number" ? raw.total : items.length,
        error: null,
      };
    } catch (err) {
      value = {
        configuredModelAvailable: null,
        configuredModel,
        videoModels: [],
        totalModels: null,
        error: err instanceof HiggsfieldError ? err.code : "unknown",
      };
    }
  }
  availabilityCache = { at: Date.now(), value };
  return value;
}

/** Poll the status of a request. */
export async function getRequestStatus(requestId: string): Promise<HiggsfieldRequestStatus> {
  return request<HiggsfieldRequestStatus>(`requests/${encodeURIComponent(requestId)}/status`, { method: "GET" });
}

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "nsfw", "canceled"]);
