// One-off tool: chroma-key the green-screen poster frames into transparent PNG
// cutouts using a green-dominance matte + despill. Usage:
//   node scripts/key-cutouts.mjs <inDir with *.jpg> <outDir>
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [inDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter((f) => /\.jpg$/i.test(f) && !/montage|check/.test(f));
for (const f of files) {
  const src = path.join(inDir, f);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Sample background green from the four corners.
  const sample = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const corners = [sample(20, 20), sample(width - 20, 20), sample(20, height - 20), sample(width - 20, height - 20)];
  const bg = corners.reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);
  const bgDom = bg[1] - Math.max(bg[0], bg[2]); // green dominance of the backdrop
  // Alpha from green dominance: fully transparent near the backdrop's dominance,
  // fully opaque once dominance drops well below it.
  const hi = bgDom * 0.55; // >= this => transparent
  const lo = bgDom * 0.18; // <= this => opaque
  let opaque = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dom = g - Math.max(r, b);
    let a = 1;
    if (dom >= hi) a = 0;
    else if (dom > lo) a = 1 - (dom - lo) / (hi - lo);
    // Despill: clamp green to the max of red/blue in semi-transparent and edge pixels.
    if (a < 1 || dom > lo * 0.5) {
      const m = Math.max(r, b);
      if (g > m) data[i + 1] = Math.round(m + (g - m) * 0.25);
    }
    data[i + 3] = Math.round(a * 255);
    if (a > 0.5) opaque++;
  }
  const out = path.join(outDir, f.replace(/\.jpg$/i, ".png"));
  await sharp(data, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${f} bg=${bg.map(Math.round).join(",")} dom=${bgDom.toFixed(0)} opaque=${((opaque / (width * height)) * 100).toFixed(1)}%`);
}
// Composite check for the first cutout over a dark blue plate.
const first = files[0].replace(/\.jpg$/i, ".png");
await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#334455" } })
  .composite([{ input: path.join(outDir, first) }])
  .jpeg({ quality: 85 })
  .toFile(path.join(outDir, "check.jpg"));
console.log("check:", path.join(outDir, "check.jpg"));
