#!/usr/bin/env node
/* ==========================================================================
   Generate the app icon.

   Writes a multi-resolution Windows .ico plus PNGs, using only Node's zlib —
   no image libraries and no binary assets in the repository. Re-run after
   changing the brand colours.

     node make-icon.js
   ========================================================================== */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = __dirname;

/* ------------------------------------------------------------------ colour */
const AMBER = [214, 151, 58];
const AMBER_DEEP = [150, 96, 26];
const INK = [28, 24, 20];

/* ------------------------------------------------------------------- canvas */
class Canvas {
  constructor(size) {
    this.w = size;
    this.h = size;
    /* RGBA, transparent by default. */
    this.px = Buffer.alloc(size * size * 4, 0);
  }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) { this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255; return; }
    /* Source-over composite so overlaps do not darken. */
    const sa = a / 255, da = this.px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    this.px[i] = Math.round((r * sa + this.px[i] * da * (1 - sa)) / oa);
    this.px[i + 1] = Math.round((g * sa + this.px[i + 1] * da * (1 - sa)) / oa);
    this.px[i + 2] = Math.round((b * sa + this.px[i + 2] * da * (1 - sa)) / oa);
    this.px[i + 3] = Math.round(oa * 255);
  }
  /** Rounded rect with a soft edge, so small sizes stay legible. */
  roundRect(x0, y0, w, h, radius, colour, alpha = 255) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const dx = Math.max(x0 + radius - x - 0.5, x + 0.5 - (x0 + w - radius), 0);
        const dy = Math.max(y0 + radius - y - 0.5, y + 0.5 - (y0 + h - radius), 0);
        const d = Math.hypot(dx, dy) - radius;
        if (d <= -0.5) this.set(x, y, [...colour, alpha]);
        else if (d < 0.5) this.set(x, y, [...colour, Math.round(alpha * (0.5 - d))]);
      }
    }
  }
  disc(cx, cy, r, colour, alpha = 255) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
        if (d <= -0.5) this.set(x, y, [...colour, alpha]);
        else if (d < 0.5) this.set(x, y, [...colour, Math.round(alpha * (0.5 - d))]);
      }
    }
  }
  /** Vertical gradient across the whole icon. */
  shade(top, bottom) {
    for (let y = 0; y < this.h; y++) {
      const t = y / (this.h - 1);
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (this.px[i + 3] === 0) continue;
        this.px[i] = Math.round(top[0] + (bottom[0] - top[0]) * t);
        this.px[i + 1] = Math.round(top[1] + (bottom[1] - top[1]) * t);
        this.px[i + 2] = Math.round(top[2] + (bottom[2] - top[2]) * t);
      }
    }
  }
}

/**
 * The mark: a warehouse/flow glyph — three stacked bars of increasing width
 * reading as both inventory levels and a flow chart, inside a rounded square.
 */
function draw(size) {
  const c = new Canvas(size);
  const s = size / 256;   /* design grid is 256x256 */
  const pad = Math.round(14 * s);
  const r = Math.round(52 * s);

  c.roundRect(pad, pad, size - pad * 2, size - pad * 2, r, AMBER_DEEP);
  c.roundRect(pad + 2 * s, pad + 2 * s, size - pad * 2 - 4 * s, size - pad * 2 - 4 * s, r - 2 * s, AMBER);
  c.shade([244, 196, 110], AMBER);

  /* Inner plate, so the bars read clearly against the amber. */
  const ip = Math.round(46 * s);
  c.roundRect(ip, ip, size - ip * 2, size - ip * 2, Math.round(26 * s), INK, 232);

  /* Three bars: short, medium, tall — levels and a rising trend. */
  const bars = [
    { x: 74, y: 168, w: 30, h: 44, a: 150 },
    { x: 113, y: 132, w: 30, h: 80, a: 205 },
    { x: 152, y: 92, w: 30, h: 120, a: 255 }
  ];
  bars.forEach(b => c.roundRect(
    Math.round(b.x * s), Math.round(b.y * s),
    Math.round(b.w * s), Math.round(b.h * s),
    Math.round(7 * s), [255, 244, 226], b.a
  ));

  return c;
}

/* --------------------------------------------------------------------- PNG */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(canvas) {
  const { w, h, px } = canvas;
  /* One filter byte (0 = none) per scanline. */
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    /* bit depth */
  ihdr[9] = 6;    /* colour type: RGBA */
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------------------------------------------------- ICO */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              /* reserved */
  header.writeUInt16LE(1, 2);              /* type: icon */
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach((img, i) => {
    const b = i * 16;
    dir[b] = img.size >= 256 ? 0 : img.size;      /* 0 means 256 */
    dir[b + 1] = img.size >= 256 ? 0 : img.size;
    dir[b + 2] = 0;                              /* palette */
    dir[b + 3] = 0;                              /* reserved */
    dir.writeUInt16LE(1, b + 4);                 /* colour planes */
    dir.writeUInt16LE(32, b + 6);                /* bits per pixel */
    dir.writeUInt32LE(img.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map(i => i.data)]);
}

/* -------------------------------------------------------------------- main */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const assets = path.join(OUT, 'assets');
fs.mkdirSync(assets, { recursive: true });

const built = SIZES.map(size => {
  const canvas = draw(size);
  const buf = png(canvas);
  if (size === 256) fs.writeFileSync(path.join(assets, 'icon.png'), buf);
  return { size, data: buf };
});

const icoBuf = ico(built);
fs.writeFileSync(path.join(assets, 'icon.ico'), icoBuf);

/* Tray icon, 16x16, on a transparent background with no rounded plate —
   a plate looks like a black blob against a dark taskbar. */
const tray = draw(16);
tray.px.fill(0);
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const src = draw(16);
    const s = 16 / 256;
    const bar = [[7, 11, 2, 2, 255], [9, 8, 2, 5, 255], [11, 4, 2, 9, 255]];
    for (const [bx, by, bw, bh, a] of bar) {
      for (let yy = Math.round(by * s); yy < Math.round((by + bh) * s); yy++) {
        for (let xx = Math.round(bx * s); xx < Math.round((bx + bw) * s); xx++) {
          tray.set(xx, yy, [255, 240, 214, a]);
        }
      }
    }
  }
}
fs.writeFileSync(path.join(assets, 'tray.png'), png(tray));

console.log('  icon.ico    ' + icoBuf.length.toLocaleString() + ' bytes  (' + SIZES.join(', ') + ')');
console.log('  icon.png    ' + fs.statSync(path.join(assets, 'icon.png')).size.toLocaleString() + ' bytes  (256x256)');
console.log('  tray.png    ' + fs.statSync(path.join(assets, 'tray.png')).size.toLocaleString() + ' bytes  (16x16)');
