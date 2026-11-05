// node tools/art/themes.mjs → the pictures of the example themes in examples/themes.
// Drawn here like the banner: nothing is downloaded or traced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './canvas.mjs';
import { tavernRoom } from './banner.mjs';
import { fox } from './fox.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'themes');
const save = (c, theme, name) => {
    const dir = path.join(root, theme, 'assets');
    fs.mkdirSync(dir, { recursive: true });
    console.log(c.save(path.join(dir, name)), `${c.w}×${c.h}`);
};

// A small GIF writer. Each pixel gets its own clear code, which needs no real
// compression and is still a valid GIF: fine for a picture this size.
function gif(w, h, palette, frames, delay) {
    const out = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0xf1, 0, 0]), Buffer.from(palette.flat()),
        Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
    for (const frame of frames) {
        out.push(Buffer.from([0x21, 0xf9, 4, 0b1001, delay, 0, 3, 0, 0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 2]));
        let bits = 0, n = 0;
        const bytes = [];
        const put = code => { bits |= code << n; n += 3; while (n >= 8) { bytes.push(bits & 255); bits >>= 8; n -= 8; } };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { put(4); put(frame(x, y)); }
        put(5);
        if (n) bytes.push(bits & 255);
        for (let i = 0; i < bytes.length; i += 255) { const s = bytes.slice(i, i + 255); out.push(Buffer.from([s.length, ...s])); }
        out.push(Buffer.from([0]));
    }
    out.push(Buffer.from([0x3b]));
    return Buffer.concat(out);
}

// Tavern Night: the room, a fox for each server state, a lantern that flickers.
save(tavernRoom(320, 200), 'tavern-night', 'room.png');
save(fox('sleep', { fan: false }).scale(2), 'tavern-night', 'fox-asleep.png');
save(fox('cheers', { fan: false }).scale(2), 'tavern-night', 'fox-awake.png');
{
    const W = 12, H = 22;
    // 0 frame, 1 glass, 2 bright flame, 3 clear
    const lamp = hot => (x, y) => {
        if (y < 4) return x === 6 ? 0 : 3;
        if (y < 6 || y > 19) return x >= 2 && x <= 10 ? 0 : 3;
        if (x < 3 || x > 9) return 3;
        if (x === 3 || x === 9) return 0;
        const d = Math.abs(x - 6), top = 15 - hot;
        return y > top - d && y < 19 && d <= hot ? 2 : 1;
    };
    const file = path.join(root, 'tavern-night', 'assets', 'lantern.gif');
    fs.writeFileSync(file, gif(W, H, [[30, 18, 11], [255, 190, 90], [255, 242, 194], [0, 0, 0]], [lamp(2), lamp(1), lamp(3), lamp(2), lamp(1)], 14));
    console.log(file);
}

// Soft Glass: two soft lights on a dark wall. Smooth on purpose.
{
    const c = new Canvas(640, 400);
    const light = (x, y, cx, cy, r) => Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r) ** 2;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const a = light(x, y, 130, 90, 420), b = light(x, y, 560, 340, 460), m = light(x, y, 400, 40, 260);
        c.px(x, y, [Math.round(24 + 92 * a + 30 * b + 40 * m), Math.round(26 + 34 * a + 66 * b + 20 * m), Math.round(46 + 120 * a + 112 * b + 70 * m), 255]);
    }
    save(c, 'soft-glass', 'wall.png');
}
void hex;
