// The word engine of the Writing helper: builds the dictionary from the
// downloaded word lists and answers "is this a word", "how could this word
// end" and "what was meant". Plain Node (no Electron), so it can be tested
// on its own.
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- zip (just enough for the SCOWL dictionary zip) ----------
// Reads the central directory, inflates the named entry.
function unzipEntry(buf, name) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    let p = buf.readUInt32LE(eocd + 16);
    const count = buf.readUInt16LE(eocd + 10);
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
        const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
        if (entry === name || entry.endsWith(`/${name}`)) {
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            const data = buf.subarray(start, start + size);
            if (method === 0) return data;
            if (method === 8) return zlib.inflateRawSync(data);
            throw new Error(`unsupported zip method ${method}`);
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`${name} is not in the zip`);
}

// ---------- Hunspell .aff/.dic → every word form ----------
// Enough of Hunspell for SCOWL's English files: PFX/SFX with conditions and
// cross products, single-character flags, NOSUGGEST. Words with digits
// (ordinals, compounds) are skipped.
function parseAff(text) {
    const rules = {}; // flag → { type, cross, list: [{ strip, add, cond }] }
    let nosuggest = '';
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim().split(/\s+/);
        if (t[0] === 'NOSUGGEST') nosuggest = t[1];
        if (t[0] !== 'PFX' && t[0] !== 'SFX') continue;
        const [type, flag] = t;
        if (!rules[flag] && /^[YN]$/.test(t[2])) { rules[flag] = { type, cross: t[2] === 'Y', list: [] }; continue; }
        if (!rules[flag]) continue;
        const strip = t[2] === '0' ? '' : t[2];
        const add = (t[3] || '0').split('/')[0];
        const cond = t[4] && t[4] !== '.' ? t[4] : '';
        const re = cond ? new RegExp(type === 'SFX' ? `${cond}$` : `^${cond}`) : null;
        rules[flag].list.push({ strip, add: add === '0' ? '' : add, re });
    }
    return { rules, nosuggest };
}
function applyRule(word, rule, r) {
    if (r.re && !r.re.test(word)) return null;
    if (rule.type === 'SFX') {
        if (r.strip && !word.endsWith(r.strip)) return null;
        return word.slice(0, word.length - r.strip.length) + r.add;
    }
    if (r.strip && !word.startsWith(r.strip)) return null;
    return r.add + word.slice(r.strip.length);
}
// → Map word → nosuggest (true/false)
function expandHunspell(affText, dicText) {
    const { rules, nosuggest } = parseAff(affText);
    const out = new Map();
    const put = (w, ns) => { if (!out.has(w) || out.get(w)) out.set(w, ns); };
    const lines = dicText.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const slash = line.indexOf('/');
        const word = slash < 0 ? line : line.slice(0, slash);
        const flags = slash < 0 ? '' : line.slice(slash + 1).split(/\s/)[0];
        if (/\d/.test(word)) continue;
        const ns = !!nosuggest && flags.includes(nosuggest);
        put(word, ns);
        const pfx = [], sfx = [];
        for (const f of flags) {
            const rule = rules[f];
            if (!rule) continue;
            (rule.type === 'PFX' ? pfx : sfx).push(rule);
        }
        const suffixed = [];
        for (const rule of sfx) for (const r of rule.list) {
            const w = applyRule(word, rule, r);
            if (w) { put(w, ns); if (rule.cross) suffixed.push(w); }
        }
        for (const rule of pfx) for (const r of rule.list) {
            const w = applyRule(word, rule, r);
            if (!w) continue;
            put(w, ns);
            if (rule.cross) for (const s of suffixed) { const ws = applyRule(s, rule, r); if (ws) put(ws, ns); }
        }
    }
    return out;
}

// SCOWL marks offensive words NOSUGGEST. Plain vulgar words may be
// suggested (people write them on purpose); the rest (slurs) are accepted
// as spelled right but never suggested.
const VULGAR = /^(ass|asshole|bullshit|chickenshit|cocksucker|cunt|fuck|horseshit|motherfuck|shat|shit)/i;

// ---------- edit distance (optimal string alignment) ----------
function distance(a, b, max = 2) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const rows = [];
    for (let i = 0; i <= a.length; i++) rows.push([i]);
    for (let j = 1; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        let best = Infinity;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
            rows[i][j] = v;
            if (v < best) best = v;
        }
        if (best > max) return max + 1;
    }
    return rows[a.length][b.length];
}
function deletes(word, depth) {
    const out = new Set([word]);
    let edge = [word];
    for (let d = 0; d < depth; d++) {
        const next = [];
        for (const w of edge) for (let i = 0; i < w.length; i++) {
            const v = w.slice(0, i) + w.slice(i + 1);
            if (!out.has(v)) { out.add(v); next.push(v); }
        }
        edge = next;
    }
    return out;
}

// Contractions people type without the apostrophe. Only ones that are never
// a real word on their own ("cant", "wont", "its", "were", "ill", "id",
// "well", "lets", "hell", "shell", "wed" are words, so they're left alone).
const CONTRACTIONS = {
    dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", wasnt: "wasn't", arent: "aren't", werent: "weren't",
    havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
    mustnt: "mustn't", neednt: "needn't", aint: "ain't", im: "I'm", ive: "I've", youre: "you're", youve: "you've",
    youll: "you'll", youd: "you'd", theyre: "they're", theyve: "they've", theyll: "they'll", theyd: "they'd",
    wouldve: "would've", couldve: "could've", shouldve: "should've", mightve: "might've", whats: "what's",
    thats: "that's", hes: "he's", shes: "she's", yall: "y'all", wheres: "where's", whos: "who's",
    hows: "how's", theres: "there's", heres: "here's", i: 'I', "i'm": "I'm", "i've": "I've", "i'll": "I'll", "i'd": "I'd",
};

// Words run together or split wrong, that a one-letter fix can't repair.
const FIXES = {
    alot: 'a lot', eachother: 'each other', infront: 'in front', aswell: 'as well', noone: 'no one',
    everytime: 'every time', atleast: 'at least', thankyou: 'thank you', ofcourse: 'of course',
};

// ---------- the dictionary ----------
class Lexicon {
    // sources: { words: Map word→nosuggest (SCOWL), freq: Map lower→count,
    //            adult: [words], adultOn: bool }
    constructor({ words, freq, adult = [], adultOn = true }) {
        // lower → its spellings: '' (only the lowercase one), a string (one
        // other spelling, like "London") or an array. Compact on purpose:
        // with objects per word this took ~125 MB in the app.
        this.base = new Map();
        this.nosug = new Set();  // lower: never suggested (slurs)
        for (const [w, ns] of words) this.addBase(w, ns && !VULGAR.test(w));
        this.adult = new Set(adultOn ? adult.map(w => w.toLowerCase()) : []);
        if (adultOn) for (const w of adult) this.addBase(w, false);
        this.freq = freq;
        this.user = new Map();    // lower → Set of exact forms (the user's dictionary)
        this.names = new Map();   // lower → exact form (characters, personas, lorebooks)
        this.ignored = new Set(); // lower: never correct or flag
        this.learned = new Map(); // lower → count (words the user writes)
        this.bigrams = new Map(); // prev lower → Map next lower → count
        this.dirty = true;
    }
    addBase(w, nosuggest) {
        const l = w.toLowerCase();
        const cur = this.base.get(l);
        const form = w === l ? '' : w;
        if (cur === undefined) {
            this.base.set(l, form);
            if (nosuggest) this.nosug.add(l);
            return;
        }
        if (!nosuggest) this.nosug.delete(l);
        const list = Array.isArray(cur) ? cur : [cur];
        if (!list.includes(form)) this.base.set(l, [...list, form]);
    }
    // The spellings of a lowercase word in the main dictionary, or null.
    forms(l) {
        const v = this.base.get(l);
        if (v === undefined) return null;
        return (Array.isArray(v) ? v : [v]).map(f => f || l);
    }
    preferred(l) { const f = this.forms(l); return !f ? l : f.includes(l) ? l : f[0]; }
    setUser(words) {
        this.user.clear();
        for (const w of words) {
            const l = w.toLowerCase();
            if (!this.user.has(l)) this.user.set(l, new Set());
            this.user.get(l).add(w);
        }
        this.dirty = true;
    }
    setNames(names) {
        this.names.clear();
        for (const n of names) this.names.set(n.toLowerCase(), n);
        this.dirty = true;
    }

    // Spelled right? Case matters only for words that are always capitalized
    // in the dictionary ("london" is wrong, "London" right); a capital first
    // letter or ALL CAPS is fine for any word.
    known(word) {
        if (!word) return true;
        const l = word.toLowerCase();
        if (this.ignored.has(l) || this.names.has(l)) return true;
        if (this.user.has(l)) {
            const forms = this.user.get(l);
            if (forms.has(word) || forms.has(l) || word === word.toUpperCase()) return true;
            for (const f of forms) if (f[0] === f[0].toLowerCase() && word === cap(f)) return true;
        }
        const forms = this.forms(l);
        if (!forms) return false;
        if (forms.includes(word) || forms.includes(l) || word === word.toUpperCase()) return true;
        for (const f of forms) if (word === cap(f) || cap(word) === f) return true;
        return false;
    }

    // Words worth offering (no slurs, no obscure dictionary-only words unless
    // the user or a name has them).
    suggestable() {
        if (!this.dirty) return this.vocab;
        // lower → [word, score, special]; special = from the adult pack, the
        // user's dictionary or a name (autocorrect doesn't guess against those).
        const vocab = new Map();
        const add = (l, word, score, special = false) => { const v = vocab.get(l); if (!v || v[1] < score) vocab.set(l, [word, score, special || !!v?.[2]]); else if (special) v[2] = true; };
        for (const [l, count] of this.freq) {
            if (!this.base.has(l) || this.nosug.has(l)) continue;
            add(l, this.preferred(l), Math.log10(count + 1));
        }
        // Adult words: about as likely as an everyday word when missing from the subtitles list.
        for (const l of this.adult) if (this.base.has(l) && !this.nosug.has(l)) add(l, this.preferred(l), Math.log10((this.freq.get(l) || 3000) + 1), true);
        for (const [l, forms] of this.user) add(l, forms.has(l) ? l : [...forms][0], 6, true);
        for (const [l, n] of this.names) add(l, n, 6.5, true);
        for (const [l, c] of this.learned) if (vocab.has(l)) vocab.get(l)[1] += Math.min(2, Math.log10(c + 1));
        this.vocab = vocab;
        this.sorted = [...vocab.keys()].sort();
        // Deletes (distance 1) of every suggestable word, for corrections.
        // A string for one word, an array for more (most have one).
        this.del = new Map();
        for (const l of this.sorted) if (l.length > 1) for (const d of deletes(l, 1)) {
            const a = this.del.get(d);
            if (a === undefined) this.del.set(d, l);
            else if (Array.isArray(a)) a.push(l);
            else this.del.set(d, [a, l]);
        }
        this.dirty = false;
        return vocab;
    }

    // Words starting with `prefix` (the part of the word typed so far).
    complete(prefix, prev = '', n = 3) {
        const vocab = this.suggestable();
        const p = prefix.toLowerCase();
        const next = prev ? this.bigrams.get(prev.toLowerCase()) : null;
        if (!p) {
            // Nothing typed yet: what usually comes after `prev`.
            if (!next) return [];
            return [...next.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([l]) => vocab.get(l)?.[0] || l);
        }
        let lo = 0, hi = this.sorted.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (this.sorted[m] < p) lo = m + 1; else hi = m; }
        const found = [];
        for (let i = lo; i < this.sorted.length && this.sorted[i].startsWith(p); i++) {
            const l = this.sorted[i];
            if (l === p) continue;
            const v = vocab.get(l);
            found.push({ word: v[0], score: v[1] + (next?.get(l) ? 2 + Math.log10(next.get(l)) : 0) - (l.length - p.length) * 0.02 });
        }
        return found.sort((a, b) => b.score - a.score).slice(0, n).map(f => matchCase(prefix, f.word));
    }

    // Close words for a misspelled one, best first: [{ word, dist, score, special }].
    // Two swapped letters ("teh", "recieve") are the most common typo, so
    // such a candidate counts as more likely than another one-letter change.
    corrections(word, n = 3) {
        const vocab = this.suggestable();
        const l = word.toLowerCase();
        const sortedL = [...l].sort().join('');
        const seen = new Set();
        const out = [];
        for (const d of deletes(l, 2)) {
            const hit = this.del.get(d);
            const list = hit === undefined ? [] : Array.isArray(hit) ? hit : [hit];
            for (const c of vocab.has(d) ? [...list, d] : list) {
                if (seen.has(c)) continue;
                seen.add(c);
                const dist = distance(l, c, 2);
                if (dist > 2) continue;
                const v = vocab.get(c);
                const swapped = c.length === l.length && [...c].sort().join('') === sortedL;
                out.push({ word: matchCase(word, v[0]), dist, score: v[1] + (swapped ? 0.8 : 0), special: v[2] });
            }
        }
        return out.sort((a, b) => a.dist - b.dist || b.score - a.score).slice(0, n);
    }

    // Autocorrect: a replacement only when it is clearly what was meant.
    autocorrect(word, prev = '') {
        if (!word || word.length > 30) return null;
        const l = word.toLowerCase();
        if (this.ignored.has(l)) return null;
        // "i" → "I", "dont" → "don't" (even though "dont" is common in chats)
        if (CONTRACTIONS[l] && !this.user.has(l) && !this.names.has(l)) {
            const to = CONTRACTIONS[l];
            const out = l === 'i' || /^i'/.test(l) || to.startsWith('I') ? to : matchCase(word, to);
            return out === word ? null : out;
        }
        if (FIXES[l] && !this.user.has(l)) return matchCase(word, FIXES[l]);
        // "THe" → "The" (two capitals by accident)
        if (/^[A-Z]{2}[a-z]+$/.test(word) && this.known(word[0] + word.slice(1).toLowerCase())) return word[0] + word.slice(1).toLowerCase();
        if (this.known(word) || l.length < 3 || /[^a-z'’-]/i.test(word)) return null;
        // Capitalized mid-sentence words are probably names: leave them.
        if (prev && /^[A-Z]/.test(word) && !/[.!?]$/.test(prev)) return null;
        const c = this.corrections(word, 4);
        if (!c.length || c[0].score < 3) return null;
        const rivals = c.slice(1).filter(x => x.dist === c[0].dist);
        // Equally close to a word from the packs, the user's dictionary or a
        // name ("cuming": coming or cumming?): don't guess.
        if (rivals.some(x => x.special) && !c[0].special) return null;
        if (c[0].dist === 1) {
            if (rivals.length && c[0].score - rivals[0].score < 1) return null; // not sure enough (~10× more likely)
            return c[0].word;
        }
        // Two changes away: only a long word with nothing else close ("tommorow").
        return c[0].dist === 2 && l.length >= 6 && !rivals.length && c[0].score >= 3.5 ? c[0].word : null;
    }

    // What the user writes: word counts and word pairs, for better guesses.
    learn(text) {
        const words = tokens(text);
        for (let i = 0; i < words.length; i++) {
            const l = words[i].toLowerCase();
            if (!this.known(words[i])) continue;
            this.learned.set(l, (this.learned.get(l) || 0) + 1);
            if (i > 0) {
                const p = words[i - 1].toLowerCase();
                if (!this.bigrams.has(p)) this.bigrams.set(p, new Map());
                const m = this.bigrams.get(p);
                m.set(l, (m.get(l) || 0) + 1);
            }
        }
        this.dirty = true;
    }
    // Keeps the learned data small: the most frequent pairs only.
    exportLearned(maxPairs = 60000) {
        const pairs = [];
        for (const [p, m] of this.bigrams) for (const [n, c] of m) pairs.push([p, n, c]);
        pairs.sort((a, b) => b[2] - a[2]);
        const words = [...this.learned.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30000);
        return { v: 1, words, pairs: pairs.slice(0, maxPairs) };
    }
    importLearned(d) {
        this.learned = new Map(d?.words || []);
        this.bigrams = new Map();
        for (const [p, n, c] of d?.pairs || []) {
            if (!this.bigrams.has(p)) this.bigrams.set(p, new Map());
            this.bigrams.get(p).set(n, c);
        }
        this.dirty = true;
    }
}

const cap = w => (w ? w[0].toUpperCase() + w.slice(1) : w);
// The suggestion in the case the user is typing: "Hel" → "Hello", "HEL" → "HELLO".
function matchCase(typed, word) {
    if (!typed || word !== word.toLowerCase()) return word; // names and "I" keep theirs
    if (typed.length > 1 && typed === typed.toUpperCase() && /[A-Z]/.test(typed)) return word.toUpperCase();
    if (/^[A-Z]/.test(typed)) return cap(word);
    return word;
}
const tokens = text => String(text).match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu) || [];

// FrequencyWords: "word count" per line.
function parseFreq(text) {
    const m = new Map();
    for (const line of text.split(/\r?\n/)) {
        const sp = line.lastIndexOf(' ');
        if (sp > 0) m.set(line.slice(0, sp).toLowerCase(), Number(line.slice(sp + 1)) || 0);
    }
    return m;
}

module.exports = { unzipEntry, expandHunspell, parseFreq, Lexicon, distance, tokens, matchCase, CONTRACTIONS, FIXES, VULGAR };
