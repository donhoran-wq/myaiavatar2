// Dev helper: zoomed side-by-side of two cutout versions over a light plate to inspect edge fringing.
// Usage: node scripts/edge-compare.mjs <oldPng> <newPng> <outJpg>
import sharp from "sharp";
const [oldPng, newPng, out] = process.argv.slice(2);
const tiles = [];
for (const png of [oldPng, newPng]) {
  const comp = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#f4f1ea" } }).composite([{ input: png }]).png().toBuffer();
  tiles.push(await sharp(comp).extract({ left: 420, top: 250, width: 200, height: 150 }).resize(600, 450, { kernel: "nearest" }).png().toBuffer());
}
await sharp({ create: { width: 1200, height: 450, channels: 3, background: "#000" } })
  .composite([{ input: tiles[0], left: 0, top: 0 }, { input: tiles[1], left: 600, top: 0 }])
  .jpeg({ quality: 90 })
  .toFile(out);
console.log(out);
