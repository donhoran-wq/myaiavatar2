import { NextResponse } from "next/server";
import { HiggsfieldError, cancelRequest, getRequestStatus, isConfigured } from "@/lib/higgsfield";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

/** POST /api/cancel/:requestId — cancels a queued Higgsfield request and returns its status afterwards. */
export async function POST(_req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await ctx.params;
  if (!REQUEST_ID_RE.test(requestId)) return NextResponse.json({ error: "Invalid request ID." }, { status: 400 });
  if (!isConfigured()) return NextResponse.json({ error: "not configured", code: "not_configured" }, { status: 503 });
  try {
    const cancel = await cancelRequest(requestId);
    let status: unknown = null;
    try {
      status = await getRequestStatus(requestId);
    } catch (err) {
      status = { error: err instanceof Error ? err.message : String(err) };
    }
    return NextResponse.json({ requestId, cancel, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    return NextResponse.json({ error: "cancel failed" }, { status: 500 });
  }
}
