# Avatar Studio

Private Next.js studio for turning pre-recorded green-screen avatar takes into finished videos through the official [Higgsfield API](https://docs.higgsfield.ai/docs).

Flow: pick a take → choose outfit / presenter → describe the replacement backdrop → enter the exact dialogue → confirm the credit warning → track the asynchronous job → download the MP4.

## How it works

- **Takes** are the 14 media IDs already uploaded to Higgsfield. `src/lib/takes.ts` maps each media ID to its hosted MP4, a poster frame, presenter, outfit and pose. Only these IDs are accepted by the API.
- **Generation** is a two-stage pipeline driven by the browser, each stage a documented asynchronous request:
  1. `POST /api/generate` validates the input and submits a **backdrop plate** for the described scene to Soul 2 (`higgsfield-ai/soul/v2/standard`).
  2. When that completes, the client calls `POST /api/generate/animate`. The server composites the presenter cutout (the selected take keyed out of its green screen, hosted as a transparent PNG) over the backdrop with sharp, uploads the frame through the documented Files API (`POST /files/generate-upload-url` + presigned PUT), and submits the video model with the dialogue in the prompt. Default video model: **Kling 3.0 Pro** (`kling-video/v3.0/pro/image-to-video`, `sound: on`), which speaks the quoted dialogue with lip-sync; Kling 2.6 Pro and Hailuo 2.3 Pro (motion only) are selectable in `src/lib/models.ts`.
- **Model availability** is verified live by posting an empty body to each model path: a validation error proves the model is enabled, while `model_not_found`, `model_disabled` or `model_blocked` prove it is not. The account's `GET /models` catalog only lists three image models and is not authoritative.
- **Cost** is estimated before confirmation through Higgsfield's `POST /estimate/{model}` endpoint and shown in the confirmation dialog.
- **Status** is polled by the browser through `GET /api/status/:requestId`, which calls the documented `GET /requests/{request_id}/status` endpoint and normalises `queued | in_progress | completed | failed | nsfw | canceled`.
- **Download** goes through `GET /api/download/:requestId`, which re-reads the request status server-side and streams the finished MP4 with a download filename.
- **Dry run** (`mock: true`) exercises the whole submit → poll → download loop without calling Higgsfield or spending credits. Mock jobs are always labelled as mocks and return the original take as their "output".

Credentials are read only on the server (`src/lib/higgsfield.ts`), are never sent to the browser, and are redacted from any upstream error text before it is surfaced.

## Environment variables

| Name | Purpose |
| --- | --- |
| `higgsfieldapi` | Higgsfield API key ID (Vercel production name) |
| `higgsfieldkey` | Higgsfield API key secret (Vercel production name) |
| `HIGGSFIELD_API_KEY_ID` / `HIGGSFIELD_API_KEY_SECRET` | Optional uppercase aliases |
| `HIGGSFIELD_API_BASE` | Optional: `api` (default, api.higgsfield.ai) or `platform` (platform.higgsfield.ai); both accept the same key |

## Local development

```bash
npm install
cp .env.example .env.local   # fill in credentials, or leave blank to test the missing-credential path
npm run dev
```

## API

| Route | Description |
| --- | --- |
| `GET /api/health` | `{ higgsfieldConfigured, model, modelPath, modelAvailable, backdropAvailable, takes }` |
| `GET /api/models` | The account's model catalog from `GET /models` (incomplete on Higgsfield's side; see probe) |
| `GET /api/models/probe?path=` | Diagnostic: does this key have access to a model path (empty body, no credits) |
| `GET /api/takes` | Take catalogue (no credentials involved) |
| `GET /api/estimate?model=&duration=&aspectRatio=` | Credit estimate for backdrop + video from Higgsfield's `/estimate/{model}` |
| `POST /api/generate` | Body: `{ mediaId, scene, dialogue, duration?, aspectRatio?, model?, mock? }` → `202 { requestId, stage: "backdrop" \| "mock", pipeline, ... }` |
| `POST /api/generate/animate` | Body: `{ backdropRequestId, ...pipeline }` → composites + uploads the frame → `202 { requestId, stage: "video", compositeUrl }` |
| `GET /api/status/:requestId` | `{ status, terminal, videoUrl, imageUrl, downloadUrl, error }` |
| `POST /api/cancel/:requestId` | Cancels a queued request |
| `GET /api/download/:requestId` | Streams the finished MP4 |

Validation errors return `400 { error, fieldErrors }`. Missing server credentials return `503 { code: "not_configured" }`. Rejected credentials return `502 { code: "unauthorized" }`.

## Privacy

The site is `noindex`. To restrict access, enable Vercel Deployment Protection (password or Vercel Authentication) on the project.
