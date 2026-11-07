// Bounding box of differing pixels between two PNGs (8-bit RGB/RGBA).
const fs = require('fs'), zlib = require('zlib');
function read(f) {
    const b = fs.readFileSync(f); let p = 8, w, h, ct, idat = [];
    while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + n);
        if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (t === 'IDAT') idat.push(d); p += 12 + n; }
    const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), s = w * bpp, out = Buffer.alloc(s * h);
    for (let y = 0; y < h; y++) { const ft = raw[y * (s + 1)];
        for (let x = 0; x < s; x++) { const v = raw[y * (s + 1) + 1 + x], a = x >= bpp ? out[y * s + x - bpp] : 0, u = y ? out[(y - 1) * s + x] : 0, c = x >= bpp && y ? out[(y - 1) * s + x - bpp] : 0;
            let r = v; if (ft === 1) r += a; else if (ft === 2) r += u; else if (ft === 3) r += (a + u) >> 1; else if (ft === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); r += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
            out[y * s + x] = r & 255; } }
    return { w, h, bpp, out };
}
const [A, B, ...names] = process.argv.slice(2);
for (const n of names) { const a = read(`${A}/${n}`), b = read(`${B}/${n}`); let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, c = 0;
    if (a.w !== b.w || a.h !== b.h) { console.log(n, 'size', a.w, a.h, b.w, b.h); continue; }
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { const i = (y * a.w + x) * a.bpp; if (a.out[i] !== b.out[i] || a.out[i + 1] !== b.out[i + 1] || a.out[i + 2] !== b.out[i + 2]) { c++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
    console.log(n, c, 'px differ, box', x0, y0, x1, y1); }
