import { Studio } from "@/components/Studio";
import { TAKES, PRESENTER_LABELS } from "@/lib/takes";
import { checkPathAvailability, isConfigured } from "@/lib/higgsfield";
import { ANIMATION_MODELS, BACKDROP_MODEL, DEFAULT_ANIMATION_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function Page() {
  const takes = TAKES.map((t) => ({
    id: t.id,
    label: t.label,
    presenter: t.presenter,
    presenterLabel: PRESENTER_LABELS[t.presenter],
    outfit: t.outfit,
    pose: t.pose,
    note: t.note ?? null,
    videoUrl: t.videoUrl,
    posterUrl: t.posterUrl,
    durationSeconds: t.durationSeconds,
  }));
  const models = Object.values(ANIMATION_MODELS).map((m) => ({ id: m.id, label: m.label, path: m.path, speech: m.speech, durations: m.durations, defaultDuration: m.defaultDuration }));
  const configured = isConfigured();
  const [anim, back] = configured
    ? await Promise.all([checkPathAvailability(ANIMATION_MODELS[DEFAULT_ANIMATION_MODEL].path), checkPathAvailability(BACKDROP_MODEL.path)])
    : [null, null];
  const modelAvailable = anim && back ? (anim.available === false || back.available === false ? false : anim.available && back.available ? true : null) : null;
  return <Studio takes={takes} models={models} defaultModel={DEFAULT_ANIMATION_MODEL} configured={configured} modelAvailable={modelAvailable} backdropModel={BACKDROP_MODEL.path} />;
}
