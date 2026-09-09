import { Studio } from "@/components/Studio";
import { TAKES, PRESENTER_LABELS } from "@/lib/takes";
import { getModelPath, isConfigured } from "@/lib/higgsfield";

export const dynamic = "force-dynamic";

export default function Page() {
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
  return <Studio takes={takes} configured={isConfigured()} model={getModelPath()} />;
}
