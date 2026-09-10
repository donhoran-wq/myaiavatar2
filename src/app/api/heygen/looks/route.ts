import { NextResponse } from "next/server";
import { HeygenError, isHeygenConfigured, listPrivateLooks } from "@/lib/heygen";
import type { ApiErrorResponse, LookOption } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/heygen/looks — the account's own avatar looks (trained photo/video avatars). */
export async function GET() {
  if (!isHeygenConfigured()) return NextResponse.json({ error: "HeyGen is not configured on the server.", code: "heygen_not_configured" } satisfies ApiErrorResponse, { status: 503 });
  try {
    const looks = await listPrivateLooks();
    const out: LookOption[] = looks.filter((l) => l.status === "completed" || l.status === "unknown").map((l) => ({ id: l.id, name: l.name, previewUrl: l.preview_image_url, defaultVoiceId: l.default_voice_id }));
    return NextResponse.json({ looks: out }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof HeygenError) return NextResponse.json({ error: err.message, code: err.code } satisfies ApiErrorResponse, { status: err.httpStatus });
    return NextResponse.json({ error: "Could not list HeyGen looks." } satisfies ApiErrorResponse, { status: 500 });
  }
}
