import { NextResponse } from "next/server";
import { HiggsfieldError, isConfigured, probeModelPath, resolveBase } from "@/lib/higgsfield";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,120}$/;

/**
 * Diagnostic endpoint for discovering which model paths exist and what they
 * accept. GET sends an empty body; POST forwards the given JSON body. Callers
 * must include deliberately invalid values so the upstream validation rejects
 * the request; a fully valid body would start a real generation.
 */
async function handle(req: Request, body: string) {
  if (!isConfigured()) return NextResponse.json({ error: "not configured", code: "not_configured" }, { status: 503 });
  const url = new URL(req.url);
  const path = (url.searchParams.get("path") || "").replace(/^\/+/, "");
  const base = url.searchParams.get("base") ?? undefined;
  if (!PATH_RE.test(path) || path.startsWith("requests/")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  try {
    const result = await probeModelPath(path, base, body);
    return NextResponse.json({ base: resolveBase(base), path, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HiggsfieldError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    return NextResponse.json({ error: "probe failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req, "{}");
}

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 4096) return NextResponse.json({ error: "body too large" }, { status: 413 });
  try {
    JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  return handle(req, text);
}
