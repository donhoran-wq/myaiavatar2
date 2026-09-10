import { NextResponse } from "next/server";
import { validateGenerateInput } from "@/lib/validation";
import { getTake } from "@/lib/takes";
import { buildBackdropPrompt } from "@/lib/pipeline";
import { BACKDROP_MODEL, getAnimationModel } from "@/lib/models";
import { HiggsfieldError, isConfigured, submitRaw } from "@/lib/higgsfield";
import { isHeygenConfigured } from "@/lib/heygen";
import { makeMockRequestId } from "@/lib/mock";
import type { ApiErrorResponse, GenerateResponse, PipelineParams } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Stage 1 of a generation. Validates the request and, for real runs, submits
 * the backdrop (scene plate) image request to Higgsfield. Both engines use it:
 * Higgsfield animates the composited frame; HeyGen animates it (image mode) or
 * uses the plate as the background behind one of the account's looks.
 */
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
  const model = getAnimationModel(input.model);
  const pipeline: PipelineParams = {
    engine: input.engine,
    mediaId: take.id,
    scene: input.scene,
    dialogue: input.dialogue,
    duration: input.duration,
    aspectRatio: input.aspectRatio,
    model: model.id,
    backdropPrompt: input.backdropPrompt,
    heygenSource: input.heygenSource,
    heygenLookId: input.heygenLookId,
    heygenVoiceId: input.heygenVoiceId,
  };
  const submittedAt = new Date().toISOString();
  const videoModelLabel = input.engine === "heygen" ? (input.heygenSource === "look" ? "HeyGen avatar look (Avatar IV)" : "HeyGen image-to-video") : model.label;
  const videoModelPath = input.engine === "heygen" ? "heygen:v3/videos" : model.path;

  if (input.mock) {
    const body: GenerateResponse = {
      requestId: makeMockRequestId(take.id),
      status: "queued",
      stage: "mock",
      engine: input.engine,
      mock: true,
      model: `mock (would use ${BACKDROP_MODEL.path} then ${videoModelPath})`,
      modelLabel: videoModelLabel,
      prompt: buildBackdropPrompt(input.scene, input.backdropPrompt ?? undefined),
      take: { id: take.id, label: take.label, outfit: take.outfit },
      pipeline,
      submittedAt,
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
  if (input.engine === "heygen" && !isHeygenConfigured()) {
    return error(503, { error: "HeyGen is not configured on the server. Set the HEYGEN_API_KEY environment variable and redeploy.", code: "heygen_not_configured" });
  }

  try {
    const prompt = buildBackdropPrompt(input.scene, input.backdropPrompt ?? undefined);
    const submitted = await submitRaw(BACKDROP_MODEL.path, BACKDROP_MODEL.body({ prompt, aspectRatio: input.aspectRatio }));
    if (!submitted?.request_id) {
      return error(502, { error: "Higgsfield accepted the backdrop request but did not return a request ID.", code: "upstream" });
    }
    const body: GenerateResponse = {
      requestId: submitted.request_id,
      status: submitted.status ?? "queued",
      stage: "backdrop",
      engine: input.engine,
      mock: false,
      model: BACKDROP_MODEL.path,
      modelLabel: BACKDROP_MODEL.label,
      prompt,
      take: { id: take.id, label: take.label, outfit: take.outfit },
      pipeline,
      submittedAt,
    };
    return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return error(err.httpStatus, { error: err.message, code: err.code });
    console.error("generate: unexpected error", err instanceof Error ? err.message : err);
    return error(500, { error: "Unexpected server error while submitting the backdrop generation.", code: "internal" });
  }
}
