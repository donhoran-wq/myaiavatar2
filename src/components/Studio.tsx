"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiErrorResponse, GenerateResponse, JobStatus, StatusResponse } from "@/lib/api-types";

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

interface Job {
  requestId: string;
  status: JobStatus;
  mock: boolean;
  model: string;
  prompt: string;
  takeLabel: string;
  submittedAt: string;
  videoUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
  lastChecked: string | null;
  polls: number;
}

const STORAGE_KEY = "avatar-studio:job";
const POLL_MS = 5000;
const POLL_MAX_MS = 20 * 60 * 1000;

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

export function Studio({ takes, configured, model }: { takes: TakeCardData[]; configured: boolean; model: string }) {
  const [selectedId, setSelectedId] = useState<string>(takes[0]?.id ?? "");
  const [presenterFilter, setPresenterFilter] = useState<string>("all");
  const [outfitFilter, setOutfitFilter] = useState<string>("all");
  const [scene, setScene] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [duration, setDuration] = useState<"4" | "6" | "8">("8");
  const [resolution, setResolution] = useState<"720" | "1080">("720");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [dryRun, setDryRun] = useState(!configured);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAck, setConfirmAck] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    // Rehydrate the last job from localStorage after mount (cannot be a lazy
    // initializer because the server render has no localStorage).
    const saved = loadJob();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setJob(saved);
  }, []);

  useEffect(() => {
    saveJob(job);
  }, [job]);

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

  // If the presenter filter changes and the chosen outfit no longer applies, fall back to "all".
  const effectiveOutfit = outfitFilter !== "all" && !outfits.includes(outfitFilter) ? "all" : outfitFilter;

  const visibleTakes = useMemo(
    () =>
      takes.filter(
        (t) => (presenterFilter === "all" || t.presenter === presenterFilter) && (effectiveOutfit === "all" || t.outfit === effectiveOutfit),
      ),
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

  useEffect(() => {
    stopPolling();
    if (!job) return;
    const terminal = ["completed", "failed", "nsfw", "canceled"].includes(job.status);
    if (terminal) return;
    const startedAt = Date.parse(job.submittedAt);
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_MAX_MS) {
        setPollError("Stopped polling after 20 minutes. Use “Check now” to refresh manually.");
        return;
      }
      try {
        const s = await pollOnce(job.requestId);
        if (cancelled) return;
        setPollError(null);
        setJob((prev) =>
          prev && prev.requestId === s.requestId
            ? { ...prev, status: s.status, videoUrl: s.videoUrl, downloadUrl: s.downloadUrl, error: s.error, lastChecked: s.checkedAt, polls: prev.polls + 1 }
            : prev,
        );
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
  }, [job?.requestId, job?.status]);

  const checkNow = async () => {
    if (!job) return;
    try {
      const s = await pollOnce(job.requestId);
      setPollError(null);
      setJob((prev) => (prev ? { ...prev, status: s.status, videoUrl: s.videoUrl, downloadUrl: s.downloadUrl, error: s.error, lastChecked: s.checkedAt, polls: prev.polls + 1 } : prev));
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
    if (dialogue.trim().length > 500) errs.dialogue = "Dialogue must be 500 characters or fewer.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onGenerateClick = () => {
    setFormError(null);
    if (!validateLocally()) return;
    if (dryRun) {
      void submit(true);
    } else {
      setConfirmAck(false);
      setConfirmOpen(true);
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
        body: JSON.stringify({ mediaId: selected.id, scene, dialogue, duration, resolution, aspectRatio, mock }),
      });
      const body = (await res.json()) as GenerateResponse | ApiErrorResponse;
      if (!res.ok) {
        const e = body as ApiErrorResponse;
        if (e.fieldErrors) setFieldErrors(e.fieldErrors);
        setFormError(e.error || `Submission failed (HTTP ${res.status}).`);
        return;
      }
      const g = body as GenerateResponse;
      setJob({
        requestId: g.requestId,
        status: g.status,
        mock: g.mock,
        model: g.model,
        prompt: g.prompt,
        takeLabel: g.take.label,
        submittedAt: g.submittedAt,
        videoUrl: null,
        downloadUrl: null,
        error: null,
        lastChecked: null,
        polls: 0,
      });
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

  const busy = job !== null && !["completed", "failed", "nsfw", "canceled"].includes(job.status);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Avatar Studio</h1>
          <p className="mt-1 text-sm text-muted">Pick a green-screen take, describe the new scene, write the dialogue, and generate through Higgsfield.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${configured ? "border-success/40 text-success" : "border-warning/50 text-warning"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-success" : "bg-warning"}`} />
            {configured ? "Higgsfield API connected" : "Higgsfield credentials missing"}
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 font-mono text-muted" title="Model path">
            {model}
          </span>
        </div>
      </header>

      {!configured && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          Server credentials are not set. Real generations are disabled until <code className="font-mono">higgsfieldapi</code> and <code className="font-mono">higgsfieldkey</code> are configured. Dry-run mode still works.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Takes */}
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

        {/* Form */}
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">2. Scene &amp; dialogue</h2>

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
              <span className="mb-1 block font-medium">Dialogue (spoken exactly as written)</span>
              <textarea
                value={dialogue}
                onChange={(e) => setDialogue(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Hi, I'm Dr. Keyes. Welcome to our practice..."
                className="w-full rounded-md border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="mt-1 flex justify-between text-xs text-muted">
                <span className="text-danger">{fieldErrors.dialogue}</span>
                <span>{dialogue.length}/500</span>
              </span>
            </label>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-muted">Duration</span>
                <select value={duration} onChange={(e) => setDuration(e.target.value as "4" | "6" | "8")} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                  <option value="4">4 s</option>
                  <option value="6">6 s</option>
                  <option value="8">8 s</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted">Resolution</span>
                <select value={resolution} onChange={(e) => setResolution(e.target.value as "720" | "1080")} className="rounded-md border border-border bg-panel-2 px-2 py-1.5">
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
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
          </div>

          <div className="rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">3. Generate</h2>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Dry run (mock, no credits)</span>
                <span className="block text-xs text-muted">Exercises submit → poll → download without calling Higgsfield. The result is the original take, clearly labelled as a mock.</span>
              </span>
            </label>

            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Real generations consume Higgsfield credits. You will be asked to confirm before anything is submitted.
            </div>

            {formError && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{formError}</p>}

            <button
              type="button"
              onClick={onGenerateClick}
              disabled={submitting || busy || !selected}
              className="mt-3 w-full rounded-md bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : busy ? "A job is in progress…" : dryRun ? "Run dry-run generation" : "Generate video (uses credits)"}
            </button>
          </div>

          <JobPanel job={job} pollError={pollError} onCheckNow={checkNow} onClear={clearJob} />
        </section>
      </div>

      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <h3 id="confirm-title" className="text-lg font-semibold">
              Submit to Higgsfield?
            </h3>
            <p className="mt-2 text-sm text-muted">
              This submits a real generation with model <span className="font-mono text-fg">{model}</span>. Higgsfield charges credits for completed generations. Failed or moderated requests are not charged.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Take</dt>
              <dd>
                {selected.label} · {selected.outfit}
              </dd>
              <dt className="text-muted">Duration</dt>
              <dd>
                {duration} s · {resolution}p · {aspectRatio}
              </dd>
              <dt className="text-muted">Dialogue</dt>
              <dd className="line-clamp-3">{dialogue}</dd>
            </dl>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmAck} onChange={(e) => setConfirmAck(e.target.checked)} className="mt-0.5" />
              <span>I understand this will consume Higgsfield credits.</span>
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
      className={`group relative overflow-hidden rounded-lg border text-left transition ${
        selected ? "border-accent ring-2 ring-accent/60" : "border-border hover:border-muted"
      }`}
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

function JobPanel({ job, pollError, onCheckNow, onClear }: { job: Job | null; pollError: string | null; onCheckNow: () => void; onClear: () => void }) {
  if (!job) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-panel/50 p-4 text-sm text-muted">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">4. Status</h2>
        No job yet. Submit a generation to track it here.
      </div>
    );
  }
  const terminal = ["completed", "failed", "nsfw", "canceled"].includes(job.status);
  const ok = job.status === "completed" && job.videoUrl;
  const step = job.status === "queued" ? 1 : job.status === "in_progress" ? 2 : 3;
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">4. Status</h2>
        {job.mock && <span className="rounded-full border border-warning/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Mock · no credits used</span>}
      </div>

      <div className="mb-3 flex items-center gap-2">
        {["Queued", "Generating", "Done"].map((label, i) => {
          const n = i + 1;
          const active = n === step && !terminal;
          const done = n < step || (n === step && terminal);
          const failed = terminal && !ok && n === 3;
          return (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  failed ? "bg-danger text-white" : done ? "bg-success text-black" : active ? "bg-accent text-white pulse-ring" : "bg-panel-2 text-muted"
                }`}
              >
                {n}
              </span>
              <span className={`text-xs ${active || done ? "text-fg" : "text-muted"}`}>{label}</span>
              {n < 3 && <span className="mx-1 h-px flex-1 bg-border" />}
            </div>
          );
        })}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Status</dt>
        <dd className={job.status === "completed" ? "text-success" : terminal ? "text-danger" : "text-accent"}>{STATUS_LABEL[job.status]}</dd>
        <dt className="text-muted">Request</dt>
        <dd className="break-all font-mono">{job.requestId}</dd>
        <dt className="text-muted">Take</dt>
        <dd>{job.takeLabel}</dd>
        <dt className="text-muted">Model</dt>
        <dd className="font-mono">{job.model}</dd>
        <dt className="text-muted">Submitted</dt>
        <dd>{new Date(job.submittedAt).toLocaleString()}</dd>
        <dt className="text-muted">Checked</dt>
        <dd>
          {job.lastChecked ? new Date(job.lastChecked).toLocaleTimeString() : "—"} · {job.polls} poll{job.polls === 1 ? "" : "s"}
        </dd>
      </dl>

      {pollError && <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{pollError}</p>}
      {job.error && <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{job.error}</p>}

      {ok && (
        <div className="mt-3">
          <video className="aspect-video w-full rounded-md bg-black" controls playsInline src={job.videoUrl ?? undefined} />
          <a
            href={job.downloadUrl ?? "#"}
            className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-success px-4 py-2.5 text-sm font-semibold text-black hover:brightness-110"
          >
            Download MP4
          </a>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Prompt sent to the model</summary>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-panel-2 p-2 font-mono text-[11px] text-muted">{job.prompt}</p>
      </details>

      <div className="mt-3 flex gap-2">
        {!terminal && (
          <button type="button" onClick={onCheckNow} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-panel-2">
            Check now
          </button>
        )}
        <button type="button" onClick={onClear} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-panel-2">
          {terminal ? "Start another" : "Forget this job"}
        </button>
      </div>
    </div>
  );
}
