import { NextResponse } from "next/server";
import { HiggsfieldError, isConfigured, listModels, resolveBase } from "@/lib/higgsfield";
import type { ApiErrorResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_QUERY = ["page", "size", "limit", "offset", "output_type", "operation_type", "type", "q"];

/**
 * Lists the generation models available to the configured Higgsfield account
 * (GET https://api.higgsfield.ai/models). Used to verify the configured model
 * path. Returns only model metadata; never credentials.
 */
export async function GET(req: Request) {
  if (!isConfigured()) {
    const body: ApiErrorResponse = { error: "Higgsfield credentials are not configured on the server.", code: "not_configured" };
    return NextResponse.json(body, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(req.url);
  const qs = new URLSearchParams();
  for (const k of ALLOWED_QUERY) {
    const v = url.searchParams.get(k);
    if (v && /^[A-Za-z0-9_.,-]{1,40}$/.test(v)) qs.set(k, v);
  }
  const base = url.searchParams.get("base") ?? undefined;
  try {
    const models = await listModels(qs.toString(), base);
    return NextResponse.json({ base: resolveBase(base), query: qs.toString() || null, models }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) {
      return NextResponse.json({ error: err.message, code: err.code } satisfies ApiErrorResponse, { status: err.httpStatus, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Unexpected server error while listing models.", code: "internal" } satisfies ApiErrorResponse, { status: 500 });
  }
}
