// Limits shared by the server and the admin's Vue code: no server imports here, so none reach the client bundle.

/** A draft draws on up to this many papers. */
export const DRAFT_MAX_PAPERS = 10;

/** A paper shares at most this many highlights. */
export const PUBLIC_HIGHLIGHTS_MAX = 10;

/** A public highlight shows at most this many characters of the paper's words. */
export const PUBLIC_QUOTE_MAX = 300;
