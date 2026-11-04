// node tools/art/build.mjs → docs/images/*.png (the README's banner and the font sheet).
// Every picture is drawn by these scripts; nothing is downloaded or traced.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './canvas.mjs';
import { banner } from './banner.mjs';
import { TAVERN, TALLY, text } from './font.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'images');
fs.mkdirSync(out, { recursive: true });
const save = (c, name) => console.log(c.save(path.join(out, name)), `${c.w}×${c.h}`);

save(banner().scale(4), 'banner.png');

// Font sheet: both fonts on the banner's wall color.
const sheet = new Canvas(220, 66);
sheet.rect(0, 0, sheet.w, sheet.h, hex('#3b2619'));
text(sheet, TAVERN, 'SillyTavern', 6, 6, hex('#fff3e6'));
text(sheet, TAVERN, 'DSTaeilnrvy', 90, 6, hex('#f28c38'));
text(sheet, TALLY, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 6, 26, hex('#e3c7a4'));
text(sheet, TALLY, '0123456789 ,.·-', 6, 38, hex('#e3c7a4'));
text(sheet, TALLY, 'TAVERN AND TALLY, BY FOX', 6, 52, hex('#f28c38'));
save(sheet.scale(4), 'fonts.png');
