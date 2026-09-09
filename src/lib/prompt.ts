import type { Take } from "./takes";

/**
 * Builds the generation prompt. The reference image (a still from the selected
 * green-screen take) carries the presenter identity and outfit; the prompt
 * instructs the model to keep both, replace the green screen with the requested
 * scene, and speak the dialogue verbatim.
 */
export function buildPrompt(take: Take, scene: string, dialogue: string): string {
  const cleanDialogue = dialogue.replace(/"/g, "'").trim();
  return [
    `Talking-head presenter video. The person in the reference image is the presenter: keep their exact face, hair, skin tone, body and outfit (${take.outfit}) unchanged.`,
    `The reference was filmed on a green screen. Remove the green screen entirely and place the presenter in this scene instead: ${scene.trim()}.`,
    `Framing: ${take.pose === "seated" ? "seated" : "standing"}, medium shot, facing camera, natural lighting that matches the new scene, steady camera, no text overlays, no subtitles.`,
    `The presenter looks at the camera and says exactly, with clear natural lip-sync and no other speech: "${cleanDialogue}"`,
  ].join(" ");
}
