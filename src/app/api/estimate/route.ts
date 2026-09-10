import { NextResponse } from "next/server";
import { BACKDROP_MODEL, getAnimationModel } from "@/lib/models";
import { HiggsfieldError, estimateRaw, isConfigured } from "@/lib/higgsfield";
import { HeygenError, getMe, isHeygenConfigured } from "@/lib/heygen";
import { TAKES } from "@/lib/takes";
import type { ApiErrorResponse, EstimateResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/estimate?engine=higgsfield|heygen&model=<id>&duration=<n>&aspectRatio=16:9
 * Higgsfield: exact credit estimate for backdrop + video. HeyGen: backdrop estimate
 * plus the wallet balance (HeyGen bills per minute of rendered video; no estimate endpoint).
 */
export async function GET(req: Request) {
  if (!isConfigured()) return NextResponse.json({ error: "not configured", code: "not_configured" } satisfies ApiErrorResponse, { status: 503 });
  const url = new URL(req.url);
  const engine = url.searchParams.get("engine") === "heygen" ? "heygen" : "higgsfield";
  const model = getAnimationModel(url.searchParams.get("model"));
  const duration = Number(url.searchParams.get("duration") || model.defaultDuration);
  const aspectRatio = url.searchParams.get("aspectRatio") === "9:16" ? "9:16" : "16:9";
  if (engine === "higgsfield" && !model.durations.includes(duration)) return NextResponse.json({ error: "invalid duration" } satisfies ApiErrorResponse, { status: 400 });
  try {
    const back = await estimateRaw(BACKDROP_MODEL.path, BACKDROP_MODEL.body({ prompt: "estimate", aspectRatio }));
    if (engine === "heygen") {
      if (!isHeygenConfigured()) return NextResponse.json({ error: "HeyGen is not configured on the server.", code: "heygen_not_configured" } satisfies ApiErrorResponse, { status: 503 });
      const me = await getMe();
      const wallet = typeof me.wallet?.remaining_balance === "number" ? me.wallet.remaining_balance : null;
      const body: EstimateResponse = {
        engine,
        model: "heygen",
        modelLabel: "HeyGen (long-form)",
        duration: 0,
        animationCredits: "n/a",
        animationUsd: "n/a",
        backdropCredits: back.credits,
        backdropUsd: back.usd,
        totalCredits: back.credits,
        totalUsd: back.usd,
        note: "HeyGen bills per minute of rendered video from the HeyGen wallet; the Higgsfield backdrop is charged separately.",
        walletUsd: wallet,
      };
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }
    const anim = await estimateRaw(model.path, model.body({ imageUrl: TAKES[0].posterUrl, prompt: "estimate", duration, aspectRatio }));
    const total = Number(anim.credits) + Number(back.credits);
    const totalUsd = Number(anim.usd) + Number(back.usd);
    const body: EstimateResponse = {
      engine,
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
    if (err instanceof HiggsfieldError || err instanceof HeygenError) return NextResponse.json({ error: err.message, code: err.code } satisfies ApiErrorResponse, { status: err.httpStatus });
    return NextResponse.json({ error: "estimate failed" } satisfies ApiErrorResponse, { status: 500 });
  }
}
