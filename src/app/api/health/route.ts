import { NextResponse } from "next/server";
import { getModelPath, isConfigured } from "@/lib/higgsfield";
import { TAKES } from "@/lib/takes";
import type { HealthResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export function GET() {
  const body: HealthResponse = {
    ok: true,
    higgsfieldConfigured: isConfigured(),
    model: getModelPath(),
    takes: TAKES.length,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
