// Zips a desktop add-on from this folder for the "Get add-ons" list and
// prints its catalog entry (with the zip's SHA256 and size).
//   node addons/build.cjs writing-helper [outDir]
// The zip has the add-on's files in a folder named after it. Upload it to a
// release, put the release URL in "download", and add the entry to
// catalog.json in the sillytavern-desktop-extensions repository.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yazl = require('yazl');

const id = process.argv[2];
const src = path.join(__dirname, id || '');
if (!id || !fs.existsSync(path.join(src, 'manifest.json'))) { console.error('usage: node addons/build.cjs <add-on folder>'); process.exit(1); }
const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'dist'));
const file = path.join(out, `${id}-${m.version}.zip`);
fs.mkdirSync(out, { recursive: true });

const zip = new yazl.ZipFile();
const walk = (dir, rel = '') => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        // Never pack what an installed copy saves for itself.
        if (!rel && ['user', 'downloads', 'data.json', '.desktop-addon.json'].includes(d.name)) continue;
        if (d.isDirectory()) walk(path.join(dir, d.name), r);
        // Fixed dates: the same files give the same zip (and SHA256).
        else zip.addFile(path.join(dir, d.name), `${id}/${r}`, { mtime: new Date('2026-01-01T00:00:00Z') });
    }
};
walk(src);
zip.outputStream.pipe(fs.createWriteStream(file)).on('close', () => {
    const buf = fs.readFileSync(file);
    const entry = {
        id, name: m.name, version: m.version, author: m.author, description: m.description,
        homepage: `https://github.com/Lab-Fox/sillytavern-desktop/tree/main/addons/${id}`,
        minAppVersion: m.minAppVersion, uses: m.uses || [],
        download: `https://github.com/Lab-Fox/sillytavern-desktop-extensions/releases/download/${id}-${m.version}/${id}-${m.version}.zip`,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length,
    };
    console.log(file);
    console.log(JSON.stringify(entry, null, 4));
});
zip.end();
