import { NextResponse } from "next/server";
import { HiggsfieldError, TERMINAL_STATUSES, getRequestStatus, isConfigured, type HiggsfieldRequestStatus } from "@/lib/higgsfield";
import { HeygenError, fromHeygenRequestId, getVideo, isHeygenConfigured, isHeygenRequestId } from "@/lib/heygen";
import { isMockRequestId, mockStatus } from "@/lib/mock";
import type { ApiErrorResponse, StatusResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function toStatusResponse(requestId: string, s: HiggsfieldRequestStatus, mock: boolean): StatusResponse {
  const terminal = TERMINAL_STATUSES.has(s.status);
  const videoUrl = s.status === "completed" && s.video?.url ? s.video.url : null;
  const imageUrl = s.status === "completed" && s.images?.[0]?.url ? s.images[0].url : null;
  let errorMessage: string | null = null;
  if (s.status === "failed") errorMessage = s.error || "Generation failed. Credits for failed requests are not charged.";
  else if (s.status === "nsfw") errorMessage = "Generation was rejected by content moderation (NSFW). Credits are not charged.";
  else if (s.status === "canceled") errorMessage = "The request was canceled.";
  else if (s.status === "completed" && !videoUrl && !imageUrl) errorMessage = "Completed, but no output URL was returned.";
  return {
    requestId,
    status: s.status,
    mock,
    terminal,
    videoUrl,
    imageUrl,
    downloadUrl: videoUrl ? `/api/download/${encodeURIComponent(requestId)}` : null,
    error: errorMessage,
    checkedAt: new Date().toISOString(),
  };
}

/** Maps a HeyGen video record onto the shared status shape. */
export async function heygenStatus(requestId: string): Promise<StatusResponse> {
  const v = await getVideo(fromHeygenRequestId(requestId));
  const status = v.status === "completed" ? "completed" : v.status === "failed" ? "failed" : v.status === "pending" ? "queued" : "in_progress";
  const videoUrl = status === "completed" && v.video_url ? v.video_url : null;
  return {
    requestId,
    status,
    mock: false,
    terminal: status === "completed" || status === "failed",
    videoUrl,
    imageUrl: null,
    downloadUrl: videoUrl ? `/api/download/${encodeURIComponent(requestId)}` : null,
    error: status === "failed" ? `HeyGen reported a failure${v.failure_code ? ` (${v.failure_code})` : ""}: ${v.failure_message || "no details"}` : status === "completed" && !videoUrl ? "Completed, but HeyGen returned no video URL." : null,
    checkedAt: new Date().toISOString(),
    durationSeconds: typeof v.duration === "number" ? v.duration : null,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params;
  if (!REQUEST_ID_RE.test(requestId)) return error(400, { error: "Invalid request ID.", code: "validation" });

  if (isMockRequestId(requestId)) {
    const s = mockStatus(requestId);
    if (!s) return error(404, { error: "Unknown mock request.", code: "not_found" });
    return NextResponse.json(toStatusResponse(requestId, s, true), { headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (isHeygenRequestId(requestId)) {
      if (!isHeygenConfigured()) return error(503, { error: "HeyGen is not configured on the server.", code: "heygen_not_configured" });
      return NextResponse.json(await heygenStatus(requestId), { headers: { "Cache-Control": "no-store" } });
    }
    if (!isConfigured()) return error(503, { error: "Higgsfield credentials are not configured on the server.", code: "not_configured" });
    const s = await getRequestStatus(requestId);
    return NextResponse.json(toStatusResponse(requestId, s, false), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError || err instanceof HeygenError) return error(err.httpStatus, { error: err.message, code: err.code });
    console.error("status: unexpected error", err instanceof Error ? err.message : err);
    return error(500, { error: "Unexpected server error while checking status.", code: "internal" });
  }
}
