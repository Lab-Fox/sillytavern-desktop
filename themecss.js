// The check every theme's CSS goes through, each time it is loaded: themes are
// shared files, and this CSS runs in the app's own pages. Two passes: parse and
// rebuild it (so what the browser gets is what was checked, not the author's
// spelling of it), then read the rebuilt text token by token. The second pass
// doesn't trust the first: anything the parser couldn't understand stays in the
// text as it was, and CSS escapes can spell url() in ways a simple search misses.
// Plain Node, so it can be tested outside the app.

export const MAX_CSS_BYTES = 512 * 1024;
const AT_RULES = new Set(['media', 'supports', 'keyframes', '-webkit-keyframes', 'font-face', 'container', 'property', 'starting-style']);
// Would fetch or draw something the url() check can't see.
const FUNCTIONS = new Set(['src', 'element', 'paint', 'image', '-webkit-cross-fade', 'cross-fade']);
const IMAGE_SETS = new Set(['image-set', '-webkit-image-set']);
const PROPERTIES = new Set(['-webkit-app-region', 'behavior', '-moz-binding']);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i;
const SAFE_PATH = /^[\w .()\- -￿]+(\/[\w .()\- -￿]+)*$/;

let lib = null;
async function load() {
    if (lib) return lib;
    // Only when a theme has CSS: most starts never need them.
    const [parser, generator, walker, tokenizer, utils] = await Promise.all([
        import('css-tree/parser'), import('css-tree/generator'), import('css-tree/walker'), import('css-tree/tokenizer'), import('css-tree/utils'),
    ]);
    lib = { parse: parser.default, generate: generator.default, walk: walker.default, ...tokenizer, utils };
    return lib;
}

// A url() inside a theme: a file of its package, or a small inline picture.
// Returns the address the page should use, or null.
export function themeUrl(value, packageId) {
    const v = String(value).trim();
    if (DATA_IMAGE.test(v)) return v;
    const rel = v.replace(/^\.\//, '');
    if (!SAFE_PATH.test(rel) || rel.split('/').some(p => p === '.' || p === '..')) return null;
    return `st-theme://${packageId}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}
const isOurs = (value, packageId) => DATA_IMAGE.test(value) || value.startsWith(`st-theme://${packageId}/`);

// The second pass, over the text the browser will get.
function audit(css, packageId, L) {
    const { tokenize, tokenTypes: T, utils } = L;
    const problems = [];
    const stack = []; // open blocks and functions
    const closes = { [T.LeftCurlyBracket]: T.RightCurlyBracket, [T.LeftParenthesis]: T.RightParenthesis, [T.LeftSquareBracket]: T.RightSquareBracket, [T.Function]: T.RightParenthesis };
    let afterUrl = false;
    tokenize(css, (type, start, end) => {
        const text = css.slice(start, end);
        if (type === T.WhiteSpace || type === T.Comment) {
            if (type === T.Comment && !text.endsWith('*/')) problems.push('A comment is never closed.');
            return;
        }
        if (afterUrl) {
            afterUrl = false;
            if (type === T.String) {
                if (!isOurs(utils.string.decode(text), packageId)) problems.push(`url(${text}) is not allowed.`);
                return;
            }
            if (type !== T.RightParenthesis) problems.push('url() must hold one address.');
        }
        if (type === T.BadString || type === T.BadUrl) problems.push('Broken text or url().');
        else if (type === T.Url) {
            if (!isOurs(utils.url.decode(text), packageId)) problems.push(`${text} is not allowed.`);
        } else if (type === T.AtKeyword) {
            const name = utils.ident.decode(text.slice(1)).toLowerCase();
            if (!AT_RULES.has(name)) problems.push(`@${name} is not allowed.`);
        } else if (type === T.Function) {
            const name = utils.ident.decode(text.slice(0, -1)).toLowerCase();
            if (name === 'url') afterUrl = true;
            else if (FUNCTIONS.has(name)) problems.push(`${name}() is not allowed.`);
            stack.push({ want: closes[T.Function], imageSet: IMAGE_SETS.has(name) });
        } else if (closes[type] !== undefined) {
            stack.push({ want: closes[type] });
        } else if (type === T.RightCurlyBracket || type === T.RightParenthesis || type === T.RightSquareBracket) {
            if (stack.pop()?.want !== type) problems.push('Brackets don\'t match.');
        } else if (type === T.String && stack.at(-1)?.imageSet) {
            problems.push('image-set() needs url("…") around each picture.');
        }
    });
    if (stack.length) problems.push('Brackets don\'t match.');
    return problems;
}

// For "Check this theme": what a stylesheet leans on.
export async function usedNames(source) {
    const L = await load();
    const classes = new Set(), vars = new Set();
    let setsFont = false;
    L.walk(L.parse(source, { parseCustomProperty: true, onParseError: () => { /* reported by checkCss */ } }), node => {
        if (node.type === 'ClassSelector') classes.add(node.name);
        else if (node.type === 'Function' && node.name === 'var' && node.children.first?.type === 'Identifier') vars.add(node.children.first.name.replace(/^--/, ''));
        else if (node.type === 'Declaration') {
            if (node.property.startsWith('--')) vars.add(node.property.slice(2));
            if (['--body-font', '--heading-font', 'font-family'].includes(node.property)) setsFont = true;
        }
    });
    return { classes: [...classes], vars: [...vars], setsFont };
}

// → { css, errors: [{ line, column, message }] }. css is '' when there are errors.
export async function checkCss(source, packageId) {
    const text = String(source ?? '');
    if (Buffer.byteLength(text) > MAX_CSS_BYTES) return { css: '', errors: [{ line: 1, column: 1, message: `The CSS is larger than ${MAX_CSS_BYTES / 1024} KB.` }] };
    if (!text.trim()) return { css: '', errors: [] };
    const L = await load();
    const errors = [];
    const fail = (node, message) => errors.push({ line: node?.loc?.start.line ?? 1, column: node?.loc?.start.column ?? 1, message });
    const ast = L.parse(text, { positions: true, parseCustomProperty: true, onParseError: () => { /* the audit decides */ } });
    L.walk(ast, node => {
        if (node.type === 'Atrule') {
            const name = L.utils.ident.decode(node.name).toLowerCase();
            if (!AT_RULES.has(name)) fail(node, `@${name} is not allowed.`);
        } else if (node.type === 'Declaration') {
            const name = L.utils.ident.decode(node.property).toLowerCase();
            if (PROPERTIES.has(name)) fail(node, `${name} is not allowed.`);
        } else if (node.type === 'Url') {
            const address = themeUrl(node.value, packageId);
            if (address) node.value = address;
            else fail(node, `url(${String(node.value).slice(0, 80)}) is not allowed: use a path inside the theme, like assets/picture.png.`);
        } else if (node.type === 'Function') {
            const name = L.utils.ident.decode(node.name).toLowerCase();
            if (FUNCTIONS.has(name)) fail(node, `${name}() is not allowed.`);
        }
    });
    if (errors.length) return { css: '', errors };
    const css = L.generate(ast);
    const problems = audit(css, packageId, L);
    if (problems.length) return { css: '', errors: problems.map(message => ({ line: 1, column: 1, message })) };
    return { css: `@layer theme {\n${css}\n}\n`, errors: [] };
}
