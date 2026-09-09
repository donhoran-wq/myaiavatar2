import { NextResponse } from "next/server";
import { TAKES, PRESENTER_LABELS } from "@/lib/takes";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    takes: TAKES.map((t) => ({
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
      width: t.width,
      height: t.height,
    })),
  });
}
