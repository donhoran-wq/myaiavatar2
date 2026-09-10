import { NextResponse } from "next/server";
import { HeygenError, isHeygenConfigured, listVoices } from "@/lib/heygen";
import type { ApiErrorResponse, VoiceOption } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/heygen/voices — private (cloned) voices first, then English public voices. */
export async function GET() {
  if (!isHeygenConfigured()) return NextResponse.json({ error: "HeyGen is not configured on the server.", code: "heygen_not_configured" } satisfies ApiErrorResponse, { status: 503 });
  try {
    const voices = await listVoices();
    const out: VoiceOption[] = voices.map((v) => ({ id: v.voice_id, name: v.name, language: v.language, gender: v.gender, previewUrl: v.preview_audio_url, type: v.type }));
    return NextResponse.json({ voices: out }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof HeygenError) return NextResponse.json({ error: err.message, code: err.code } satisfies ApiErrorResponse, { status: err.httpStatus });
    return NextResponse.json({ error: "Could not list HeyGen voices." } satisfies ApiErrorResponse, { status: 500 });
  }
}
