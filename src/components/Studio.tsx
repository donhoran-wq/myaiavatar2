"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiErrorResponse, Engine, EstimateResponse, GenerateResponse, JobStatus, LookOption, PipelineParams, Stage, StatusResponse, VoiceOption } from "@/lib/api-types";

export interface TakeCardData {
  id: string;
  label: string;
  presenter: string;
  presenterLabel: string;
  outfit: string;
  pose: "standing" | "seated";
  note: string | null;
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
}

export interface ModelOption {
  id: string;
  label: string;
  path: string;
  speech: boolean;
  durations: number[];
  defaultDuration: number;
}

interface Job {
  requestId: string;
  status: JobStatus;
  stage: Stage;
  engine: Engine;
  mock: boolean;
  model: string;
  modelLabel: string;
  prompt: string;
  takeLabel: string;
  pipeline: PipelineParams;
  submittedAt: string;
  videoUrl: string | null;
  imageUrl: string | null;
  compositeUrl: string | null;
  backdropUrl: string | null;
  downloadUrl: string | null;
  durationSeconds: number | null;
  error: string | null;
  lastChecked: string | null;
  polls: number;
  /** Set while the client is calling /api/generate/animate between stages. */
  advancing?: boolean;
}

const STORAGE_KEY = "avatar-studio:job";
const POLL_MS = 5000;
const POLL_MAX_MS = 45 * 60 * 1000;
const TERMINAL: JobStatus[] = ["completed", "failed", "nsfw", "canceled"];
const DIALOGUE_MAX: Record<Engine, number> = { higgsfield: 500, heygen: 5000 };

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  in_progress: "Generating",
  completed: "Completed",
  failed: "Failed",
  nsfw: "Rejected by moderation",
  canceled: "Canceled",
};

function loadJob(): Job | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Job) : null;
  } catch {
    return null;
  }
}

function saveJob(job: Job | null) {
  try {
    if (job) localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function jobFromGenerate(g: GenerateResponse, prev?: Job | null): Job {
  return {
    requestId: g.requestId,
    status: g.status,
    stage: g.stage,
    engine: g.engine,
    mock: g.mock,
    model: g.model,
    modelLabel: g.modelLabel,
    prompt: g.prompt,
    takeLabel: g.take.label,
    pipeline: g.pipeline,
    submittedAt: g.submittedAt,
    videoUrl: null,
    imageUrl: null,
    compositeUrl: g.compositeUrl ?? null,
    backdropUrl: prev?.imageUrl ?? null,
    downloadUrl: null,
    durationSeconds: null,
    error: null,
    lastChecked: null,
    polls: 0,
  };
}

export function Studio({
  takes,
  models,
  defaultModel,
  configured,
  heygenConfigured,
  modelAvailable,
  backdropModel,
}: {
  takes: TakeCardData[];
  models: ModelOption[];
  defaultModel: string;
  configured: boolean;
  heygenConfigured: boolean;
  modelAvailable: boolean | null;
  backdropModel: string;
}) {
  const realDisabled = !configured || modelAvailable === false;
  const [engine, setEngine] = useState<Engine>("higgsfield");
  const [selectedId, setSelectedId] = useState<string>(takes[0]?.id ?? "");
  const [presenterFilter, setPresenterFilter] = useState<string>("all");
  const [outfitFilter, setOutfitFilter] = useState<string>("all");
  const [scene, setScene] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [backdropPrompt, setBackdropPrompt] = useState("");
  const [modelId, setModelId] = useState(defaultModel);
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [heygenSource, setHeygenSource] = useState<"image" | "look">("image");
  const [lookId, setLookId] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [looks, setLooks] = useState<LookOption[] | null>(null);
  const [heygenLoadError, setHeygenLoadError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(realDisabled);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAck, setConfirmAck] = useState(false);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const advancingRef = useRef(false);

  useEffect(() => {
    // Rehydrate the last job from localStorage after mount (cannot be a lazy
    // initializer because the server render has no localStorage).
    const saved = loadJob();
    if (saved) setJob(saved);
  }, []);

  useEffect(() => {
    saveJob(job);
  }, [job]);

  // Load HeyGen voices and looks the first time the HeyGen engine is chosen.
  useEffect(() => {
    if (engine !== "heygen" || !heygenConfigured || voices !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const [vr, lr] = await Promise.all([fetch("/api/heygen/voices"), fetch("/api/heygen/looks")]);
        const vb = (await vr.json()) as { voices?: VoiceOption[] } & ApiErrorResponse;
        const lb = (await lr.json()) as { looks?: LookOption[] } & ApiErrorResponse;
        if (cancelled) return;
        if (!vr.ok) throw new Error(vb.error || "Could not load voices.");
        setVoices(vb.voices ?? []);
        setLooks(lr.ok ? (lb.looks ?? []) : []);
        setHeygenLoadError(null);
      } catch (err) {
        if (!cancelled) setHeygenLoadError(err instanceof Error ? err.message : "Could not load HeyGen options.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, heygenConfigured, voices]);

  const effectiveDuration = model.durations.includes(duration) ? duration : model.defaultDuration;
  const dialogueMax = DIALOGUE_MAX[engine];
  const selectedLook = looks?.find((l) => l.id === lookId) ?? null;
  const effectiveVoiceId = voiceId || (heygenSource === "look" ? (selectedLook?.defaultVoiceId ?? "") : "") || voices?.find((v) => v.type === "private")?.id || "";

  const presenters = useMemo(() => {
    const m = new Map<string, string>();
    takes.forEach((t) => m.set(t.presenter, t.presenterLabel));
    return [...m.entries()];
  }, [takes]);

  const outfits = useMemo(() => {
    const set = new Set<string>();
    takes.filter((t) => presenterFilter === "all" || t.presenter === presenterFilter).forEach((t) => set.add(t.outfit));
    return [...set];
  }, [takes, presenterFilter]);

  const effectiveOutfit = outfitFilter !== "all" && !outfits.includes(outfitFilter) ? "all" : outfitFilter;

  const visibleTakes = useMemo(
    () => takes.filter((t) => (presenterFilter === "all" || t.presenter === presenterFilter) && (effectiveOutfit === "all" || t.outfit === effectiveOutfit)),
    [takes, presenterFilter, effectiveOutfit],
  );

  const selected = takes.find((t) => t.id === selectedId) ?? null;

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollOnce = useCallback(async (requestId: string) => {
    const res = await fetch(`/api/status/${encodeURIComponent(requestId)}`, { cache: "no-store" });
    const body = (await res.json()) as StatusResponse | ApiErrorResponse;
    if (!res.ok) throw new Error((body as ApiErrorResponse).error || `Status check failed (HTTP ${res.status}).`);
    return body as StatusResponse;
  }, []);

  const applyStatus = useCallback((s: StatusResponse) => {
    setJob((prev) =>
      prev && prev.requestId === s.requestId
        ? {
            ...prev,
            status: s.status,
            videoUrl: s.videoUrl,
            imageUrl: s.imageUrl,
            downloadUrl: s.downloadUrl,
            durationSeconds: s.durationSeconds ?? prev.durationSeconds,
            error: s.error,
            lastChecked: s.checkedAt,
            polls: prev.polls + 1,
          }
        : prev,
    );
  }, []);

  /** Stage 2: backdrop finished → composite + submit the video model. */
  const advance = useCallback(async (current: Job) => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    setJob((prev) => (prev && prev.requestId === current.requestId ? { ...prev, advancing: true } : prev));
    try {
      const res = await fetch("/api/generate/animate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backdropRequestId: current.requestId, ...current.pipeline }),
      });
      const body = (await res.json()) as GenerateResponse | ApiErrorResponse;
      if (!res.ok) throw new Error((body as ApiErrorResponse).error || `Could not start the video stage (HTTP ${res.status}).`);
      const next = jobFromGenerate(body as GenerateResponse, current);
      setJob(next);
      setPollError(null);
    } catch (err) {
      setJob((prev) => (prev && prev.requestId === current.requestId ? { ...prev, advancing: false, error: err instanceof Error ? err.message : "Could not start the video stage." } : prev));
    } finally {
      advancingRef.current = false;
    }
  }, []);

  useEffect(() => {
    stopPolling();
    if (!job) return;
    if (job.advancing) return;
    if (TERMINAL.includes(job.status)) {
      if (job.stage === "backdrop" && job.status === "completed" && job.imageUrl && !job.error) void advance(job);
      return;
    }
    const startedAt = Date.parse(job.submittedAt);
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setPollError("Stopped polling after 45 minutes. Use “Check now” to refresh manually.");
        return;
      }
      try {
        const s = await pollOnce(job.requestId);
        if (cancelled) return;
        setPollError(null);
        applyStatus(s);
        if (!s.terminal) pollTimer.current = window.setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        setPollError(err instanceof Error ? err.message : "Status check failed.");
        pollTimer.current = window.setTimeout(tick, POLL_MS * 2);
      }
    };
    pollTimer.current = window.setTimeout(tick, job.polls === 0 ? 1500 : POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.requestId, job?.status, job?.advancing, job?.imageUrl]);

  const checkNow = async () => {
    if (!job) return;
    try {
      const s = await pollOnce(job.requestId);
      setPollError(null);
      applyStatus(s);
    } catch (err) {
      setPollError(err instanceof Error ? err.message : "Status check failed.");
    }
  };

  const validateLocally = (): boolean => {
    const errs: Record<string, string> = {};
    if (!selected) errs.mediaId = "Select a take.";
    if (scene.trim().length < 3) errs.scene = "Describe the backdrop or scene (at least 3 characters).";
    if (scene.trim().length > 600) errs.scene = "Scene description must be 600 characters or fewer.";
    if (!dialogue.trim()) errs.dialogue = "Enter the dialogue the avatar should speak.";
    if (dialogue.trim().length > dialogueMax) errs.dialogue = `Dialogue must be ${dialogueMax} characters or fewer.`;
    if (engine === "heygen" && heygenSource === "look" && !lookId) errs.heygenLookId = "Choose one of your HeyGen looks.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const loadEstimate = async () => {
    setEstimate(null);
    setEstimateError(null);
    try {
      const qs = new URLSearchParams({ engine, model: model.id, duration: String(effectiveDuration), aspectRatio });
      const res = await fetch(`/api/estimate?${qs}`, { cache: "no-store" });
      const body = (await res.json()) as EstimateResponse | ApiErrorResponse;
      if (!res.ok) throw new Error((body as ApiErrorResponse).error || "Estimate failed.");
      setEstimate(body as EstimateResponse);
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : "Estimate failed.");
    }
  };

  const onGenerateClick = () => {
    setFormError(null);
    if (!validateLocally()) return;
    if (dryRun) {
      void submit(true);
    } else {
      setConfirmAck(false);
      setConfirmOpen(true);
      void loadEstimate();
    }
  };

  const submit = async (mock: boolean) => {
    if (!selected) return;
    setSubmitting(true);
    setFormError(null);
    setPollError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine,
          mediaId: selected.id,
          scene,
          dialogue,
          duration: effectiveDuration,
          aspectRatio,
          model: model.id,
          backdropPrompt: backdropPrompt.trim() || undefined,
          heygenSource,
          heygenLookId: heygenSource === "look" ? lookId : undefined,
          heygenVoiceId: effectiveVoiceId || undefined,
          mock,
        }),
      });
      const body = (await res.json()) as GenerateResponse | ApiErrorResponse;
      if (!res.ok) {
        const e = body as ApiErrorResponse;
        if (e.fieldErrors) setFieldErrors(e.fieldErrors);
        setFormError(e.error || `Submission failed (HTTP ${res.status}).`);
        return;
      }
      setJob(jobFromGenerate(body as GenerateResponse));
      setConfirmOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error while submitting.");
    } finally {
      setSubmitting(false);
    }
  };

  const clearJob = () => {
    stopPolling();
    setJob(null);
    setPollError(null);
  };

  const busy = job !== null && !(TERMINAL.includes(job.status) && (job.stage !== "backdrop" || job.status !== "completed" || !!job.error));
  const heygenUnavailable = engine === "heygen" && !heygenConfigured;
  const wordEstimate = Math.max(1, Math.round(dialogue.trim().split(/\s+/).filter(Boolean).length / 2.5));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Avatar Studio</h1>
          <p className="mt-1 text-sm text-muted">Pick a green-screen take, describe the new scene, write the dialogue, and generate a cinematic clip (Higgsfield) or a long-form talk (HeyGen).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              !configured ? "border-warning/50 text-warning" : modelAvailable === false ? "border-danger/50 text-danger" : "border-success/40 text-success"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${!configured ? "bg-warning" : modelAvailable === false ? "bg-danger" : "bg-success"}`} />
            {!configured ? "Higgsfield credentials missing" : modelAvailable === false ? "Higgsfield: model not enabled" : "Higgsfield connected"}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${heygenConfigured ? "border-success/40 text-success" : "border-warning/50 text-warning"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${heygenConfigured ? "bg-success" : "bg-warning"}`} />
            {heygenConfigured ? "HeyGen connected" : "HeyGen key missing"}
          </span>
        </div>
      </header>

      {!configured && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          Higgsfield credentials are not set. Real generations are disabled until <code className="font-mono">higgsfieldapi</code> and <code className="font-mono">higgsfieldkey</code> are configured. Dry-run mode still works.
        </div>
      )}
      {configured && modelAvailable === false && (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          The video model <code className="font-mono">{model.path}</code> or the backdrop model <code className="font-mono">{backdropModel}</code> is not enabled for this Higgsfield API key. Real generations are disabled. Check <code className="font-mono">/api/health</code>.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">1. Choose a take</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted">Presenter</span>
                <select value={presenterFilter} onChange={(e) => setPresenterFilter(e.target.value)} className="rounded-md border border-border bg-panel-2 px-2 py-1">
                  <option value="all">All</option>
                  {presenters.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-muted">Outfit</span>
                <select value={effectiveOutfit} onChange={(e) => setOutfitFilter(e.target.value)} className="rounded-md border border-border bg-panel-2 px-2 py-1">
                  <option value="all">All</option>
                  {outfits.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {fieldErrors.mediaId && <p className="mb-2 text-xs text-danger">{fieldErrors.mediaId}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" role="listbox" aria-label="Avatar takes">
            {visibleTakes.map((t) => (
              <TakeCard key={t.id} take={t} selected={t.id === selectedId} onSelect={() => setSelectedId(t.id)} />
            ))}
            {visibleTakes.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted">No takes match those filters.</p>}
          </div>

          {selected && (
            <div className="mt-4 rounded-lg border border-border bg-panel-2 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent/20 px-2 py-0.5 font-medium text-accent">Selected</span>
                  <span className="font-medium">{selected.label}</span>
                  <span className="text-muted">· {selected.presenterLabel}</span>
                  <span className="text-muted">· {selected.outfit}</span>
                  <span className="text-muted">· {selected.pose}</span>
                </div>
                <span className="font-mono text-[10px] text-muted">{selected.id}</span>
              </div>
              <video key={selected.id} className="aspect-video w-full rounded-md bg-black" controls muted playsInline preload="metadata" poster={selected.posterUrl} src={selected.videoUrl} />
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">2. Engine</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <EngineCard active={engine === "higgsfield"} onClick={() => setEngine("higgsfield")} title="Cinematic" subtitle="Higgsfield · Kling 3.0 · up to 15 s" body="Generated motion and native speech. Best for short hero clips." />
              <EngineCard active={engine === "heygen"} onClick={() => setEngine("heygen")} title="Long-form" subtitle="HeyGen · up to 30 min" body="Audio-driven lip-sync, exact script, minutes long. Billed from your HeyGen wallet." disabled={!heygenConfigured} />
            </div>
            {heygenUnavailable && <p className="mt-2 text-xs text-warning">Set HEYGEN_API_KEY on the server to enable the long-form engine.</p>}
          </div>

          <div className="rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">3. Scene &amp; dialogue</h2>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Backdrop / scene</span>
              <textarea
                value={scene}
                onChange={(e) => setScene(e.target.value)}
                rows={3}
                maxLength={600}
                placeholder="e.g. A bright modern dental clinic reception with soft daylight, plants and a glass wall behind the presenter"
                className="w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="mt-1 flex justify-between text-xs text-muted">
                <span className="text-danger">{fieldErrors.scene}</span>
                <span>{scene.length}/600</span>
              </span>
            </label>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">{engine === "heygen" ? "Script (spoken exactly as written)" : "Dialogue (spoken exactly as written)"}</span>
              <textarea
                value={dialogue}
                onChange={(e) => setDialogue(e.target.value)}
                rows={engine === "heygen" ? 8 : 4}
                maxLength={dialogueMax}
                placeholder={engine === "heygen" ? "Paste the full script. HeyGen renders up to 30 minutes; roughly 150 words per minute." : "Hi, and welcome to our practice. Today I want to talk about..."}
                className="w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="mt-1 flex justify-between text-xs text-muted">
                <span className="text-danger">{fieldErrors.dialogue}</span>
                <span>
                  {dialogue.length}/{dialogueMax}
                  {engine === "heygen" && dialogue.trim() ? ` · ≈${wordEstimate} s of speech` : ""}
                </span>
              </span>
            </label>

            {engine === "higgsfield" ? (
              <div className="mt-3 grid grid-cols-[2fr_1fr_1fr] gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-muted">Video model</span>
                  <select
                    value={model.id}
                    onChange={(e) => {
                      const m = models.find((x) => x.id === e.target.value);
                      setModelId(e.target.value);
                      if (m) setDuration(m.defaultDuration);
                    }}
                    className="rounded-md border border-border bg-panel-2 px-2 py-1.5"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted">Duration</span>
                  <select value={effectiveDuration} onChange={(e) => setDuration(Number(e.target.value))} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                    {model.durations.map((d) => (
                      <option key={d} value={d}>
                        {d} s
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted">Aspect</span>
                  <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as "16:9" | "9:16")} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2 text-xs">
                <div className="grid grid-cols-[2fr_1fr] gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted">Presenter source</span>
                    <select value={heygenSource} onChange={(e) => setHeygenSource(e.target.value as "image" | "look")} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                      <option value="image">Selected take, composited over the backdrop</option>
                      <option value="look" disabled={!looks || looks.length === 0}>
                        One of your HeyGen looks{looks ? ` (${looks.length})` : ""}
                      </option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted">Aspect</span>
                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as "16:9" | "9:16")} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                    </select>
                  </label>
                </div>
                {heygenSource === "look" && (
                  <div>
                    <span className="text-muted">HeyGen look</span>
                    <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {(looks ?? []).map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setLookId(l.id)}
                          className={`overflow-hidden rounded-md border text-left ${lookId === l.id ? "border-accent ring-2 ring-accent/60" : "border-border hover:border-muted"}`}
                          title={l.name}
                        >
                          {l.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.previewUrl} alt={l.name} className="aspect-[3/4] w-full object-cover" />
                          ) : (
                            <div className="aspect-[3/4] w-full bg-panel-2" />
                          )}
                          <div className="truncate px-1.5 py-1 text-[10px]">{l.name}</div>
                        </button>
                      ))}
                    </div>
                    {fieldErrors.heygenLookId && <p className="mt-1 text-danger">{fieldErrors.heygenLookId}</p>}
                  </div>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-muted">Voice</span>
                  <select value={effectiveVoiceId} onChange={(e) => setVoiceId(e.target.value)} className="rounded-md border border-border bg-panel-2 px-2 py-1.5" disabled={!voices}>
                    {!voices && <option value="">Loading voices…</option>}
                    {voices?.filter((v) => v.type === "private").length ? (
                      <optgroup label="Your voices">
                        {voices.filter((v) => v.type === "private").map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.gender}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {voices && (
                      <optgroup label="HeyGen voices (English)">
                        {voices.filter((v) => v.type === "public").map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.gender} · {v.language}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {selectedLook?.defaultVoiceId && !voiceId && heygenSource === "look" && <span className="text-[10px] text-muted">Using the look&apos;s default voice unless you pick another.</span>}
                </label>
                {heygenLoadError && <p className="text-danger">{heygenLoadError}</p>}
              </div>
            )}
            {engine === "higgsfield" && !model.speech && <p className="mt-2 text-xs text-warning">This model does not generate speech. The dialogue is used for motion guidance only.</p>}
            {fieldErrors.duration && <p className="mt-2 text-xs text-danger">{fieldErrors.duration}</p>}

            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted">Advanced: custom backdrop prompt</summary>
              <textarea
                value={backdropPrompt}
                onChange={(e) => setBackdropPrompt(e.target.value)}
                rows={3}
                maxLength={800}
                placeholder="Leave empty to use the built-in backdrop prompt. If set, this exact text is sent to the backdrop image model instead."
                className="mt-2 w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-xs outline-none focus:border-accent"
              />
              {fieldErrors.backdropPrompt && <p className="mt-1 text-xs text-danger">{fieldErrors.backdropPrompt}</p>}
            </details>
          </div>

          <div className="rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">4. Generate</h2>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={dryRun} disabled={realDisabled} onChange={(e) => setDryRun(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Dry run (mock, no credits)</span>
                <span className="block text-xs text-muted">Exercises submit → poll → download without calling any provider. The result is the original take, clearly labelled as a mock.</span>
              </span>
            </label>

            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {engine === "heygen"
                ? "Real generations consume Higgsfield credits for the backdrop image and HeyGen wallet balance for the video (billed per minute). You will see the balances and be asked to confirm."
                : "Real generations consume Higgsfield credits (a backdrop image plus one video). You will see the estimated cost and be asked to confirm before anything is submitted."}
            </div>

            {formError && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}

            <button
              type="button"
              onClick={onGenerateClick}
              disabled={submitting || busy || !selected || heygenUnavailable}
              className="mt-3 w-full rounded-md bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : busy ? "A job is in progress…" : dryRun ? "Run dry-run generation" : engine === "heygen" ? "Generate long-form video (HeyGen)" : "Generate video (uses credits)"}
            </button>
          </div>

          <JobPanel job={job} pollError={pollError} onCheckNow={checkNow} onClear={clearJob} onRetryAdvance={() => job && void advance({ ...job, error: null })} />
        </section>
      </div>

      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <h3 id="confirm-title" className="text-lg font-semibold">
              {engine === "heygen" ? "Submit to Higgsfield + HeyGen?" : "Submit to Higgsfield?"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {engine === "heygen" ? (
                <>
                  This runs a backdrop image on Higgsfield (<span className="font-mono text-fg">{backdropModel}</span>) and then a long-form video on HeyGen, which bills your HeyGen wallet per minute of rendered video.
                </>
              ) : (
                <>
                  This runs two real generations: a backdrop image (<span className="font-mono text-fg">{backdropModel}</span>) and the video (<span className="font-mono text-fg">{model.path}</span>). Higgsfield charges credits for completed generations; failed or moderated requests are not charged.
                </>
              )}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Take</dt>
              <dd>
                {selected.label} · {selected.outfit}
              </dd>
              <dt className="text-muted">Video</dt>
              <dd>
                {engine === "heygen"
                  ? `HeyGen · ${heygenSource === "look" ? `look: ${selectedLook?.name ?? lookId}` : "composited take"} · ≈${wordEstimate} s · ${aspectRatio}`
                  : `${model.label} · ${effectiveDuration} s · ${aspectRatio}`}
              </dd>
              <dt className="text-muted">Dialogue</dt>
              <dd className="line-clamp-3">{dialogue}</dd>
              <dt className="text-muted">Cost</dt>
              <dd>
                {estimate ? (
                  engine === "heygen" ? (
                    <span>
                      Backdrop <span className="font-semibold text-warning">{estimate.backdropCredits} Higgsfield credits</span>; HeyGen wallet balance{" "}
                      <span className="font-semibold text-warning">{estimate.walletUsd !== null && estimate.walletUsd !== undefined ? `$${estimate.walletUsd.toFixed(2)}` : "unknown"}</span>. {estimate.note}
                    </span>
                  ) : (
                    <span>
                      <span className="font-semibold text-warning">{estimate.totalCredits} credits</span> (≈ ${estimate.totalUsd}) — video {estimate.animationCredits} + backdrop {estimate.backdropCredits}
                    </span>
                  )
                ) : estimateError ? (
                  <span className="text-danger">{estimateError}</span>
                ) : (
                  <span className="text-muted">Fetching estimate…</span>
                )}
              </dd>
            </dl>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmAck} onChange={(e) => setConfirmAck(e.target.checked)} className="mt-0.5" />
              <span>I understand this will consume credits / wallet balance.</span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-panel-2">
                Cancel
              </button>
              <button
                type="button"
                disabled={!confirmAck || submitting}
                onClick={() => void submit(false)}
                className="rounded-md bg-accent-strong px-3 py-2 text-sm font-semibold text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Confirm and generate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EngineCard({ active, onClick, title, subtitle, body, disabled }: { active: boolean; onClick: () => void; title: string; subtitle: string; body: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-accent bg-accent/10 ring-2 ring-accent/50" : "border-border hover:border-muted"}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        {active && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">Selected</span>}
      </div>
      <div className="mt-0.5 text-xs text-muted">{subtitle}</div>
      <div className="mt-1 text-xs">{body}</div>
    </button>
  );
}

function TakeCard({ take, selected, onSelect }: { take: TakeCardData; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  const stop = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      className={`group relative overflow-hidden rounded-lg border text-left transition ${selected ? "border-accent ring-2 ring-accent/60" : "border-border hover:border-muted"}`}
    >
      <div className="relative aspect-video bg-black">
        <video ref={ref} className="h-full w-full object-cover" muted playsInline loop preload="none" poster={take.posterUrl} src={take.videoUrl} aria-hidden="true" />
        {selected && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white shadow">Selected</span>}
        <span className="absolute bottom-1.5 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">{take.durationSeconds}s</span>
      </div>
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{take.label}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted">{take.pose}</span>
        </div>
        <div className="truncate text-xs text-muted">{take.outfit}</div>
        {take.note && <div className="truncate text-[11px] text-muted/80">{take.note}</div>}
      </div>
    </button>
  );
}

function JobPanel({
  job,
  pollError,
  onCheckNow,
  onClear,
  onRetryAdvance,
}: {
  job: Job | null;
  pollError: string | null;
  onCheckNow: () => void;
  onClear: () => void;
  onRetryAdvance: () => void;
}) {
  if (!job) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-panel/50 p-4 text-sm text-muted">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">5. Status</h2>
        No job yet. Submit a generation to track it here.
      </div>
    );
  }
  const terminal = TERMINAL.includes(job.status);
  const videoDone = job.status === "completed" && !!job.videoUrl;
  const failed = terminal && job.status !== "completed";
  const stageFailed = !!job.error && !job.advancing;
  const isLook = job.engine === "heygen" && job.pipeline.heygenSource === "look";
  let step: number;
  if (job.stage === "mock") step = job.status === "queued" ? 1 : job.status === "in_progress" ? 3 : 4;
  else if (job.stage === "backdrop") step = job.advancing ? 2 : job.status === "completed" && job.imageUrl ? 2 : 1;
  else step = videoDone ? 4 : 3;
  const steps = job.stage === "mock" ? ["Queued", "Mock", "Generating", "Done"] : ["Backdrop", isLook ? "Prepare" : "Composite", job.engine === "heygen" ? "HeyGen video" : "Video", "Done"];
  const stageLabel =
    job.stage === "mock"
      ? "Mock run"
      : job.stage === "backdrop"
        ? job.advancing
          ? isLook
            ? "Submitting to HeyGen…"
            : "Compositing presenter over backdrop…"
          : "Generating backdrop image"
        : job.engine === "heygen"
          ? "HeyGen is rendering the video"
          : "Generating video";
  const allDone = job.stage !== "backdrop" && videoDone;

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">5. Status</h2>
        <div className="flex gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{job.engine}</span>
          {job.mock && <span className="rounded-full border border-warning/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Mock · no credits used</span>}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = allDone || n < step;
          const active = !allDone && n === step && !failed && !stageFailed;
          const broken = (failed || stageFailed) && n === step;
          return (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  broken ? "bg-danger text-white" : done ? "bg-success text-black" : active ? "bg-accent text-white pulse-ring" : "bg-panel-2 text-muted"
                }`}
              >
                {n}
              </span>
              <span className={`text-xs ${active || done ? "text-fg" : "text-muted"}`}>{label}</span>
              {n < steps.length && <span className="mx-1 h-px flex-1 bg-border" />}
            </div>
          );
        })}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Stage</dt>
        <dd>{stageLabel}</dd>
        <dt className="text-muted">Status</dt>
        <dd className={job.status === "completed" ? "text-success" : terminal ? "text-danger" : "text-accent"}>{STATUS_LABEL[job.status]}</dd>
        <dt className="text-muted">Request</dt>
        <dd className="break-all font-mono">{job.requestId}</dd>
        <dt className="text-muted">Take</dt>
        <dd>{job.takeLabel}</dd>
        <dt className="text-muted">Model</dt>
        <dd className="font-mono">{job.model}</dd>
        {job.durationSeconds ? (
          <>
            <dt className="text-muted">Length</dt>
            <dd>{Math.round(job.durationSeconds)} s</dd>
          </>
        ) : null}
        <dt className="text-muted">Submitted</dt>
        <dd>{new Date(job.submittedAt).toLocaleString()}</dd>
        <dt className="text-muted">Checked</dt>
        <dd>
          {job.lastChecked ? new Date(job.lastChecked).toLocaleTimeString() : "—"} · {job.polls} poll{job.polls === 1 ? "" : "s"}
        </dd>
      </dl>

      {pollError && <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{pollError}</p>}
      {job.error && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{job.error}</p>}

      {(job.backdropUrl || job.compositeUrl || (job.stage === "backdrop" && job.imageUrl)) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(job.backdropUrl || job.imageUrl) && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.backdropUrl ?? job.imageUrl ?? ""} alt="Generated backdrop" className="aspect-video w-full rounded-md object-cover" />
              <figcaption className="mt-1 text-[10px] text-muted">Backdrop</figcaption>
            </figure>
          )}
          {job.compositeUrl && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.compositeUrl} alt="Presenter composited over backdrop" className="aspect-video w-full rounded-md object-cover" />
              <figcaption className="mt-1 text-[10px] text-muted">Frame sent to the video model</figcaption>
            </figure>
          )}
        </div>
      )}

      {allDone && (
        <div className="mt-3">
          <video className="aspect-video w-full rounded-md bg-black" controls playsInline src={job.videoUrl ?? undefined} />
          <a href={job.downloadUrl ?? "#"} className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-success px-4 py-2.5 text-sm font-semibold text-black hover:brightness-110">
            Download MP4
          </a>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">{job.engine === "heygen" && job.stage === "video" ? "Script sent to HeyGen" : "Prompt sent to the model"}</summary>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-panel-2 p-2 font-mono text-[11px] text-muted">{job.prompt}</p>
      </details>

      <div className="mt-3 flex gap-2">
        {!terminal && (
          <button type="button" onClick={onCheckNow} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-panel-2">
            Check now
          </button>
        )}
        {job.stage === "backdrop" && job.status === "completed" && job.error && (
          <button type="button" onClick={onRetryAdvance} className="rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-panel-2">
            Retry video stage
          </button>
        )}
        <button type="button" onClick={onClear} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-panel-2">
          {terminal ? "Start another" : "Forget this job"}
        </button>
      </div>
    </div>
  );
}
