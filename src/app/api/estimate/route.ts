import { NextResponse } from "next/server";
import { BACKDROP_MODEL, getAnimationModel } from "@/lib/models";
import { HiggsfieldError, estimateRaw, isConfigured } from "@/lib/higgsfield";
import { TAKES } from "@/lib/takes";
import type { ApiErrorResponse, EstimateResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/estimate?model=<id>&duration=<n>&aspectRatio=16:9 — credit estimate for one generation (backdrop + video). */
export async function GET(req: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "not configured", code: "not_configured" } satisfies ApiErrorResponse, { status: 503 });
  const url = new URL(req.url);
  const model = getAnimationModel(url.searchParams.get("model"));
  const duration = Number(url.searchParams.get("duration") || model.defaultDuration);
  const aspectRatio = url.searchParams.get("aspectRatio") === "9:16" ? "9:16" : "16:9";
  if (!model.durations.includes(duration)) return NextResponse.json({ error: "invalid duration" } satisfies ApiErrorResponse, { status: 400 });
  try {
    const [anim, back] = await Promise.all([
      estimateRaw(model.path, model.body({ imageUrl: TAKES[0].posterUrl, prompt: "estimate", duration, aspectRatio })),
      estimateRaw(BACKDROP_MODEL.path, BACKDROP_MODEL.body({ prompt: "estimate", aspectRatio })),
    ]);
    const total = Number(anim.credits) + Number(back.credits);
    const totalUsd = Number(anim.usd) + Number(back.usd);
    const body: EstimateResponse = {
      model: model.id,
      modelLabel: model.label,
      duration,
      animationCredits: anim.credits,
      animationUsd: anim.usd,
      backdropCredits: back.credits,
      backdropUsd: back.usd,
      totalCredits: Number.isFinite(total) ? total.toFixed(3) : "?",
      totalUsd: Number.isFinite(totalUsd) ? totalUsd.toFixed(3) : "?",
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return NextResponse.json({ error: err.message, code: err.code } satisfies ApiErrorResponse, { status: err.httpStatus });
    return NextResponse.json({ error: "estimate failed" } satisfies ApiErrorResponse, { status: 500 });
  }
}
