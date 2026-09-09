import { NextResponse } from "next/server";
import { validateGenerateInput } from "@/lib/validation";
import { getTake } from "@/lib/takes";
import { buildPrompt } from "@/lib/prompt";
import { HiggsfieldError, getModelPath, isConfigured, submitGeneration } from "@/lib/higgsfield";
import { makeMockRequestId } from "@/lib/mock";
import type { ApiErrorResponse, GenerateResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return error(400, { error: "Request body must be JSON.", code: "invalid_json" });
  }

  const result = validateGenerateInput(json);
  if (!result.ok) {
    return error(400, { error: "Please fix the highlighted fields.", code: "validation", fieldErrors: result.errors });
  }
  const input = result.value;
  const take = getTake(input.mediaId)!;
  const prompt = buildPrompt(take, input.scene, input.dialogue);
  const model = getModelPath();

  if (input.mock) {
    const body: GenerateResponse = {
      requestId: makeMockRequestId(take.id),
      status: "queued",
      mock: true,
      model: `mock (would use ${model})`,
      prompt,
      take: { id: take.id, label: take.label, outfit: take.outfit },
      submittedAt: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  if (!isConfigured()) {
    return error(503, {
      error:
        "Higgsfield credentials are not configured on the server. Set the higgsfieldapi and higgsfieldkey environment variables (or HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET) and redeploy.",
      code: "not_configured",
    });
  }

  try {
    const submitted = await submitGeneration({
      prompt,
      image_urls: [take.posterUrl],
      duration: input.duration,
      resolution: input.resolution,
      aspect_ratio: input.aspectRatio,
      generate_audio: true,
    });
    if (!submitted?.request_id) {
      return error(502, { error: "Higgsfield accepted the request but did not return a request ID.", code: "upstream" });
    }
    const body: GenerateResponse = {
      requestId: submitted.request_id,
      status: submitted.status ?? "queued",
      mock: false,
      model,
      prompt,
      take: { id: take.id, label: take.label, outfit: take.outfit },
      submittedAt: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) {
      return error(err.httpStatus, { error: err.message, code: err.code });
    }
    console.error("generate: unexpected error", err instanceof Error ? err.message : err);
    return error(500, { error: "Unexpected server error while submitting the generation.", code: "internal" });
  }
}
