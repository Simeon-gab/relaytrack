// One-off: renders the manifest icons (icon-192.png, icon-512.png).
// Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#0A0A0B"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#16A34A" stroke-width="36"/>
  <circle cx="256" cy="106" r="44" fill="#16A34A"/>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  await sharp(Buffer.from(svg(size)))
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
  console.log(`icon-${size}.png written`);
}
