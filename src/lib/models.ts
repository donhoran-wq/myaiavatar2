/**
 * Generation models used by the studio, all reachable with the server API key
 * through the documented asynchronous request lifecycle. Availability was
 * verified against the account; use GET /api/models/probe to re-check.
 */

export interface AnimationModel {
  id: string;
  label: string;
  path: string;
  /** Generates speech/lip-sync from quoted dialogue in the prompt. */
  speech: boolean;
  durations: number[];
  defaultDuration: number;
  /** Build the request body for the model. */
  body: (input: { imageUrl: string; prompt: string; duration: number; aspectRatio: "16:9" | "9:16" }) => Record<string, unknown>;
}

export const ANIMATION_MODELS: Record<string, AnimationModel> = {
  "kling-3.0-pro": {
    id: "kling-3.0-pro",
    label: "Kling 3.0 Pro (native speech)",
    path: "kling-video/v3.0/pro/image-to-video",
    speech: true,
    // Kling 3.0 accepts integer durations from 3 to 15 s (verified against the API); 15 s is the hard cap.
    durations: [5, 8, 10, 12, 15],
    defaultDuration: 5,
    body: ({ imageUrl, prompt, duration }) => ({ image_url: imageUrl, prompt, duration, sound: "on", cfg_scale: 0.5 }),
  },
  "kling-2.6-pro": {
    id: "kling-2.6-pro",
    label: "Kling 2.6 Pro (native speech)",
    path: "kling-video/v2.6/pro/image-to-video",
    speech: true,
    durations: [5, 10],
    defaultDuration: 5,
    body: ({ imageUrl, prompt, duration }) => ({ image_url: imageUrl, prompt, duration, sound: "on", cfg_scale: 0.5 }),
  },
  "hailuo-2.3-pro": {
    id: "hailuo-2.3-pro",
    label: "Hailuo 2.3 Pro (no speech, motion only)",
    path: "minimax/hailuo-2.3/pro/image-to-video",
    speech: false,
    durations: [6, 10],
    defaultDuration: 6,
    body: ({ imageUrl, prompt, duration }) => ({ image_url: imageUrl, prompt, duration }),
  },
};

export const DEFAULT_ANIMATION_MODEL = "kling-3.0-pro";

export function getAnimationModel(id?: string | null): AnimationModel {
  const key = id && id in ANIMATION_MODELS ? id : DEFAULT_ANIMATION_MODEL;
  return ANIMATION_MODELS[key];
}

/** Backdrop (scene plate) generation: Soul 2 text-to-image. */
export const BACKDROP_MODEL = {
  id: "soul-2",
  label: "Soul 2 (backdrop image)",
  path: "higgsfield-ai/soul/v2/standard",
  body: (input: { prompt: string; aspectRatio: "16:9" | "9:16" }) => ({
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    resolution: "720p",
    batch_size: 1,
    // Soul's prompt enhancer leans towards portraits and tends to add people; keep the plate literal.
    enhance_prompt: false,
  }),
};

export const CANVAS: Record<"16:9" | "9:16", { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
};
