"use strict";
// Generates assets/icon.png: a 20x20 org-chart/tree glyph with per-level
// distinguishing colors, matching the visual's own default coloring scheme.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 20;
const SCALE = process.argv[2] === "--preview" ? 15 : 1;
const pixels = new Uint8ClampedArray(SIZE * SIZE * 4); // RGBA, starts transparent

function setPixel(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
}

function drawCircle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            if (dx * dx + dy * dy <= r * r) {
                setPixel(x, y, color);
            }
        }
    }
}

function drawLine(x0, y0, x1, y1, color) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        setPixel(x0, y0, color);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

// Tableau10-derived palette, matching the visual's default per-level coloring.
const GRAY = [96, 94, 92];
const ROOT_COLOR = [78, 121, 167];    // level 0 - blue
const CHILD_COLORS = [
    [242, 142, 43],  // level 1 - orange
    [225, 87, 89],   // level 1 - red
    [89, 161, 79]    // level 1 - green
];

const root = { x: 10, y: 4 };
const children = [
    { x: 4, y: 16 },
    { x: 10, y: 16 },
    { x: 16, y: 16 }
];

children.forEach(c => drawLine(root.x, root.y, c.x, c.y, GRAY));
drawCircle(root.x, root.y, 2.4, ROOT_COLOR);
children.forEach((c, i) => drawCircle(c.x, c.y, 2.2, CHILD_COLORS[i]));

// --- Minimal PNG encoder (no dependencies) ---
function crc32(buf) {
    let c;
    const table = crc32.table || (crc32.table = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            t[n] = c >>> 0;
        }
        return t;
    })());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const OUT_SIZE = SIZE * SCALE;

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(OUT_SIZE, 0);
ihdrData.writeUInt32BE(OUT_SIZE, 4);
ihdrData[8] = 8;  // bit depth
ihdrData[9] = 6;  // color type: RGBA
ihdrData[10] = 0; // compression
ihdrData[11] = 0; // filter
ihdrData[12] = 0; // interlace
const ihdr = chunk("IHDR", ihdrData);

const raw = Buffer.alloc(OUT_SIZE * (1 + OUT_SIZE * 4));
for (let y = 0; y < OUT_SIZE; y++) {
    const rowStart = y * (1 + OUT_SIZE * 4);
    raw[rowStart] = 0; // filter type: none
    const srcY = Math.floor(y / SCALE);
    for (let x = 0; x < OUT_SIZE; x++) {
        const srcX = Math.floor(x / SCALE);
        const srcI = (srcY * SIZE + srcX) * 4;
        const dstI = rowStart + 1 + x * 4;
        raw[dstI] = pixels[srcI];
        raw[dstI + 1] = pixels[srcI + 1];
        raw[dstI + 2] = pixels[srcI + 2];
        raw[dstI + 3] = pixels[srcI + 3];
    }
}
const idat = chunk("IDAT", zlib.deflateSync(raw));
const iend = chunk("IEND", Buffer.alloc(0));

const png = Buffer.concat([signature, ihdr, idat, iend]);

const outPath = path.join(__dirname, "..", "assets", SCALE > 1 ? "icon_preview.png" : "icon.png");
fs.writeFileSync(outPath, png);
console.log("Wrote", outPath, png.length, "bytes");
