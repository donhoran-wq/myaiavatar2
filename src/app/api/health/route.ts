import { NextResponse } from "next/server";
import { getModelAvailability, getModelPath, isConfigured } from "@/lib/higgsfield";
import { TAKES } from "@/lib/takes";
import type { HealthResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const availability = await getModelAvailability();
  const body: HealthResponse = {
    ok: true,
    higgsfieldConfigured: isConfigured(),
    model: getModelPath(),
    modelAvailable: availability.configuredModelAvailable,
    videoModels: availability.videoModels,
    totalModels: availability.totalModels,
    takes: TAKES.length,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
