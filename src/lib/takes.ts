/**
 * Server-side media mapping for the avatar green-screen takes that are already
 * uploaded to Higgsfield. The `id` is the Higgsfield media ID. `videoUrl` is the
 * hosted MP4 for that media ID; `posterUrl` is a still frame extracted from the
 * take (hosted on the same Higgsfield CDN) that is used both as the grid
 * thumbnail and as the presenter reference image sent to the video model.
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
  take("4462c861-cf03-42a0-942d-3e20cf0e71cc", 1, "A", OUTFITS.scrubs, "standing", "d54fbc3b-09ee-474f-a1db-e3b6749b2ea3.jpg", "Smiling, hands clasped"),
  take("cd5b5ff0-9baa-4756-a4ab-1800ded0b4bd", 2, "A", OUTFITS.scrubs, "standing", "88bd6a58-845d-419e-acea-9865201694e5.jpg", "Hands clasped"),
  take("7b395c8b-fd46-4719-9e76-7430ed9e6065", 3, "A", OUTFITS.labcoat, "standing", "8373ebf3-d3ab-4a38-bf75-b56ea9b93307.jpg", "Lab coat over scrubs"),
  take("03604ae0-c043-4ede-bc1e-482b5519c7b5", 4, "A", OUTFITS.labcoat, "standing", "6f8db006-433c-44fe-94b8-f426070cf574.jpg", "Lab coat, relaxed"),
  take("0fd61fee-9d90-42aa-bd17-a4d1e515c867", 5, "A", OUTFITS.tuxedo, "standing", "3be57b64-db07-4bba-9827-72d0b44914ae.jpg", "Red pocket square"),
  take("9c4015a3-4f98-4ea8-9100-a8f438de0cb5", 6, "A", OUTFITS.tuxedo, "standing", "32e139bc-1305-4cff-81b2-c71d5edf00f5.jpg", "Serious"),
  take("41dd20ae-69ea-4fda-a0f4-a54155160ee7", 7, "A", OUTFITS.tuxedo, "seated", "d41a5078-b1ed-444a-82ad-3fb42afb794a.jpg", "Sunglasses"),
  take("692712fd-35c8-4f7c-b4e8-ab62af7965e1", 8, "A", OUTFITS.scrubs, "seated", "65a2c1d6-2380-4f23-92be-518c5cf0ad51.jpg", "Hands clasped"),
  take("6f1239ac-4903-4e91-9863-2f59783c33f1", 9, "A", OUTFITS.scrubs, "seated", "4ba7eebf-2643-43dd-ae7a-236d9c87eeb4.jpg", "Leaning forward"),
  take("c21785cd-f415-4679-b64f-5508767c6600", 10, "A", OUTFITS.scrubs, "seated", "dba9e894-2545-4e4a-822a-6e35437dc500.jpg", "Hand on chest"),
  take("d3cc082b-ac9f-4b09-a13b-8b5e2d4c37d5", 11, "A", OUTFITS.scrubs, "seated", "e502f6de-b44d-4193-b8c5-774032704257.jpg", "Smiling"),
  take("3a08fa9b-cf20-4326-83cd-79144b960f18", 12, "B", OUTFITS.scrubsTopB, "standing", "4dbbffd4-06ed-49dc-9980-f753cb188ee6.jpg"),
  take("8e7092e3-e15f-4731-bce2-52fb41591d90", 13, "B", OUTFITS.whiteTopB, "standing", "0ed99b72-6015-45a5-8adf-afa8cd81bf3e.jpg", "Patterned trousers"),
  take("fed4a750-9d93-4061-ab80-c3b94df383e2", 14, "C", OUTFITS.poloC, "standing", "b110c1cb-fac2-4240-ad1b-caff76efc837.jpg"),
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
