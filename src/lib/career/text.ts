/** Third-party text shown or stored as a field: drop format characters (bidi overrides, zero-width) and line/paragraph separators. */
export const visible = (s: string) => s.replace(/[\p{Cf}\u2028\u2029]/gu, '');
