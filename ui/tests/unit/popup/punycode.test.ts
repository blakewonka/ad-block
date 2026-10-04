import { describe, expect, it } from 'vitest';

import { decodePunycode, toUnicode } from '@/popup/punycode';

describe('toUnicode (popup.md §4)', () => {
    it('decodes xn-- labels and leaves the others', () => {
        expect(toUnicode('xn--bcher-kva.example')).toBe('bücher.example');
        expect(toUnicode('www.xn--mnchen-3ya.de')).toBe('www.münchen.de');
        expect(toUnicode('xn--fiqs8s.xn--fiqz9s')).toBe('中国.中國');
        expect(toUnicode('www.example.com')).toBe('www.example.com');
        expect(toUnicode('[::1]')).toBe('[::1]');
        expect(toUnicode('example.com.')).toBe('example.com.');
    });

    it('only a lower-case xn-- prefix is decoded (upstream regex /^xn--/)', () => {
        expect(toUnicode('XN--bcher-kva.example')).toBe('XN--bcher-kva.example');
    });

    it('normalises the IDN separators', () => {
        expect(toUnicode('a。b．c｡d')).toBe('a.b.c.d');
    });

    it('keeps an invalid label as it is instead of throwing', () => {
        expect(toUnicode('xn--a-ecp.xn--$$$.example')).toBe('xn--a-ecp.xn--$$$.example'.replace('xn--a-ecp', decodePunycode('a-ecp')));
        expect(() => decodePunycode('$$$')).toThrow(RangeError);
    });

    it('RFC 3492 sample (Arabic)', () => {
        expect(decodePunycode('egbpdaj6bu4bxfgehfvwxn')).toBe('ليهمابتكلموشعربي؟');
    });
});
