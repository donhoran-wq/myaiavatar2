import { NextResponse } from "next/server";
import { checkPathAvailability, isConfigured } from "@/lib/higgsfield";
import { isHeygenConfigured } from "@/lib/heygen";
import { BACKDROP_MODEL, getAnimationModel } from "@/lib/models";
import { TAKES } from "@/lib/takes";
import type { HealthResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const model = getAnimationModel();
  const [anim, back] = await Promise.all([checkPathAvailability(model.path), checkPathAvailability(BACKDROP_MODEL.path)]);
  const body: HealthResponse = {
    ok: true,
    higgsfieldConfigured: isConfigured(),
    heygenConfigured: isHeygenConfigured(),
    model: model.id,
    modelPath: model.path,
    modelAvailable: anim.available,
    backdropAvailable: back.available,
    takes: TAKES.length,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
