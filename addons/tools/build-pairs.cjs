// Builds the Writing helper's word-pair table (which word usually follows
// which) from public-domain books, e.g. Project Gutenberg plain-text files.
//   node addons/tools/build-pairs.cjs <out.txt.gz> <book.txt…>
// Output (gzip, text): one line per word, "word<TAB>next count next count…",
// at most 40 next words each, counts of 2 or more, only the 25,000 most
// common words. Sentences are counted on their own; letters only, lower case.
//
// The shipped data/pairs.txt.gz (Writing helper 1.1.0) was built from these
// Project Gutenberg books, https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt:
// 84 345 1260 768 98 1400 174 1661 11 55 62 120 514 45 36 35 76 215 158 161
// 105 16 829 2591 1184 2097 244 3289 1257 2852. Pride and Prejudice (1342) and
// Carmilla (10007) were left out on purpose: they are the benchmark texts.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const [out, ...books] = process.argv.slice(2);
if (!out || !books.length) { console.error('usage: build-pairs.cjs <out.txt.gz> <book.txt…>'); process.exit(1); }

const uni = new Map();
const pairs = new Map();
const MAX = 40, MIN = 2; // next words per word, smallest count (benchmarked: more barely helps)
for (const f of books) {
    let text = fs.readFileSync(f, 'utf8');
    // Project Gutenberg's own header and licence are not part of the book.
    const a = text.indexOf('*** START'), b = text.indexOf('*** END');
    if (a >= 0) text = text.slice(text.indexOf('\n', a) + 1, b > a ? b : undefined);
    for (const sentence of text.replace(/\r/g, '').split(/[.!?;:"“”()\n]{1,}\s*(?=\S)|\n\s*\n/)) {
        const toks = (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).map(t => t.toLowerCase().replace(/’/g, "'"));
        for (let i = 0; i < toks.length; i++) {
            uni.set(toks[i], (uni.get(toks[i]) || 0) + 1);
            if (i === 0) continue;
            let m = pairs.get(toks[i - 1]);
            if (!m) pairs.set(toks[i - 1], m = new Map());
            m.set(toks[i], (m.get(toks[i]) || 0) + 1);
        }
    }
}
const common = new Set([...uni].sort((x, y) => y[1] - x[1]).slice(0, 25000).map(([w]) => w));
const lines = [];
let kept = 0;
for (const [p, m] of pairs) {
    if (!common.has(p)) continue;
    const next = [...m].filter(([w, c]) => c >= MIN && common.has(w)).sort((x, y) => y[1] - x[1]).slice(0, MAX);
    if (!next.length) continue;
    kept += next.length;
    lines.push(`${p}\t${next.map(([w, c]) => `${w} ${c}`).join(' ')}`);
}
lines.sort();
const gz = zlib.gzipSync(lines.join('\n') + '\n', { level: 9, mtime: 0 });
fs.writeFileSync(out, gz);
console.log(`${books.length} books, ${uni.size} words, ${lines.length} words with pairs, ${kept} pairs, ${gz.length} bytes`);
