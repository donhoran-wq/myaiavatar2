import { getTake } from "./takes";
import { ANIMATION_MODELS, DEFAULT_ANIMATION_MODEL, getAnimationModel } from "./models";
import type { Engine } from "./api-types";

export const ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const LIMITS = {
  sceneMin: 3,
  sceneMax: 600,
  dialogueMin: 1,
  /** Higgsfield video models speak a short line; HeyGen renders up to 30 minutes. */
  dialogueMax: { higgsfield: 500, heygen: 5000 } as Record<Engine, number>,
  backdropPromptMax: 800,
};

export interface GenerateInput {
  engine: Engine;
  mediaId: string;
  scene: string;
  dialogue: string;
  duration: number;
  aspectRatio: AspectRatio;
  model: string;
  backdropPrompt: string | null;
  heygenSource: "image" | "look";
  heygenLookId: string | null;
  heygenVoiceId: string | null;
  mock: boolean;
}

export type ValidationResult =
  | { ok: true; value: GenerateInput }
  | { ok: false; errors: Record<string, string> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateGenerateInput(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const engineRaw = str(b.engine) || "higgsfield";
  if (engineRaw !== "higgsfield" && engineRaw !== "heygen") errors.engine = "Engine must be higgsfield or heygen.";
  const engine: Engine = engineRaw === "heygen" ? "heygen" : "higgsfield";

  const mediaId = str(b.mediaId);
  if (!mediaId) errors.mediaId = "Select a take.";
  else if (!UUID_RE.test(mediaId)) errors.mediaId = "Media ID must be a UUID.";
  else if (!getTake(mediaId)) errors.mediaId = "Unknown take. Only the pre-registered avatar takes can be used.";

  const scene = str(b.scene);
  if (scene.length < LIMITS.sceneMin) errors.scene = `Describe the backdrop or scene (at least ${LIMITS.sceneMin} characters).`;
  else if (scene.length > LIMITS.sceneMax) errors.scene = `Scene description must be ${LIMITS.sceneMax} characters or fewer.`;

  const dialogue = str(b.dialogue).replace(/[ \t]+/g, " ");
  const dialogueMax = LIMITS.dialogueMax[engine];
  if (dialogue.length < LIMITS.dialogueMin) errors.dialogue = "Enter the dialogue the avatar should speak.";
  else if (dialogue.length > dialogueMax) errors.dialogue = `Dialogue must be ${dialogueMax} characters or fewer for the ${engine === "heygen" ? "HeyGen" : "Higgsfield"} engine.`;

  const modelId = str(b.model) || DEFAULT_ANIMATION_MODEL;
  if (!(modelId in ANIMATION_MODELS)) errors.model = `Model must be one of ${Object.keys(ANIMATION_MODELS).join(", ")}.`;
  const model = getAnimationModel(modelId);

  let rawDuration = model.defaultDuration;
  if (engine === "higgsfield") {
    rawDuration = b.duration === undefined || b.duration === "" ? model.defaultDuration : Number(b.duration);
    if (!Number.isInteger(rawDuration) || !model.durations.includes(rawDuration)) {
      errors.duration = `Duration must be one of ${model.durations.join(", ")} seconds for ${model.label} (the model's maximum is ${Math.max(...model.durations)} s).`;
    }
  }

  const aspectRatio = str(b.aspectRatio) || "16:9";
  if (!(ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) errors.aspectRatio = `Aspect ratio must be one of ${ASPECT_RATIOS.join(", ")}.`;

  const backdropPrompt = str(b.backdropPrompt);
  if (backdropPrompt.length > LIMITS.backdropPromptMax) errors.backdropPrompt = `Custom backdrop prompt must be ${LIMITS.backdropPromptMax} characters or fewer.`;

  const heygenSourceRaw = str(b.heygenSource) || "image";
  if (heygenSourceRaw !== "image" && heygenSourceRaw !== "look") errors.heygenSource = "HeyGen source must be image or look.";
  const heygenSource = heygenSourceRaw === "look" ? "look" : "image";
  const heygenLookId = str(b.heygenLookId) || null;
  const heygenVoiceId = str(b.heygenVoiceId) || null;
  if (engine === "heygen") {
    if (heygenSource === "look" && (!heygenLookId || !HEX_ID_RE.test(heygenLookId))) errors.heygenLookId = "Choose one of your HeyGen looks.";
    if (heygenVoiceId && !HEX_ID_RE.test(heygenVoiceId)) errors.heygenVoiceId = "Invalid voice ID.";
  }

  const mock = b.mock === true;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      engine,
      mediaId,
      scene,
      dialogue,
      duration: rawDuration,
      aspectRatio: aspectRatio as AspectRatio,
      model: model.id,
      backdropPrompt: backdropPrompt || null,
      heygenSource,
      heygenLookId,
      heygenVoiceId,
      mock,
    },
  };
}
