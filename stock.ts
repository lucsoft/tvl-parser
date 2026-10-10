/**
 * Reader for the `.stb` stock files that ship with the Traffic installer.
 *
 * They hold the per-picture metadata the `.tvl` libraries do not carry: where an
 * animation frame sits on its base picture, where pantographs and doors are, and
 * which overlays belong on top. Without this the frames in a library are just
 * loose rectangles with no anchor.
 *
 * Container: the 6 byte magic `StkZ03` followed by a single zlib stream.
 * Records inside: `\0 <len> <NAME> <2 char code> \0 <payload> \0`, where the
 * payload is text carrying frames and annotations.
 */
import zlib from "node:zlib";

/** Three versions ship side by side: StkZ03, StkZ05 and StkZ07. All are zlib after the header. */
export const STOCK_MAGIC = /^StkZ(\d\d)$/;
const HEADER_BYTES = 6;

/** One phase picture and where it goes on the base, measured from the bottom left. */
export interface Frame {
    name: string;
    x: number;
    /** Offset from the bottom edge. Absent in a few records; treat as 0. */
    y: number;
}

/** `[A:DOOR,CSD_810DL,15,3]`, `[E:M_V43P1,22,41]`, `[O:...]` and friends. */
export interface Annotation {
    kind: string;
    args: string[];
    raw: string;
}

export interface StockRecord {
    name: string;
    /** `GR`, `GO`, `GT`, `GB`, `GS` - meaning not established. */
    code: string;
    frames: Frame[];
    annotations: Annotation[];
    /** The payload verbatim, so nothing parsed here is lost. */
    raw: string;
}

const RECORD = /\x00([\x01-\x40])([A-Z0-9_~.+-]+?)(..)\x00([^\x00]*)/g;
/** `+X:Y:NAME`, where `:Y` is optional. */
const FRAME = /\+(-?\d+):(?:(-?\d+):)?([A-Z0-9_~]+)/g;
const ANNOTATION = /\[([A-Z]+)[:!]([^\]]*)\]/g;

/** Inflates a `.stb` file. Throws if the magic is not there. */
export function inflateStock(bytes: Uint8Array): string {
    const magic = new TextDecoder("latin1").decode(bytes.subarray(0, HEADER_BYTES));
    if (!STOCK_MAGIC.test(magic)) throw new Error(`not a stock file, magic was ${JSON.stringify(magic)}`);
    return new TextDecoder("latin1").decode(zlib.inflateSync(bytes.subarray(HEADER_BYTES)));
}

/**
 * Yields every record whose declared name length matches, which is what keeps
 * this from walking into the middle of a string. Roughly 90% of the names found
 * this way exist in the picture libraries.
 */
export function* readStock(text: string): Generator<StockRecord> {
    for (const match of text.matchAll(RECORD)) {
        const length = match[1].charCodeAt(0);
        const name = match[2];
        if (name.length !== length) continue;

        const payload = match[4];
        const frames: Frame[] = [];
        for (const f of payload.matchAll(FRAME)) {
            frames.push({ name: f[3], x: Number(f[1]), y: f[2] === undefined ? 0 : Number(f[2]) });
        }
        const annotations: Annotation[] = [];
        for (const a of payload.matchAll(ANNOTATION)) {
            annotations.push({ kind: a[1], args: a[2].split(","), raw: a[0] });
        }

        yield { name, code: match[3], frames, annotations, raw: payload };
    }
}
