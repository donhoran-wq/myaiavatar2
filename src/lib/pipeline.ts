import "server-only";
import sharp from "sharp";
import type { Take } from "./takes";
import { CANVAS } from "./models";

/** Prompt for the backdrop plate: the requested scene with nobody in it. */
export function buildBackdropPrompt(scene: string): string {
  return [
    `Architectural interior photograph of an unoccupied location: ${scene.trim()}.`,
    "The space is completely empty: nobody is present, no people, no person, no figures, no mannequins, no portraits, no reflections of people, no text, no logos.",
    "Photorealistic, natural lighting, eye-level camera at standing height, medium-shot framing with clear open floor space in the centre of the frame.",
  ].join(" ");
}

/** Prompt for the animation model: keep the presenter, speak the dialogue verbatim. */
export function buildAnimationPrompt(take: Take, scene: string, dialogue: string, speech: boolean): string {
  const cleanDialogue = dialogue.replace(/"/g, "'").trim();
  const parts = [
    `A ${take.pose} presenter wearing ${take.outfit.toLowerCase()} stands in ${scene.trim()}, facing the camera.`,
    "Keep the presenter's face, hair, body and outfit exactly as in the image. Background stays static. Fixed camera, no zoom, no cuts, no text or captions.",
  ];
  if (speech) {
    parts.push(`The presenter looks into the camera and says, with clear natural lip-sync and no other speech: "${cleanDialogue}"`);
  } else {
    parts.push("The presenter talks naturally to the camera with subtle head movement and hand gestures.");
  }
  return parts.join(" ");
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchBytes(url: string, what: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Could not fetch the ${what} (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Places the presenter cutout (transparent PNG keyed from the selected take)
 * over the generated backdrop and returns a PNG sized for the aspect ratio.
 */
export async function compositePresenter(backdropUrl: string, take: Take, aspectRatio: "16:9" | "9:16"): Promise<Buffer> {
  const { width, height } = CANVAS[aspectRatio];
  const [backdrop, cutout] = await Promise.all([fetchBytes(backdropUrl, "backdrop image"), fetchBytes(take.cutoutUrl, "presenter cutout")]);
  const plate = await sharp(backdrop).resize(width, height, { fit: "cover", position: "centre" }).toBuffer();
  const person = await sharp(cutout).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer();
  return sharp(plate).composite([{ input: person, left: 0, top: 0 }]).png({ compressionLevel: 6 }).toBuffer();
}
