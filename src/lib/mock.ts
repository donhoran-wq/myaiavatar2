import { getTake } from "./takes";
import type { HiggsfieldRequestStatus } from "./higgsfield";

/**
 * Mock request path used for testing the full submit -> poll -> download flow
 * without calling Higgsfield or consuming credits. Mock request IDs are
 * self-describing (`mock-<mediaId>-<startedAtMs>`) so no server state is needed.
 * A mock job is queued for a few seconds, in progress for a few more, then
 * "completes" with the original take video as its output. It is always
 * labelled as a mock in API responses and in the UI; it never pretends to be a
 * real generation.
 */

const MOCK_PREFIX = "mock-";
const QUEUED_MS = 4_000;
const IN_PROGRESS_MS = 12_000;

export function isMockRequestId(id: string): boolean {
  return id.startsWith(MOCK_PREFIX);
}

export function makeMockRequestId(mediaId: string): string {
  return `${MOCK_PREFIX}${mediaId}-${Date.now()}`;
}

export function parseMockRequestId(id: string): { mediaId: string; startedAt: number } | null {
  if (!isMockRequestId(id)) return null;
  const rest = id.slice(MOCK_PREFIX.length);
  const sep = rest.lastIndexOf("-");
  if (sep < 0) return null;
  const mediaId = rest.slice(0, sep);
  const startedAt = Number(rest.slice(sep + 1));
  if (!Number.isFinite(startedAt) || !getTake(mediaId)) return null;
  return { mediaId, startedAt };
}

export function mockStatus(id: string): HiggsfieldRequestStatus | null {
  const parsed = parseMockRequestId(id);
  if (!parsed) return null;
  const take = getTake(parsed.mediaId)!;
  const elapsed = Date.now() - parsed.startedAt;
  if (elapsed < QUEUED_MS) return { status: "queued", request_id: id, error: null, video: null };
  if (elapsed < IN_PROGRESS_MS) return { status: "in_progress", request_id: id, error: null, video: null };
  return { status: "completed", request_id: id, error: null, video: { url: take.videoUrl } };
}
