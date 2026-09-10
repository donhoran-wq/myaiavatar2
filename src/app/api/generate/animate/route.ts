import { NextResponse } from "next/server";
import { validateGenerateInput } from "@/lib/validation";
import { getTake } from "@/lib/takes";
import { buildAnimationPrompt, compositePresenter } from "@/lib/pipeline";
import { getAnimationModel } from "@/lib/models";
import { HiggsfieldError, getRequestStatus, isConfigured, submitRaw, uploadFile } from "@/lib/higgsfield";
import { HeygenError, createImageVideo, createLookVideo, isHeygenConfigured, listPrivateLooks, listVoices, toHeygenRequestId } from "@/lib/heygen";
import type { ApiErrorResponse, GenerateResponse, PipelineParams } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

function error(status: number, body: ApiErrorResponse) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Picks the voice: explicit choice → the look's default → first private voice → first English male → first voice. */
async function resolveVoice(explicit: string | null, lookDefault: string | null): Promise<string> {
  if (explicit) return explicit;
  if (lookDefault) return lookDefault;
  const voices = await listVoices();
  const pick = voices.find((v) => v.type === "private") ?? voices.find((v) => /male/i.test(v.gender) && !/female/i.test(v.gender)) ?? voices[0];
  if (!pick) throw new HeygenError("No HeyGen voices are available on this account.", 502, "upstream");
  return pick.voice_id;
}

/**
 * Stage 2 of a generation. Given a completed backdrop request, composites the
 * presenter cutout over the backdrop, uploads the frame through the Files API,
 * and submits the video model with the dialogue (Higgsfield or HeyGen).
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
  if (input.engine === "heygen" && !isHeygenConfigured()) return error(503, { error: "HeyGen is not configured on the server.", code: "heygen_not_configured" });

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

  try {
    // The backdrop URL is read from Higgsfield, never from the client.
    const backdrop = await getRequestStatus(backdropRequestId);
    if (backdrop.status !== "completed") return error(409, { error: `The backdrop request is ${backdrop.status}, not completed.`, code: "not_ready" });
    const backdropUrl = backdrop.images?.[0]?.url;
    if (!backdropUrl) return error(502, { error: "The backdrop request completed without an image.", code: "upstream" });

    const title = `Avatar Studio · ${take.label} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

    // HeyGen with one of the account's own looks: no compositing, the plate is the background.
    if (input.engine === "heygen" && input.heygenSource === "look") {
      const looks = await listPrivateLooks();
      const look = looks.find((l) => l.id === input.heygenLookId);
      if (!look) return error(400, { error: "That HeyGen look was not found on the account.", code: "validation", fieldErrors: { heygenLookId: "Unknown look." } });
      const voiceId = await resolveVoice(input.heygenVoiceId, look.default_voice_id);
      const videoId = await createLookVideo({ lookId: look.id, backgroundUrl: backdropUrl, script: input.dialogue, voiceId, aspectRatio: input.aspectRatio, title });
      const body: GenerateResponse = {
        requestId: toHeygenRequestId(videoId),
        status: "queued",
        stage: "video",
        engine: "heygen",
        mock: false,
        model: "heygen:v3/videos (avatar, avatar_iv)",
        modelLabel: `HeyGen look · ${look.name}`,
        prompt: input.dialogue,
        take: { id: take.id, label: take.label, outfit: take.outfit },
        pipeline: { ...pipeline, heygenVoiceId: voiceId },
        submittedAt: new Date().toISOString(),
      };
      return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const png = await compositePresenter(backdropUrl, take, input.aspectRatio);
    const compositeUrl = await uploadFile(png, "image/png");

    if (input.engine === "heygen") {
      const voiceId = await resolveVoice(input.heygenVoiceId, null);
      const videoId = await createImageVideo({ imageUrl: compositeUrl, script: input.dialogue, voiceId, aspectRatio: input.aspectRatio, title });
      const body: GenerateResponse = {
        requestId: toHeygenRequestId(videoId),
        status: "queued",
        stage: "video",
        engine: "heygen",
        mock: false,
        model: "heygen:v3/videos (image)",
        modelLabel: "HeyGen image-to-video",
        prompt: input.dialogue,
        take: { id: take.id, label: take.label, outfit: take.outfit },
        pipeline: { ...pipeline, heygenVoiceId: voiceId },
        submittedAt: new Date().toISOString(),
        compositeUrl,
      };
      return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const prompt = buildAnimationPrompt(take, input.scene, input.dialogue, model.speech);
    const submitted = await submitRaw(model.path, model.body({ imageUrl: compositeUrl, prompt, duration: input.duration, aspectRatio: input.aspectRatio }));
    if (!submitted?.request_id) return error(502, { error: "Higgsfield accepted the video request but did not return a request ID.", code: "upstream" });

    const body: GenerateResponse = {
      requestId: submitted.request_id,
      status: submitted.status ?? "queued",
      stage: "video",
      engine: "higgsfield",
      mock: false,
      model: model.path,
      modelLabel: model.label,
      prompt,
      take: { id: take.id, label: take.label, outfit: take.outfit },
      pipeline,
      submittedAt: new Date().toISOString(),
      compositeUrl,
    };
    return NextResponse.json(body, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError || err instanceof HeygenError) return error(err.httpStatus, { error: err.message, code: err.code });
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("animate: unexpected error", msg);
    return error(500, { error: `Could not prepare the video request: ${msg}`, code: "internal" });
  }
}
