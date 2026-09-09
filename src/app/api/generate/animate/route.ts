import { NextResponse } from "next/server";
import { validateGenerateInput } from "@/lib/validation";
import { getTake } from "@/lib/takes";
import { buildAnimationPrompt, compositePresenter } from "@/lib/pipeline";
import { getAnimationModel } from "@/lib/models";
import { HiggsfieldError, getRequestStatus, isConfigured, submitRaw, uploadFile } from "@/lib/higgsfield";
import type { ApiErrorResponse, GenerateResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Stage 2 of a generation. Given a completed backdrop request, composites the
 * presenter cutout over the backdrop, uploads the frame through the Files API,
 * and submits the video model with the dialogue prompt.
 */
export async function POST(req: Request) {
  let json: Record<string, unknown>;
  try {
    json = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, { error: "Request body must be JSON.", code: "invalid_json" });
  }
  const backdropRequestId = typeof json.backdropRequestId === "string" ? json.backdropRequestId : "";
  if (!REQUEST_ID_RE.test(backdropRequestId)) return error(400, { error: "backdropRequestId is required.", code: "validation", fieldErrors: { backdropRequestId: "Missing or invalid." } });

  const result = validateGenerateInput({ ...json, mock: false });
  if (!result.ok) return error(400, { error: "Please fix the highlighted fields.", code: "validation", fieldErrors: result.errors });
  const input = result.value;
  const take = getTake(input.mediaId)!;
  const model = getAnimationModel(input.model);
  if (!isConfigured()) return error(503, { error: "Higgsfield credentials are not configured on the server.", code: "not_configured" });

  try {
    // The backdrop URL is read from Higgsfield, never from the client.
    const backdrop = await getRequestStatus(backdropRequestId);
    if (backdrop.status !== "completed") return error(409, { error: `The backdrop request is ${backdrop.status}, not completed.`, code: "not_ready" });
    const backdropUrl = backdrop.images?.[0]?.url;
    if (!backdropUrl) return error(502, { error: "The backdrop request completed without an image.", code: "upstream" });

    const png = await compositePresenter(backdropUrl, take, input.aspectRatio);
    const compositeUrl = await uploadFile(png, "image/png");

    const prompt = buildAnimationPrompt(take, input.scene, input.dialogue, model.speech);
    const submitted = await submitRaw(model.path, model.body({ imageUrl: compositeUrl, prompt, duration: input.duration, aspectRatio: input.aspectRatio }));
    if (!submitted?.request_id) return error(502, { error: "Higgsfield accepted the video request but did not return a request ID.", code: "upstream" });

    const body: GenerateResponse = {
      requestId: submitted.request_id,
      status: submitted.status ?? "queued",
      stage: "video",
      mock: false,
      model: model.path,
      modelLabel: model.label,
      prompt,
      take: { id: take.id, label: take.label, outfit: take.outfit },
      pipeline: { mediaId: take.id, scene: input.scene, dialogue: input.dialogue, duration: input.duration, aspectRatio: input.aspectRatio, model: model.id },
      submittedAt: new Date().toISOString(),
      compositeUrl,
    };
    return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return error(err.httpStatus, { error: err.message, code: err.code });
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("animate: unexpected error", msg);
    return error(500, { error: `Could not prepare the video request: ${msg}`, code: "internal" });
  }
}
