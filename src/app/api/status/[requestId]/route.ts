import { NextResponse } from "next/server";
import { HiggsfieldError, TERMINAL_STATUSES, getRequestStatus, isConfigured, type HiggsfieldRequestStatus } from "@/lib/higgsfield";
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
  let errorMessage: string | null = null;
  if (s.status === "failed") errorMessage = s.error || "Generation failed. Credits for failed requests are not charged.";
  else if (s.status === "nsfw") errorMessage = "Generation was rejected by content moderation (NSFW). Credits are not charged.";
  else if (s.status === "canceled") errorMessage = "The request was canceled.";
  else if (s.status === "completed" && !videoUrl) errorMessage = "Completed, but no video URL was returned.";
  return {
    requestId,
    status: s.status,
    mock,
    terminal,
    videoUrl,
    downloadUrl: videoUrl ? `/api/download/${encodeURIComponent(requestId)}` : null,
    error: errorMessage,
    checkedAt: new Date().toISOString(),
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

  if (!isConfigured()) {
    return error(503, { error: "Higgsfield credentials are not configured on the server.", code: "not_configured" });
  }

  try {
    const s = await getRequestStatus(requestId);
    return NextResponse.json(toStatusResponse(requestId, s, false), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return error(err.httpStatus, { error: err.message, code: err.code });
    console.error("status: unexpected error", err instanceof Error ? err.message : err);
    return error(500, { error: "Unexpected server error while checking status.", code: "internal" });
  }
}
