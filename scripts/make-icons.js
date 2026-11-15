// Generates the extension icons (16, 48, 128) with no dependencies: a navy tile with Prevy the shield.
// Run: npm run icons
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const NAVY = [11, 18, 32];
const BLUE = [59, 130, 246];
const SOFT = [147, 197, 253];
const WHITE = [255, 255, 255];
const EYE = [37, 99, 235];

// Colour at a point (u, v in 0..1). Returns [r, g, b, a].
function sample(u, v) {
  // rounded-square tile
  const r = 0.2;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];

  let col = NAVY;
  // shield body
  const hw = v <= 0.55 ? 0.31 : (0.31 * (0.9 - v)) / 0.35;
  const inShield = v >= 0.13 && v <= 0.9 && Math.abs(u - 0.5) <= hw;
  if (inShield) {
    col = BLUE;
    const edge = Math.min(hw - Math.abs(u - 0.5), v - 0.13);
    if (edge < 0.03) col = SOFT;
  }
  // dark face plate
  if (((u - 0.5) / 0.22) ** 2 + ((v - 0.47) / 0.2) ** 2 <= 1) col = NAVY;
  // eyes
  if (Math.hypot(u - 0.42, v - 0.46) <= 0.055 || Math.hypot(u - 0.58, v - 0.46) <= 0.055) col = WHITE;
  if (Math.hypot(u - 0.435, v - 0.47) <= 0.028 || Math.hypot(u - 0.585, v - 0.47) <= 0.028) col = EYE;
  // smile
  const d = Math.hypot(u - 0.5, v - 0.45);
  if (v > 0.56 && v < 0.66 && Math.abs(d - 0.14) < 0.014) col = WHITE;
  return [col[0], col[1], col[2], 255];
}

function png(size) {
  const SS = 4; // 4x4 samples per pixel for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      if (a > 0) {
        raw[i] = Math.round(r / a); raw[i + 1] = Math.round(g / a); raw[i + 2] = Math.round(b / a);
        raw[i + 3] = Math.round(a / (SS * SS));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, "..", "assets", "icons");
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(out, `icon${size}.png`), png(size));
  console.log(`wrote assets/icons/icon${size}.png`);
}
