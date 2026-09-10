import { NextResponse } from "next/server";
import { HiggsfieldError, getRequestStatus, isConfigured } from "@/lib/higgsfield";
import { HeygenError, fromHeygenRequestId, getVideo, isHeygenConfigured, isHeygenRequestId } from "@/lib/heygen";
import { isMockRequestId, mockStatus } from "@/lib/mock";
import type { ApiErrorResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Streams the finished MP4 back to the browser with a download filename. The
 * video URL is re-read from the provider server-side, so the client can never
 * make this route proxy an arbitrary URL.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params;
  if (!REQUEST_ID_RE.test(requestId)) return error(400, { error: "Invalid request ID.", code: "validation" });

  let videoUrl: string | null = null;
  const mock = isMockRequestId(requestId);
  const heygen = isHeygenRequestId(requestId);
  try {
    if (mock) {
      const s = mockStatus(requestId);
      if (!s) return error(404, { error: "Unknown mock request.", code: "not_found" });
      videoUrl = s.status === "completed" ? (s.video?.url ?? null) : null;
    } else if (heygen) {
      if (!isHeygenConfigured()) return error(503, { error: "HeyGen is not configured on the server.", code: "heygen_not_configured" });
      const v = await getVideo(fromHeygenRequestId(requestId));
      videoUrl = v.status === "completed" ? (v.video_url ?? null) : null;
    } else {
      if (!isConfigured()) return error(503, { error: "Higgsfield credentials are not configured on the server.", code: "not_configured" });
      const s = await getRequestStatus(requestId);
      videoUrl = s.status === "completed" ? (s.video?.url ?? null) : null;
    }
  } catch (err) {
    if (err instanceof HiggsfieldError || err instanceof HeygenError) return error(err.httpStatus, { error: err.message, code: err.code });
    return error(500, { error: "Unexpected server error while preparing the download.", code: "internal" });
  }

  if (!videoUrl) return error(409, { error: "The video is not ready yet.", code: "not_ready" });

  let upstream: Response;
  try {
    upstream = await fetch(videoUrl, { cache: "no-store" });
  } catch {
    return error(502, { error: "Could not fetch the finished video from the provider.", code: "network" });
  }
  if (!upstream.ok || !upstream.body) {
    return error(502, { error: `The video host returned HTTP ${upstream.status}.`, code: "upstream" });
  }

  const shortId = (mock ? requestId.slice("mock-".length) : heygen ? fromHeygenRequestId(requestId) : requestId).slice(0, 8);
  const filename = `${mock ? "mock-" : heygen ? "heygen-" : "avatar-"}${shortId}.mp4`;
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "video/mp4",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(upstream.body, { status: 200, headers });
}
