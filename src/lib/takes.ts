/**
 * Server-side media mapping for the avatar green-screen takes that are already
 * uploaded to Higgsfield. The `id` is the Higgsfield media ID. `videoUrl` is the
 * hosted MP4 for that media ID; `posterUrl` is a still frame extracted from the
 * take (hosted on the same Higgsfield CDN) used as the grid thumbnail;
 * `cutoutUrl` is the same frame with the green screen keyed out (transparent
 * PNG), which the pipeline composites over the generated backdrop.
 */
export type Presenter = "A" | "B" | "C";

export interface Take {
  id: string;
  label: string;
  presenter: Presenter;
  outfit: string;
  pose: "standing" | "seated";
  note?: string;
  videoUrl: string;
  posterUrl: string;
  /** Transparent PNG of the presenter keyed out of the poster frame (same CDN). */
  cutoutUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
}

const CDN = "https://d2ol7oe51mr4n9.cloudfront.net/user_3Hhcz3zHmRdyfHqMlVpSLBtlGQ0";

function take(
  id: string,
  n: number,
  presenter: Presenter,
  outfit: string,
  pose: Take["pose"],
  posterFile: string,
  cutoutFile: string,
  note?: string,
): Take {
  return {
    id,
    label: `Take ${String(n).padStart(2, "0")}`,
    presenter,
    outfit,
    pose,
    note,
    videoUrl: `${CDN}/${id}.mp4`,
    posterUrl: `${CDN}/${posterFile}`,
    cutoutUrl: `${CDN}/${cutoutFile}`,
    durationSeconds: 8,
    width: 1280,
    height: 720,
  };
}

export const OUTFITS = {
  scrubs: "Black scrubs",
  labcoat: "White lab coat",
  tuxedo: "Black velvet tuxedo jacket",
  scrubsTopB: "Black scrub top",
  whiteTopB: "White sleeveless top",
  poloC: "White polo shirt",
} as const;

export const TAKES: Take[] = [
  take("4462c861-cf03-42a0-942d-3e20cf0e71cc", 1, "A", OUTFITS.scrubs, "standing", "d54fbc3b-09ee-474f-a1db-e3b6749b2ea3.jpg", "866b0236-1cef-427e-a7bb-2fe23e573bbb.png", "Smiling, hands clasped"),
  take("cd5b5ff0-9baa-4756-a4ab-1800ded0b4bd", 2, "A", OUTFITS.scrubs, "standing", "88bd6a58-845d-419e-acea-9865201694e5.jpg", "1b735672-cbb6-4e9d-a881-b0494a9f2a61.png", "Hands clasped"),
  take("7b395c8b-fd46-4719-9e76-7430ed9e6065", 3, "A", OUTFITS.labcoat, "standing", "8373ebf3-d3ab-4a38-bf75-b56ea9b93307.jpg", "db7ae700-f4bb-4867-bf3a-b24e0549cfd9.png", "Lab coat over scrubs"),
  take("03604ae0-c043-4ede-bc1e-482b5519c7b5", 4, "A", OUTFITS.labcoat, "standing", "6f8db006-433c-44fe-94b8-f426070cf574.jpg", "45732219-32e8-48a1-a1d8-bb91928a80d5.png", "Lab coat, relaxed"),
  take("0fd61fee-9d90-42aa-bd17-a4d1e515c867", 5, "A", OUTFITS.tuxedo, "standing", "3be57b64-db07-4bba-9827-72d0b44914ae.jpg", "84fb4f4d-2935-454c-b1da-7a32a58bb687.png", "Red pocket square"),
  take("9c4015a3-4f98-4ea8-9100-a8f438de0cb5", 6, "A", OUTFITS.tuxedo, "standing", "32e139bc-1305-4cff-81b2-c71d5edf00f5.jpg", "d1127e67-a978-4b7c-9dc2-b3fb34d344d5.png", "Serious"),
  take("41dd20ae-69ea-4fda-a0f4-a54155160ee7", 7, "A", OUTFITS.tuxedo, "seated", "d41a5078-b1ed-444a-82ad-3fb42afb794a.jpg", "97ea4b65-d1a2-46f1-9920-2668b28f0591.png", "Sunglasses"),
  take("692712fd-35c8-4f7c-b4e8-ab62af7965e1", 8, "A", OUTFITS.scrubs, "seated", "65a2c1d6-2380-4f23-92be-518c5cf0ad51.jpg", "55e656fe-e6aa-4698-97ce-067eeed72faa.png", "Hands clasped"),
  take("6f1239ac-4903-4e91-9863-2f59783c33f1", 9, "A", OUTFITS.scrubs, "seated", "4ba7eebf-2643-43dd-ae7a-236d9c87eeb4.jpg", "5916686a-fee9-4ba3-8f0a-1fee55414f5f.png", "Leaning forward"),
  take("c21785cd-f415-4679-b64f-5508767c6600", 10, "A", OUTFITS.scrubs, "seated", "dba9e894-2545-4e4a-822a-6e35437dc500.jpg", "f82f863f-2f3f-4b68-8fe0-19769c729383.png", "Hand on chest"),
  take("d3cc082b-ac9f-4b09-a13b-8b5e2d4c37d5", 11, "A", OUTFITS.scrubs, "seated", "e502f6de-b44d-4193-b8c5-774032704257.jpg", "76bdfc16-8cd1-4f03-9ad8-6418ccba01cc.png", "Smiling"),
  take("3a08fa9b-cf20-4326-83cd-79144b960f18", 12, "B", OUTFITS.scrubsTopB, "standing", "4dbbffd4-06ed-49dc-9980-f753cb188ee6.jpg", "f60168a9-f348-4f50-8941-bdda8481c1d3.png"),
  take("8e7092e3-e15f-4731-bce2-52fb41591d90", 13, "B", OUTFITS.whiteTopB, "standing", "0ed99b72-6015-45a5-8adf-afa8cd81bf3e.jpg", "07a25cc4-b525-45ab-92c7-1dd2ef52625b.png", "Patterned trousers"),
  take("fed4a750-9d93-4061-ab80-c3b94df383e2", 14, "C", OUTFITS.poloC, "standing", "b110c1cb-fac2-4240-ad1b-caff76efc837.jpg", "fcb1082b-c47a-432c-bac8-7c1da9725eb4.png"),
];

export const TAKES_BY_ID: ReadonlyMap<string, Take> = new Map(TAKES.map((t) => [t.id, t]));

export function getTake(id: string): Take | undefined {
  return TAKES_BY_ID.get(id);
}

export const PRESENTER_LABELS: Record<Presenter, string> = {
  A: "Presenter A",
  B: "Presenter B",
  C: "Presenter C",
};
