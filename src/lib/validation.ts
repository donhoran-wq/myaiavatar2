import { getTake } from "./takes";

export const DURATIONS = ["4", "6", "8"] as const;
export const RESOLUTIONS = ["720", "1080"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16"] as const;

export type Duration = (typeof DURATIONS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const LIMITS = {
  sceneMin: 3,
  sceneMax: 600,
  dialogueMin: 1,
  dialogueMax: 500,
};

export interface GenerateInput {
  mediaId: string;
  scene: string;
  dialogue: string;
  duration: Duration;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  mock: boolean;
}

export type ValidationResult =
  | { ok: true; value: GenerateInput }
  | { ok: false; errors: Record<string, string> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateGenerateInput(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const mediaId = str(b.mediaId);
  if (!mediaId) errors.mediaId = "Select a take.";
  else if (!UUID_RE.test(mediaId)) errors.mediaId = "Media ID must be a UUID.";
  else if (!getTake(mediaId)) errors.mediaId = "Unknown take. Only the pre-registered avatar takes can be used.";

  const scene = str(b.scene);
  if (scene.length < LIMITS.sceneMin) errors.scene = `Describe the backdrop or scene (at least ${LIMITS.sceneMin} characters).`;
  else if (scene.length > LIMITS.sceneMax) errors.scene = `Scene description must be ${LIMITS.sceneMax} characters or fewer.`;

  const dialogue = str(b.dialogue).replace(/\s+/g, " ");
  if (dialogue.length < LIMITS.dialogueMin) errors.dialogue = "Enter the dialogue the avatar should speak.";
  else if (dialogue.length > LIMITS.dialogueMax) errors.dialogue = `Dialogue must be ${LIMITS.dialogueMax} characters or fewer.`;

  const duration = str(b.duration) || "8";
  if (!(DURATIONS as readonly string[]).includes(duration)) errors.duration = `Duration must be one of ${DURATIONS.join(", ")} seconds.`;

  const resolution = str(b.resolution) || "720";
  if (!(RESOLUTIONS as readonly string[]).includes(resolution)) errors.resolution = `Resolution must be one of ${RESOLUTIONS.join(", ")}.`;

  const aspectRatio = str(b.aspectRatio) || "16:9";
  if (!(ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) errors.aspectRatio = `Aspect ratio must be one of ${ASPECT_RATIOS.join(", ")}.`;

  const mock = b.mock === true;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      mediaId,
      scene,
      dialogue,
      duration: duration as Duration,
      resolution: resolution as Resolution,
      aspectRatio: aspectRatio as AspectRatio,
      mock,
    },
  };
}
