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

/**
 * Higgsfield runs two key-authenticated hosts: the newer Cloud API
 * (api.higgsfield.ai) and the older platform API (platform.higgsfield.ai,
 * used by the official Python/JS SDKs). Both use the same `Key id:secret`
 * header and the same /requests/{id}/status lifecycle, but expose different
 * model catalogs. HIGGSFIELD_API_BASE selects which one generation uses.
 */
export const API_BASES = {
  api: "https://api.higgsfield.ai",
  platform: "https://platform.higgsfield.ai",
} as const;
export type ApiBaseKey = keyof typeof API_BASES;

export function resolveBase(key?: string | null): string {
  const k = (key ?? firstEnv("HIGGSFIELD_API_BASE") ?? "api").trim();
  if (k in API_BASES) return API_BASES[k as ApiBaseKey];
  if (/^https:\/\/(api|platform)\.higgsfield\.ai$/.test(k)) return k;
  return API_BASES.api;
}

export const HIGGSFIELD_API_BASE = API_BASES.api;

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
      `The requested model is not available on this Higgsfield account (model_not_found). Check GET /api/health and GET /api/models/probe?path=<model>.`,
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

async function request<T>(path: string, init: RequestInit, base: string = resolveBase()): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new HiggsfieldError(
      "Higgsfield credentials are not configured on the server. Set the higgsfieldapi and higgsfieldkey (or HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET) environment variables.",
      503,
      "not_configured",
    );
  }
  const url = `${base}/${path.replace(/^\/+/, "")}`;
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

/** List the models available to this account (GET /models). Shape is passed through as returned by Higgsfield. */
export async function listModels(query = "", base?: string): Promise<unknown> {
  return request<unknown>(query ? `models?${query}` : "models", { method: "GET" }, resolveBase(base));
}

/**
 * Diagnostic: POST an empty body to a model path and report the raw status
 * and (redacted) body. A validation error (400/422) means the model exists;
 * `model_not_found` means it does not. An empty body can never start a
 * generation, so this costs no credits.
 */
export async function probeModelPath(path: string, base?: string, body = "{}"): Promise<{ status: number; body: string; autoCancelled?: string }> {
  const creds = getCredentials();
  if (!creds) throw new HiggsfieldError("Higgsfield credentials are not configured on the server.", 503, "not_configured");
  const url = `${resolveBase(base)}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(creds), body, cache: "no-store" });
  const text = redact((await res.text()).slice(0, 4000), creds);
  // Safety net: if loose upstream validation accepted the probe body, cancel
  // the queued request right away so it never runs or bills.
  if (res.ok) {
    try {
      const j = JSON.parse(text) as { request_id?: string };
      if (j.request_id) {
        const c = await cancelRequest(j.request_id, base);
        return { status: res.status, body: text, autoCancelled: `${j.request_id} -> ${c.status}` };
      }
    } catch {
      /* ignore */
    }
  }
  return { status: res.status, body: text };
}

/** Submit any model path with a prepared body. Returns the initial request status. */
export async function submitRaw(path: string, body: Record<string, unknown>): Promise<HiggsfieldRequestStatus> {
  return request<HiggsfieldRequestStatus>(path, { method: "POST", body: JSON.stringify(body) });
}

export interface Estimate {
  credits: string;
  usd: string;
}

/** Cost estimate for a model path with the same body a generation would use (POST /estimate/{path}). */
export async function estimateRaw(path: string, body: Record<string, unknown>): Promise<Estimate> {
  const r = await request<{ credits?: string; usd?: string }>(`estimate/${path.replace(/^\/+/, "")}`, { method: "POST", body: JSON.stringify(body) });
  return { credits: String(r.credits ?? "?"), usd: String(r.usd ?? "?") };
}

/**
 * Upload bytes through the documented presigned-URL flow
 * (POST /files/generate-upload-url, then PUT to upload_url) and return the public URL.
 */
export async function uploadFile(bytes: Buffer | Uint8Array, contentType: "image/png" | "image/jpeg"): Promise<string> {
  const creds = getCredentials();
  const slot = await request<{ public_url: string; upload_url: string; upload_headers?: Record<string, string> }>("files/generate-upload-url", {
    method: "POST",
    body: JSON.stringify({ content_type: contentType }),
  });
  const headers: Record<string, string> = { "Content-Type": contentType, ...(slot.upload_headers ?? {}) };
  const put = await fetch(slot.upload_url, { method: "PUT", headers, body: new Uint8Array(bytes), cache: "no-store" });
  if (!put.ok) throw new HiggsfieldError(`Upload to Higgsfield storage failed (HTTP ${put.status}).`, 502, "upstream");
  return redact(slot.public_url, creds);
}

/**
 * Checks whether a model path is usable with this key by posting an empty body:
 * a validation error means the model exists and is enabled; model_not_found,
 * model_disabled or model_blocked mean it is not. Cached per path for a minute.
 */
const AVAILABILITY_TTL_MS = 60_000;
const pathAvailabilityCache = new Map<string, { at: number; value: PathAvailability }>();
export interface PathAvailability {
  path: string;
  available: boolean | null;
  detail: string | null;
}
export async function checkPathAvailability(path: string): Promise<PathAvailability> {
  const hit = pathAvailabilityCache.get(path);
  if (hit && Date.now() - hit.at < AVAILABILITY_TTL_MS) return hit.value;
  let value: PathAvailability;
  if (!isConfigured()) value = { path, available: null, detail: "not_configured" };
  else {
    try {
      const r = await probeModelPath(path, undefined, "{}");
      if (r.status === 400 || r.status === 422) value = { path, available: true, detail: null };
      else if (r.status === 404 || r.status === 503 || r.status === 423) value = { path, available: false, detail: r.body.slice(0, 200) };
      else if (r.status === 401 || r.status === 403) value = { path, available: null, detail: "unauthorized" };
      else value = { path, available: null, detail: `HTTP ${r.status}` };
    } catch (err) {
      value = { path, available: null, detail: err instanceof Error ? err.message : "error" };
    }
  }
  pathAvailabilityCache.set(path, { at: Date.now(), value });
  return value;
}

/** Cancel a queued request (POST /requests/{id}/cancel). */
export async function cancelRequest(requestId: string, base?: string): Promise<{ status: number; body: string }> {
  const creds = getCredentials();
  if (!creds) throw new HiggsfieldError("Higgsfield credentials are not configured on the server.", 503, "not_configured");
  const url = `${resolveBase(base)}/requests/${encodeURIComponent(requestId)}/cancel`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(creds), cache: "no-store" });
  return { status: res.status, body: redact((await res.text()).slice(0, 1000), creds) };
}

/** Poll the status of a request. */
export async function getRequestStatus(requestId: string): Promise<HiggsfieldRequestStatus> {
  return request<HiggsfieldRequestStatus>(`requests/${encodeURIComponent(requestId)}/status`, { method: "GET" });
}

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "nsfw", "canceled"]);
