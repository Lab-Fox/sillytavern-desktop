// The README banner: a tavern wall, a fox peeking over the bar, and the wordmark.
import { Canvas, hex } from './canvas.mjs';
import { mug, peekHead, peekPaws } from './fox.mjs';
import { TAVERN, TALLY, text, measure } from './font.mjs';

const C = {
    wall: hex('#3b2619'), plankLine: hex('#2a190f'), plankLight: hex('#46301f'), knot: hex('#2f1d12'),
    beam: hex('#24150d'), beamLight: hex('#4d3220'),
    shelf: hex('#6e4527'), shelfTop: hex('#93623a'), shelfShadow: hex('#24150d'),
    counterTop: hex('#9a663a'), counterEdge: hex('#c08550'), counter: hex('#5c3720'), counterLine: hex('#43271a'), counterDark: hex('#2e1a10'),
    glow: hex('#ffb84d06'), lampFrame: hex('#1e120b'), lampGlass: hex('#ffd66e'), lampHot: hex('#fff2c2'),
    cork: hex('#c9a26b'), ink: hex('#1e120b'), shadow: hex('#140b06'),
    cream: hex('#fff3e6'), creamLow: hex('#ffd9ad'), accent: hex('#f28c38'), tag: hex('#e3c7a4'),
};
// Small deterministic random numbers, so the picture is the same every build.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function wall(c) {
    c.rect(0, 0, c.w, c.h, C.wall);
    for (let x = 0; x < c.w; x += 22) { c.rect(x, 0, 1, c.h, C.plankLine); c.rect(x + 1, 0, 1, c.h, C.plankLight); }
    for (let i = 0; i < 14; i++) { const x = Math.floor(rnd() * c.w), y = Math.floor(10 + rnd() * 60); c.ellipse(x, y, 1.6, 1, C.knot); }
    c.rect(0, 0, c.w, 5, C.beam); c.rect(0, 5, c.w, 1, C.beamLight);
}
function glow(c, x, y) { for (let r = 50; r > 4; r -= 2) c.ellipse(x, y, r, r * 0.8, C.glow); }
function lantern(c, x) {
    c.line(x, 6, x, 11, C.lampFrame);
    c.rect(x - 4, 11, 9, 2, C.lampFrame);
    c.rect(x - 3, 13, 7, 9, C.lampGlass);
    c.rect(x - 1, 15, 3, 5, C.lampHot);
    c.rect(x - 4, 13, 1, 9, C.lampFrame); c.rect(x + 4, 13, 1, 9, C.lampFrame); c.rect(x, 13, 1, 9, C.lampFrame);
    c.rect(x - 4, 22, 9, 2, C.lampFrame);
}
const BOTTLES = ['#3d7a4a', '#8b2f2f', '#c7801f', '#3b5f8a', '#6b3f7a', '#2f6f6a', '#a8452a'].map(hex);
function shelf(c, x0, x1, y, count = 9) {
    const step = (x1 - x0 - 6) / count;
    for (let i = 0; i < count; i++) {
        const x = Math.round(x0 + 4 + i * step + rnd() * 2);
        const w = 4 + Math.floor(rnd() * 3), h = 8 + Math.floor(rnd() * 5), col = BOTTLES[i % BOTTLES.length];
        c.rect(x, y - h, w, h, col);
        c.rect(x + Math.floor(w / 2) - 1, y - h - 3, 2, 3, col);
        c.rect(x + Math.floor(w / 2) - 1, y - h - 4, 2, 1, C.cork);
        c.rect(x + 1, y - h + 2, 1, h - 4, hex('#ffffff40'));
    }
    c.rect(x0, y, x1 - x0, 1, C.shelfTop); c.rect(x0, y + 1, x1 - x0, 2, C.shelf); c.rect(x0, y + 3, x1 - x0, 1, C.shelfShadow);
}
function counter(c, y) {
    c.rect(0, y, c.w, c.h - y, C.counter);
    for (let x = 12; x < c.w; x += 26) c.rect(x, y + 4, 1, c.h - y - 4, C.counterLine);
    c.rect(0, y, c.w, 3, C.counterTop); c.rect(0, y, c.w, 1, C.counterEdge); c.rect(0, y + 3, c.w, 1, C.counterDark);
    c.rect(0, c.h - 2, c.w, 2, C.counterDark);
}
// The wordmark: cream letters with a warm lower half, an ink outline and a drop shadow.
function wordmark(c, x, y) {
    const t = new Canvas(c.w, c.h);
    text(t, TAVERN, 'SillyTavern', x, y, C.cream, { scale: 2, gap: 1 });
    t.shade(C.cream, C.creamLow, (_, py) => py >= y + 12);
    t.outline(C.ink);
    const s = new Canvas(c.w, c.h);
    text(s, TAVERN, 'SillyTavern', x + 2, y + 2, C.shadow, { scale: 2, gap: 1 });
    s.outline(C.shadow);
    c.draw(s, 0, 0); c.draw(t, 0, 0);
    const d = new Canvas(c.w, c.h);
    text(d, TALLY, 'DESKTOP', x + 2, y + 25, C.accent, { scale: 2, gap: 2 });
    d.outline(C.ink);
    c.draw(d, 0, 0);
}

// Initials a regular scratched into the bar front, long ago.
function carving(c, x, y) {
    const col = C.counterDark;
    c.rect(x, y, 1, 5, col);
    c.line(x + 3, y, x + 7, y + 4, col);
    c.line(x + 7, y, x + 3, y + 4, col);
}

export function banner() {
    seed = 7;
    const c = new Canvas(320, 100);
    wall(c);
    glow(c, 140, 18); glow(c, 302, 18);
    shelf(c, 170, 288, 22);
    lantern(c, 140); lantern(c, 302);
    // a fox peeks over the bar, drawn 1.5× bigger than the rest of the scene
    const k = 1.5, fx = 4, fy = 24;
    c.draw(peekHead(k), fx, fy);
    counter(c, 82);
    carving(c, 247, 89);
    c.draw(peekPaws(k), fx, fy);
    c.draw(mug(88, 63, c.w, c.h), 0, 0); // the fox's pint, by its paw
    wordmark(c, 112, 28);
    const tag = 'YOUR SILLYTAVERN, ONE CLICK AWAY';
    text(c, TALLY, tag, 114, 71, C.tag, { gap: 1 });
    return c;
}
// The same room without anyone in it, for the Tavern Night example theme.
export function tavernRoom(w, h) {
    seed = 7;
    const c = new Canvas(w, h);
    wall(c);
    glow(c, 70, 18); glow(c, w - 40, 18);
    shelf(c, 96, w - 60, 40);
    lantern(c, 70); lantern(c, w - 40);
    counter(c, h - 26);
    return c;
}
export { measure };
