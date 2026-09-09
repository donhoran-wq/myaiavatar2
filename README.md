# Avatar Studio

Private Next.js studio for turning pre-recorded green-screen avatar takes into finished videos through the official [Higgsfield API](https://docs.higgsfield.ai/docs).

Flow: pick a take → choose outfit / presenter → describe the replacement backdrop → enter the exact dialogue → confirm the credit warning → track the asynchronous job → download the MP4.

## How it works

- **Takes** are the 14 media IDs already uploaded to Higgsfield. `src/lib/takes.ts` maps each media ID to its hosted MP4, a poster frame, presenter, outfit and pose. Only these IDs are accepted by the API.
- **Generation** goes through `POST /api/generate`, which validates the input, builds a prompt that keeps the presenter and outfit, removes the green screen, places the presenter in the requested scene and speaks the dialogue verbatim, then submits an asynchronous request to `https://api.higgsfield.ai/<model>`. The poster frame of the selected take is passed as the reference image (`image_urls`). The default model is `veo3.1/reference-to-video` with `generate_audio: true`; override with `HIGGSFIELD_MODEL`.
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
| `HIGGSFIELD_MODEL` | Optional model path override (default `veo3.1/reference-to-video`) |

## Local development

```bash
npm install
cp .env.example .env.local   # fill in credentials, or leave blank to test the missing-credential path
npm run dev
```

## API

| Route | Description |
| --- | --- |
| `GET /api/health` | `{ higgsfieldConfigured, model, takes }` |
| `GET /api/takes` | Take catalogue (no credentials involved) |
| `POST /api/generate` | Body: `{ mediaId, scene, dialogue, duration?, resolution?, aspectRatio?, mock? }` → `202 { requestId, status, mock, model, prompt }` |
| `GET /api/status/:requestId` | `{ status, terminal, videoUrl, downloadUrl, error }` |
| `GET /api/download/:requestId` | Streams the finished MP4 |

Validation errors return `400 { error, fieldErrors }`. Missing server credentials return `503 { code: "not_configured" }`. Rejected credentials return `502 { code: "unauthorized" }`.

## Privacy

The site is `noindex`. To restrict access, enable Vercel Deployment Protection (password or Vercel Authentication) on the project.
