/** Third-party text shown or stored as a field: line/paragraph separators become a space; other format characters (bidi overrides, zero-width) are dropped. */
export const visible = (s: string) => s.replace(/[\u2028\u2029]/g, ' ').replace(/\p{Cf}/gu, '');
