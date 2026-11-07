// Which common words does the engine lack? Uses only public word lists, no user data.
// node audit.cjs [addon dir]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ADDON = process.argv[2] || require('path').resolve(__dirname, '../../addons/writing-helper');
const L = require(path.join(ADDON, 'lexicon.cjs'));
const DL = path.join(__dirname, 'keep');
const zip = fs.readFileSync(path.join(DL, 'hunspell-en_US-large-2026.02.25.zip'));
const aff = L.unzipEntry(zip, 'en_US-large.aff').toString('utf8'), dic = L.unzipEntry(zip, 'en_US-large.dic').toString('utf8');
const words = L.expandHunspell(aff, dic);
const pack = n => fs.readFileSync(path.join(ADDON, 'packs', n), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
for (const w of pack('roleplay.txt')) words.set(w, false);
const scene = { strong: [], mild: [] }; let part = 'strong';
for (const l of fs.readFileSync(path.join(ADDON, 'packs', 'adult-context.txt'), 'utf8').split(/\r?\n/).map(x => x.trim())) { const m = /^##\s*(strong|mild)\b/.exec(l); if (m) part = m[1]; else if (l && !l.startsWith('#')) scene[part].push(l); }
const freqText = fs.readFileSync(path.join(DL, 'en_50k.txt'), 'utf8');
const freq = L.parseFreq(freqText);
const lex = new L.Lexicon({ words, freq, adult: pack('adult.txt'), adultOn: true, common: [...pack('roleplay.txt'), ...pack('common.txt')], scene });
lex.setGeneralPairs(zlib.gunzipSync(fs.readFileSync(path.join(ADDON, 'data', 'pairs.txt.gz'))).toString('utf8'));
lex.suggestable();
console.log('base', lex.base.size, 'vocab', lex.vocab.size, 'freq', freq.size);
const show = w => { const l = w.toLowerCase(); return { w, base: lex.base.has(l), nosug: lex.nosug.has(l), freq: freq.get(l) ?? null, vocab: lex.vocab.has(l), known: lex.known(w), adult: lex.adult.has(l), strong: lex.explicit.has(l) }; };
for (const w of ['cant', "can't", 'pregnant', "don't", 'dont', "won't", "i'm", "I'm", "it's", "that's", 'cannot', 'gonna', 'wanna', 'okay', 'ok']) console.log(JSON.stringify(show(w)));
const top = p => { const r = lex.suggest(p, '', { adultRow: true, sceneBoost: true }); return [...r.words, '|', ...r.adult].join(' '); };
for (const p of ['preg', 'pregn', 'pregna', 'can', "can'", 'cant', 'don', "don'", 'wo', 'won', "won'", "shouldn'", 'shoul', "they'", "I'"]) console.log(JSON.stringify(p), '=>', top(p));
// Contractions and the top of the frequency list.
const contr = ["can't", "don't", "won't", "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't", "doesn't", "didn't", "wouldn't", "couldn't", "shouldn't", "mustn't", "needn't", "shan't", "ain't", "I'm", "I've", "I'll", "I'd", "you're", "you've", "you'll", "you'd", "he's", "he'll", "he'd", "she's", "she'll", "she'd", "it's", "it'll", "it'd", "we're", "we've", "we'll", "we'd", "they're", "they've", "they'll", "they'd", "that's", "that'll", "that'd", "there's", "there'll", "here's", "what's", "what'll", "who's", "who'll", "who'd", "where's", "how's", "when's", "why's", "let's", "y'all", "ma'am", "o'clock", "would've", "could've", "should've", "might've", "must've"];
console.log('contractions not suggested:', contr.filter(w => !lex.vocab.has(w.toLowerCase())).join(' '));
console.log('contractions not known:', contr.filter(w => !lex.known(w)).join(' '));
const ranks = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
const onlyLetters = ranks.filter(w => /^[a-z']+$/.test(w));
for (const n of [1000, 5000, 10000, 20000, 50000]) { const list = onlyLetters.slice(0, n); const miss = list.filter(w => !lex.vocab.has(w)); console.log(`top ${n}: not suggestable ${miss.length}; not in base ${list.filter(w => !lex.base.has(w)).length}; nosug ${list.filter(w => lex.nosug.has(w)).length}`); if (n <= 5000) console.log('   ', miss.slice(0, 120).join(' ')); }
console.log('freq has apostrophes:', [...freq.keys()].filter(w => w.includes("'")).length, ' base has apostrophes:', [...lex.base.keys()].filter(w => w.includes("'")).length);
// word forms of common words that the frequency list lacks
const notFreq = [...lex.base.keys()].filter(l => !lex.vocab.has(l) && /^[a-z]+$/.test(l));
console.log('dictionary words never suggested:', notFreq.length);
const samples = ['pregnancy', 'pregnant', 'unfortunately', 'whispering', 'whimpering', 'trembling', 'shuddering', 'breathlessly', 'hesitantly', 'tentatively', 'smirking', 'grinning', 'chuckling', 'giggling', 'blushing', 'flushed', 'nervously', 'gently', 'softly', 'slowly', 'quietly', 'carefully', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'doorway', 'teasingly', 'playfully', 'sheepishly', 'wincing', 'gasping', 'panting', 'moaning', 'tightening', 'loosening', 'caressing', 'nuzzling', 'cuddling', 'snuggling', 'embarrassed', 'embarrassing', 'beautiful', 'gorgeous', 'adorable', 'mischievous', 'mischievously'];
console.log('sample words not suggested:', samples.filter(w => !lex.vocab.has(w)).join(' '));
