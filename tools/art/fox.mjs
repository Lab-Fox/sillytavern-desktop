// The fox: a pixel fox on a 72×70 grid — a few full poses, and the head and paws that peek over the bar.
import { Canvas, hex } from './canvas.mjs';

export const PAL = {
    orange: hex('#f28c38'), shade: hex('#cf6a22'), light: hex('#ffb070'), tailA: hex('#e2742a'), tailB: hex('#d8692a'), tailShade: hex('#b8521c'),
    cream: hex('#fff3e6'), creamShade: hex('#efd9c2'),
    ink: hex('#2a1a10'), earIn: hex('#7a3a12'), blush: hex('#ff8f8f'), white: hex('#ffffff'),
    ale: hex('#f5b638'), aleDark: hex('#d58a1c'), foam: hex('#fffaf0'), foamShade: hex('#ecdcc4'), glass: hex('#8a4f24'), zzz: hex('#b48a64'),
};
const P = PAL;
const W = 72, H = 70;

// Rim shading on the lower right, then the 1-pixel ink outline.
function finish(c) {
    c.shade(P.orange, P.shade, (x, y) => !c.get(x + 1, y + 1)?.[3] || !c.get(x, y + 2)?.[3]);
    c.shade(P.cream, P.creamShade, (x, y) => !c.get(x, y + 1)?.[3]);
    return c.outline(P.ink);
}

function tail(c) {
    c.ellipse(18, 55, 11, 6, P.orange);
    c.ellipse(10, 50, 6.5, 6.5, P.orange);
    c.ellipse(7, 45, 4.5, 4.5, P.cream);
}
function body(c) {
    c.ellipse(27, 63, 3.6, 4.5, P.orange); // legs
    c.ellipse(37, 63, 3.6, 4.5, P.orange);
    c.ellipse(32, 51, 11.5, 13.5, P.orange);
    c.ellipse(32, 54, 6.5, 9.5, P.cream);
    c.ellipse(26.5, 67, 4.5, 2.3, P.orange); // feet
    c.ellipse(37.5, 67, 4.5, 2.3, P.orange);
    c.ellipse(22, 51, 3, 5.5, P.orange); // left paw
}
function head(c) {
    c.poly([[16, 22], [13, 4], [28, 14]], P.orange);
    c.poly([[48, 22], [51, 4], [36, 14]], P.orange);
    c.ellipse(32, 27, 17, 13, P.orange);
    c.poly([[17, 27], [23, 37], [28, 33]], P.cream);
    c.poly([[47, 27], [41, 37], [36, 33]], P.cream);
    c.ellipse(32, 35, 8, 5.5, P.cream);
}
function face(c, { sleepy = false } = {}) {
    c.poly([[18, 18], [16, 8], [25, 14]], P.earIn);
    c.poly([[46, 18], [48, 8], [39, 14]], P.earIn);
    c.ellipse(32, 18, 6, 2.5, P.light);
    if (sleepy) {
        for (const x of [24, 40]) { c.px(x - 2, 26, P.ink); c.px(x - 1, 27, P.ink); c.px(x, 27, P.ink); c.px(x + 1, 27, P.ink); c.px(x + 2, 26, P.ink); }
    } else {
        for (const x of [24, 40]) { c.ellipse(x, 26, 2.2, 3.2, P.ink); c.px(x - 1, 24, P.white); c.px(x - 1, 25, P.white); c.px(x + 1, 28, P.white); }
    }
    c.ellipse(19.5, 31.5, 2.2, 1.2, P.blush);
    c.ellipse(44.5, 31.5, 2.2, 1.2, P.blush);
    c.rect(31, 31, 3, 2, P.ink);
    // the mouth in thin lines, so it stays a small "w" at any size
    c.line(32, 33, 32, 34, P.ink);
    c.line(30, 34, 31, 35, P.ink); c.line(31, 35, 32, 34, P.ink);
    c.line(32, 34, 33, 35, P.ink); c.line(33, 35, 34, 34, P.ink);
}
function restingArm() {
    const a = new Canvas(W, H);
    a.ellipse(42, 51, 3, 5.5, P.orange);
    return finish(a);
}
function raisedArm() {
    const a = new Canvas(W, H);
    a.poly([[39, 47], [44, 45], [55, 31], [50, 28]], P.orange);
    a.ellipse(53, 29, 4.2, 3.8, P.orange);
    return finish(a);
}
// A mug of ale with foam; (x, y) = top left of the glass.
export function mug(x = 49, y = 8, w = W, h = H) {
    const m = new Canvas(w, h);
    m.rect(x + 12, y + 6, 4, 2, P.glass); m.rect(x + 14, y + 6, 2, 10, P.glass); m.rect(x + 12, y + 14, 4, 2, P.glass); // handle
    m.rect(x, y + 4, 13, 16, P.ale);
    m.rect(x + 9, y + 4, 4, 16, P.aleDark);
    m.rect(x + 2, y + 7, 2, 9, P.foam); // a glint on the glass
    m.rect(x, y + 18, 13, 2, P.glass); // the base
    m.ellipse(x + 6.5, y + 3.5, 8, 3.2, P.foam);
    m.ellipse(x + 3.5, y + 1.5, 3.5, 2.2, P.foam);
    m.ellipse(x + 9, y + 1.8, 3, 2, P.foam);
    m.rect(x + 1, y + 5, 2, 4, P.foam); // a drip
    m.shade(P.foam, P.foamShade, (px, py) => py >= y + 5 && px > x + 6);
    return m.outline(P.ink);
}
function zzz(c, at = [[55, 15, 3], [61, 6, 5]]) {
    at.forEach(([x, y, s]) => { c.line(x, y, x + s, y, P.zzz); c.line(x + s, y, x, y + s, P.zzz); c.line(x, y + s, x + s, y + s, P.zzz); });
}

// A bushy curved tail along a quadratic curve p0 → ctrl → p1: widest in the middle, narrowing
// to a soft point, cream tip. Drawn on its own layer with its own outline.
export function bushyTail(w, h, p0, ctrl, p1, { rmax = 6.5, color = P.tailA, tip = 0.8 } = {}) {
    const t = new Canvas(w, h);
    for (let s = 0; s <= 1.0001; s += 0.015) {
        const x = (1 - s) ** 2 * p0[0] + 2 * (1 - s) * s * ctrl[0] + s * s * p1[0];
        const y = (1 - s) ** 2 * p0[1] + 2 * (1 - s) * s * ctrl[1] + s * s * p1[1];
        const r = 1.2 + (rmax - 1.2) * Math.sin(Math.PI * (0.06 + 0.94 * s)) ** 0.7;
        t.ellipse(x, y, r, r, s > tip ? P.cream : color);
    }
    t.shade(color, P.tailShade, (x, y) => !t.get(x + 1, y + 1)?.[3]);
    return finish(t);
}

// Sitting, with big bushy tails plumed up on one side.
export const FAN = { w: 124, h: 86, ox: 26, oy: 14 }; // the 72×70 fox sits at (ox, oy)
function tailFan() {
    const c = new Canvas(FAN.w, FAN.h);
    const bx = FAN.ox + 32, by = FAN.oy + 56;
    // [angle, length, color] back to front
    const tails = [[108, 0.92, P.tailB], [128, 1, P.tailA], [150, 0.86, P.tailB]];
    for (const [a, f, color] of tails) {
        const rad = a * Math.PI / 180, side = Math.cos(rad);
        const len = (74 - Math.abs(side) * 18) * f;
        const p1 = [bx + side * len * 0.98, by - Math.sin(rad) * len * 0.8 - Math.abs(side) * len * 0.42];
        // sweeps outward first, then curls up at the tip like a flame
        const ctrl = [bx + side * len * 0.72, by - Math.sin(rad) * len * 0.3 - len * 0.08];
        c.draw(bushyTail(FAN.w, FAN.h, [bx, by], ctrl, p1, { rmax: 9, color }), 0, 0);
    }
    return c;
}

// pose: 'cheers' (raises a mug of ale), 'wave', 'sit', 'sleep'; fan = the plumed tails instead of one
export function fox(pose = 'cheers', { fan = true } = {}) {
    const c = new Canvas(W, H);
    if (!fan) tail(c);
    body(c); head(c);
    finish(c);
    face(c, { sleepy: pose === 'sleep' });
    if (pose === 'cheers') c.draw(mug(), 0, 0);
    c.draw(pose === 'cheers' || pose === 'wave' ? raisedArm() : restingArm(), 0, 0);
    if (pose === 'sleep' && !fan) zzz(c);
    if (!fan) return c;
    const out = tailFan();
    out.draw(c, FAN.ox, FAN.oy);
    if (pose === 'sleep') zzz(out, [[102, 9, 3], [109, 1, 5]]);
    return out;
}

// The fox peeking over a counter: the head alone (the counter hides the rest)…
export function peekHead(k = 1) {
    const c = new Canvas(Math.ceil(W * k), Math.ceil(46 * k));
    const s = scaled(c, k);
    head(s);
    finish(c);
    face(s);
    return c;
}
// …and two front paws resting on the counter, with toe lines.
export function peekPaws(k = 1, xs = [17, 47], y = 40) {
    const c = new Canvas(Math.ceil(W * k), Math.ceil(46 * k));
    const s = scaled(c, k);
    for (const x of xs) { s.ellipse(x, y, 5.4, 3.4, P.orange); s.ellipse(x, y + 1.9, 4, 1.4, P.cream); }
    finish(c);
    for (const x of xs) for (const dx of [-1.5, 1.5]) s.px(x + dx, y + 2, P.ink);
    return c;
}
// Draws the same shapes k times bigger, straight onto the pixel grid (no blurry resizing).
function scaled(c, k) {
    const n = v => Math.max(1, Math.round(k));
    return {
        ellipse: (x, y, rx, ry, col) => c.ellipse(x * k, y * k, rx * k, ry * k, col),
        poly: (pts, col) => c.poly(pts.map(([x, y]) => [x * k, y * k]), col),
        rect: (x, y, w, h, col) => c.rect(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), col),
        px: (x, y, col) => c.rect(Math.round(x * k), Math.round(y * k), n(), n(), col),
        line: (x0, y0, x1, y1, col) => c.line(x0 * k, y0 * k, x1 * k, y1 * k, col),
    };
}

