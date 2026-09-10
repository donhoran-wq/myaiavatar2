import "server-only";

/**
 * Server-side client for the HeyGen v3 API (https://developers.heygen.com).
 * - Auth:   x-api-key header (HEYGEN_API_KEY)
 * - Create: POST /v3/videos  { type: "image" | "avatar", script, voice_id, ... } -> { data: { video_id, status } }
 * - Status: GET  /v3/videos/{id} -> { data: { status: pending|processing|completed|failed, video_url, duration, failure_message } }
 * Limits: 30 minutes per request, 5,000-character script.
 * The key is only read here and never returned to callers.
 */

export const HEYGEN_API_BASE = "https://api.heygen.com";
export const HEYGEN_SCRIPT_MAX = 5000;

export function getHeygenKey(): string | null {
  const v = process.env.HEYGEN_API_KEY?.trim();
  return v ? v : null;
}

export function isHeygenConfigured(): boolean {
  return getHeygenKey() !== null;
}

export type HeygenErrorCode = "not_configured" | "unauthorized" | "not_found" | "bad_request" | "rate_limited" | "upstream" | "network";

export class HeygenError extends Error {
  readonly httpStatus: number;
  readonly code: HeygenErrorCode;
  constructor(message: string, httpStatus: number, code: HeygenErrorCode) {
    super(message);
    this.name = "HeygenError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function redact(text: string, key: string | null): string {
  return key && key.length >= 4 ? text.split(key).join("[redacted]") : text;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getHeygenKey();
  if (!key) throw new HeygenError("HeyGen is not configured on the server. Set the HEYGEN_API_KEY environment variable.", 503, "not_configured");
  const url = `${HEYGEN_API_BASE}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = { "x-api-key": key, Accept: "application/json", ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body && typeof init.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (err) {
    throw new HeygenError(`Could not reach HeyGen: ${redact(err instanceof Error ? err.message : String(err), key)}`, 502, "network");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
    const detail = redact((err?.message ?? text ?? "").slice(0, 400), key);
    if (res.status === 401 || res.status === 403) throw new HeygenError("HeyGen rejected the server API key. Check HEYGEN_API_KEY.", 502, "unauthorized");
    if (res.status === 404) throw new HeygenError(`HeyGen could not find that resource: ${detail}`, 404, "not_found");
    if (res.status === 429) throw new HeygenError(`HeyGen rate limit reached. Try again shortly. ${detail}`, 429, "rate_limited");
    if (res.status === 400 || res.status === 422 || res.status === 424) throw new HeygenError(`HeyGen rejected the request: ${detail}`, 400, "bad_request");
    throw new HeygenError(`HeyGen returned HTTP ${res.status}: ${detail}`, 502, "upstream");
  }
  if (json === null) throw new HeygenError("HeyGen returned a non-JSON response.", 502, "upstream");
  return json as T;
}

export interface HeygenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url: string | null;
  type: "public" | "private";
}

export interface HeygenLook {
  id: string;
  name: string;
  preview_image_url: string | null;
  default_voice_id: string | null;
  supported_api_engines: string[];
  status: string;
  gender?: string;
}

interface Page<T> {
  data: T[] | { items?: T[] };
  has_more?: boolean;
  next_token?: string | null;
}

function items<T>(p: Page<T>): T[] {
  const d = p.data as unknown;
  if (Array.isArray(d)) return d as T[];
  const inner = (d as { items?: T[] } | null)?.items;
  return Array.isArray(inner) ? inner : [];
}

let voicesCache: { at: number; value: HeygenVoice[] } | null = null;
let looksCache: { at: number; value: HeygenLook[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/** Private (cloned) voices first, then English public voices. */
export async function listVoices(): Promise<HeygenVoice[]> {
  if (voicesCache && Date.now() - voicesCache.at < CACHE_MS) return voicesCache.value;
  const [priv, pub] = await Promise.all([
    request<Page<HeygenVoice>>("v3/voices?type=private&limit=100").catch(() => ({ data: [] }) as Page<HeygenVoice>),
    request<Page<HeygenVoice>>("v3/voices?language=en&limit=100"),
  ]);
  const seen = new Set<string>();
  const merged: HeygenVoice[] = [];
  for (const v of [...items(priv).map((v) => ({ ...v, type: "private" as const })), ...items(pub)]) {
    if (!v?.voice_id || seen.has(v.voice_id)) continue;
    seen.add(v.voice_id);
    merged.push({ voice_id: v.voice_id, name: v.name, language: v.language, gender: v.gender, preview_audio_url: v.preview_audio_url ?? null, type: v.type === "private" ? "private" : "public" });
  }
  voicesCache = { at: Date.now(), value: merged };
  return merged;
}

/** The account's own avatar looks (photo/video avatars trained by the user). */
export async function listPrivateLooks(): Promise<HeygenLook[]> {
  if (looksCache && Date.now() - looksCache.at < CACHE_MS) return looksCache.value;
  const p = await request<Page<HeygenLook>>("v3/avatars/looks?ownership=private&limit=50");
  const value = items(p)
    .filter((l) => l?.id)
    .map((l) => ({
      id: l.id,
      name: l.name || `Look ${l.id.slice(0, 8)}`,
      preview_image_url: l.preview_image_url ?? null,
      default_voice_id: l.default_voice_id ?? null,
      supported_api_engines: l.supported_api_engines ?? [],
      status: l.status ?? "unknown",
      gender: l.gender,
    }));
  looksCache = { at: Date.now(), value };
  return value;
}

export interface HeygenMe {
  billing_type?: string;
  wallet?: { currency?: string; remaining_balance?: number };
  credits?: { remaining?: number };
}

export async function getMe(): Promise<HeygenMe> {
  const r = await request<{ data: HeygenMe }>("v3/users/me");
  return r.data ?? {};
}

export type HeygenAspect = "16:9" | "9:16";

interface CreateVideoResponse {
  data: { video_id: string; status?: string; output_format?: string };
}

/** Animate a full-frame image (presenter already composited over the backdrop). */
export async function createImageVideo(input: { imageUrl: string; script: string; voiceId: string; aspectRatio: HeygenAspect; title: string }): Promise<string> {
  const body = {
    type: "image",
    image: { type: "url", url: input.imageUrl },
    script: input.script,
    voice_id: input.voiceId,
    aspect_ratio: input.aspectRatio,
    resolution: "1080p",
    output_format: "mp4",
    title: input.title,
  };
  const r = await request<CreateVideoResponse>("v3/videos", { method: "POST", body: JSON.stringify(body) });
  if (!r.data?.video_id) throw new HeygenError("HeyGen accepted the request but returned no video_id.", 502, "upstream");
  return r.data.video_id;
}

/** Render one of the account's own avatar looks over a background image. */
export async function createLookVideo(input: { lookId: string; backgroundUrl: string; script: string; voiceId: string; aspectRatio: HeygenAspect; title: string }): Promise<string> {
  const body = {
    type: "avatar",
    avatar_id: input.lookId,
    script: input.script,
    voice_id: input.voiceId,
    engine: { type: "avatar_iv" },
    background: { type: "image", url: input.backgroundUrl },
    aspect_ratio: input.aspectRatio,
    resolution: "1080p",
    output_format: "mp4",
    title: input.title,
  };
  const r = await request<CreateVideoResponse>("v3/videos", { method: "POST", body: JSON.stringify(body) });
  if (!r.data?.video_id) throw new HeygenError("HeyGen accepted the request but returned no video_id.", 502, "upstream");
  return r.data.video_id;
}

export interface HeygenVideo {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | string;
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
}

export async function getVideo(videoId: string): Promise<HeygenVideo> {
  const r = await request<{ data: HeygenVideo }>(`v3/videos/${encodeURIComponent(videoId)}`);
  return r.data;
}

/** Request IDs for HeyGen jobs are prefixed so the shared status/download routes can route them. */
export const HEYGEN_PREFIX = "hg-";
export const isHeygenRequestId = (id: string) => id.startsWith(HEYGEN_PREFIX);
export const toHeygenRequestId = (videoId: string) => `${HEYGEN_PREFIX}${videoId}`;
export const fromHeygenRequestId = (id: string) => id.slice(HEYGEN_PREFIX.length);
