// A tiny pixel canvas and PNG writer (no dependencies) for the README art.
// Everything is drawn on a small grid, then scaled up with hard edges.
import zlib from 'node:zlib';
import fs from 'node:fs';

export const hex = s => {
    const n = parseInt(s.replace('#', ''), 16);
    return s.length > 7 ? [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255] : [n >> 16 & 255, n >> 8 & 255, n & 255, 255];
};

export class Canvas {
    constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
    get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
    // Paints one pixel; colors with alpha < 255 blend over what is there.
    px(x, y, c) {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
        const i = (y * this.w + x) * 4, a = c[3] / 255;
        if (a >= 1) { this.d.set(c, i); return; }
        for (let k = 0; k < 3; k++) this.d[i + k] = this.d[i + k] * (1 - a) + c[k] * a;
        this.d[i + 3] = Math.max(this.d[i + 3], c[3]);
    }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); }
    ellipse(cx, cy, rx, ry, c) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
                if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.px(x, y, c);
    }
    // Filled polygon (even-odd), points as [[x, y], …].
    poly(pts, c) {
        const ys = pts.map(p => p[1]);
        for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
            const xs = [];
            for (let i = 0; i < pts.length; i++) {
                const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
                if ((y1 <= y + .5 && y2 > y + .5) || (y2 <= y + .5 && y1 > y + .5)) xs.push(x1 + (y + .5 - y1) / (y2 - y1) * (x2 - x1));
            }
            xs.sort((a, b) => a - b);
            for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i] - .5); x <= Math.floor(xs[i + 1] - .5); x++) this.px(x, y, c);
        }
    }
    line(x0, y0, x1, y1, c) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
        for (let i = 0; i <= n; i++) this.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c);
    }
    // Text-grid sprite: rows of characters, each mapped through `pal` ('.' = nothing).
    sprite(rows, x, y, pal) { rows.forEach((r, j) => [...r].forEach((ch, i) => { if (pal[ch]) this.px(x + i, y + j, pal[ch]); })); }
    // Draws another canvas on this one.
    draw(src, x, y) { for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) { const c = src.get(i, j); if (c[3]) this.px(x + i, y + j, c); } }
    // A 1-pixel outline around everything opaque (the classic sprite look).
    outline(c) {
        const add = [];
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
            if (this.get(x, y)[3]) continue;
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(x + dx, y + dy)?.[3] > 200)) add.push([x, y]);
        }
        add.forEach(([x, y]) => this.px(x, y, c));
        return this;
    }
    // Recolors pixels of one color where `test(x, y)` holds (simple shading).
    shade(from, to, test) {
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
            const p = this.get(x, y);
            if (p[3] && p[0] === from[0] && p[1] === from[1] && p[2] === from[2] && test(x, y)) this.px(x, y, to);
        }
    }
    // Crops to what is drawn, keeping `m` empty pixels around it.
    trim(m = 1) {
        let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y)[3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        if (x1 < 0) return this;
        const o = new Canvas(x1 - x0 + 1 + 2 * m, y1 - y0 + 1 + 2 * m);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.px(x - x0 + m, y - y0 + m, this.get(x, y));
        return o;
    }
    flipX() { const o = new Canvas(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.px(this.w - 1 - x, y, this.get(x, y)); return o; }
    scale(k) {
        const o = new Canvas(this.w * k, this.h * k);
        for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4; o.d.set(this.d.subarray(i, i + 4), (y * o.w + x) * 4); }
        return o;
    }
    png() {
        const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
        for (let y = 0; y < this.h; y++) { raw[y * (this.w * 4 + 1)] = 0; Buffer.from(this.d.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1); }
        const chunk = (type, data) => {
            const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
            const td = Buffer.concat([Buffer.from(type), data]);
            const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
            return Buffer.concat([len, td, crc]);
        };
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 6;
        return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
    }
    save(file) { fs.writeFileSync(file, this.png()); return file; }
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return c ^ -1; }
