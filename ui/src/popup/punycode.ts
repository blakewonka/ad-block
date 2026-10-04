/**
 * Display-only IDN decoding for the popup hostname (docs/specs/popup.md §4).
 *
 * Same semantics as upstream `punycode.toUnicode` (PRISTINE/js/punycode.js, Punycode.js 2.x,
 * RFC 3492): the domain is split on `.`, `。`, `．`, `｡` (all normalised to `.`), a part before
 * an `@` is kept as is, and every label that starts with lower-case `xn--` is decoded; other
 * labels are left untouched.
 *
 * Difference: upstream throws on an invalid label (which would leave its popup half
 * initialised). Here an invalid label is shown as it is. Hostnames come from the URL
 * parser, which already rejects invalid punycode, so the difference is not reachable in
 * practice.
 *
 * Only the DISPLAY is decoded: payloads and permission patterns keep the ASCII hostname.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 2147483647;

const SEPARATORS = /[\x2E。．｡]/g;
const PUNYCODE_PREFIX = /^xn--/;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
    let k = 0;
    delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) {
        delta = Math.floor(delta / (BASE - T_MIN));
    }
    return Math.floor(k + ((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function basicToDigit(codePoint: number): number {
    if (codePoint >= 0x30 && codePoint < 0x3a) return 26 + (codePoint - 0x30);
    if (codePoint >= 0x41 && codePoint < 0x5b) return codePoint - 0x41;
    if (codePoint >= 0x61 && codePoint < 0x7b) return codePoint - 0x61;
    return BASE;
}

/** RFC 3492 decoder (Punycode string without the `xn--` prefix → Unicode). Throws RangeError on bad input. */
export function decodePunycode(input: string): string {
    const output: number[] = [];
    let i = 0;
    let n = INITIAL_N;
    let bias = INITIAL_BIAS;

    let basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; ++j) {
        const cp = input.charCodeAt(j);
        if (cp >= 0x80) throw new RangeError('punycode: illegal input >= 0x80 (not a basic code point)');
        output.push(cp);
    }

    for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
        const oldi = i;
        for (let w = 1, k = BASE; ; k += BASE) {
            if (index >= input.length) throw new RangeError('punycode: invalid input');
            const digit = basicToDigit(input.charCodeAt(index++));
            if (digit >= BASE) throw new RangeError('punycode: invalid input');
            if (digit > Math.floor((MAX_INT - i) / w)) throw new RangeError('punycode: overflow');
            i += digit * w;
            const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
            if (digit < t) break;
            const baseMinusT = BASE - t;
            if (w > Math.floor(MAX_INT / baseMinusT)) throw new RangeError('punycode: overflow');
            w *= baseMinusT;
        }
        const out = output.length + 1;
        bias = adapt(i - oldi, out, oldi === 0);
        if (Math.floor(i / out) > MAX_INT - n) throw new RangeError('punycode: overflow');
        n += Math.floor(i / out);
        i %= out;
        output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
}

/** `punycode.toUnicode(domain)` for display (see the file comment). */
export function toUnicode(domain: string): string {
    let prefix = '';
    let rest = domain;
    const parts = domain.split('@');
    if (parts.length > 1) {
        prefix = `${parts[0]}@`;
        rest = parts[1] ?? '';
    }
    rest = rest.replace(SEPARATORS, '.');
    const labels = rest.split('.').map((label) => {
        if (!PUNYCODE_PREFIX.test(label)) return label;
        try {
            return decodePunycode(label.slice(4).toLowerCase());
        } catch {
            return label;
        }
    });
    return prefix + labels.join('.');
}
