import { Compounds, InnerType, Primitives, SizedType, Strings } from "@denosaurs/byte-type";
import { map } from "./mapped.ts";

export const MAGIC_HEADER = "TPL1";

export const fileHeaderSection = new Compounds.SizedStruct({
    magicHeader: new Strings.FixedLengthString(4),
});

/** Size of the fixed part of an image header, i.e. everything before `fileName`. */
export const IMAGE_HEADER_SIZE = 16;

/**
 * How a record stores its payload. The `options` byte is not a set of
 * independent booleans: bits 2/4/7 pick the storage class, bits 0/1 are then
 * read relative to it. Observed bytes:
 *   0x05 jpeg | 0x06 png | 0x10..0x1b palette | 0x90 rgb | 0x91 rgba
 *
 * `raw` is kept on every variant so the byte survives a round trip - bits 5
 * and 6 were never seen set, so rebuilding it from the fields would be a guess.
 */
export type ImageOptions =
    | {
        storage: "palette";
        raw: number;
        /** Pixels equal to `transparentColorIndex` are transparent. */
        hasTransparency: boolean;
        /** Overlay frame drawn on top of a base picture, e.g. `<BASE>_1` next to `<BASE>`. */
        isAnimationFrame: boolean;
        unknown3: boolean;
    }
    | { storage: "rgb" | "rgba"; raw: number; unknown3: boolean; }
    | { storage: "jpeg" | "png"; raw: number; unknown3: boolean; }
    | { storage: "unknown"; raw: number; };

/** Bits 2, 4 and 7 select the storage class; bit 3 is still unexplained. */
const OPTION = {
    EMBEDDED_FILE: 1 << 2,
    UNKNOWN_3: 1 << 3,
    CUSTOM_FORMAT: 1 << 4,
    TRUE_COLOR: 1 << 7,
} as const;

// Bits 0 and 1 are overloaded - each storage class reads them differently, so
// they get a name per class rather than one neutral name.
const PALETTE = { TRANSPARENT: 1 << 0, ANIMATION_FRAME: 1 << 1 } as const;
const RGB = { ALPHA: 1 << 0, UNUSED: 1 << 1 } as const;
const EMBEDDED = { JPEG: 1 << 0, PNG: 1 << 1 } as const;

const has = (raw: number, mask: number): boolean => (raw & mask) !== 0;

export const imageOptions = map(
    Primitives.u8,
    (raw): ImageOptions => {
        const unknown3 = has(raw, OPTION.UNKNOWN_3);
        const isEmbedded = has(raw, OPTION.EMBEDDED_FILE);
        const isCustom = has(raw, OPTION.CUSTOM_FORMAT);

        // exactly one of the two storage markers has to be set
        if (isEmbedded === isCustom) return { storage: "unknown", raw };

        if (isCustom) {
            if (!has(raw, OPTION.TRUE_COLOR)) {
                return {
                    storage: "palette",
                    raw,
                    hasTransparency: has(raw, PALETTE.TRANSPARENT),
                    isAnimationFrame: has(raw, PALETTE.ANIMATION_FRAME),
                    unknown3,
                };
            }
            if (has(raw, RGB.UNUSED)) return { storage: "unknown", raw };
            return { storage: has(raw, RGB.ALPHA) ? "rgba" : "rgb", raw, unknown3 };
        }

        const isJpeg = has(raw, EMBEDDED.JPEG);
        const isPng = has(raw, EMBEDDED.PNG);
        // exactly one format bit, same shape as the storage marker check above
        if (isJpeg === isPng) return { storage: "unknown", raw };
        return { storage: isJpeg ? "jpeg" : "png", raw, unknown3 };
    },
    (options) => options.raw,
);/**
 * An image record. The file is `fileHeaderSection` followed by image records
 * back to back until EOF; `offset` equals the record's own absolute position.
 *
 * Layout (little endian, packed, 16 bytes + NUL terminated name):
 *   u32 offset | u16 width | u16 height | u32 contentSize
 *   u8  options | u8 transparentColorIndex | u8 headerSize | u8 fileNameSize
 *   cstring fileName
 */
export const imageSection = new Compounds.Struct({
    offset: Primitives.u32,
    width: Primitives.u16,
    height: Primitives.u16,
    /** Payload size. For `palette`, `rgb` and `rgba` this includes the leading palette size byte. */
    contentSize: Primitives.u32,
    options: imageOptions,
    /** Only meaningful for `palette` records with `hasTransparency`. Defaults to 0. */
    transparentColorIndex: Primitives.u8,
    /** Always `IMAGE_HEADER_SIZE`. `headerSize + fileNameSize` is the total header length. */
    headerSize: Primitives.u8,
    /** `fileName.length + 1` - the cstring including its NUL terminator. */
    fileNameSize: Primitives.u8,
    /** Latin-1/CP1252, not UTF-8. */
    fileName: Strings.cstring
});

export type ImageSectionData = InnerType<typeof imageSection>;

/** The u8 in front of the deflate stream. A stored 0 means 256 colours, not 0. */
export const paletteSize: SizedType<number> = map(
    Primitives.u8,
    (raw) => raw === 0 ? 256 : raw,
    (value) => value === 256 ? 0 : value,
);

export type Image =
    /** Deflated: `paletteSize * 3` RGB bytes, then `width * height` indices. */
    | { type: "tvl", paletteSize: number, colorPalette: Uint8Array; indexedColors: Uint8Array; }
    | { type: "rgb", data: Uint8Array; }
    | { type: "rgba", data: Uint8Array; }
    | { type: "jpeg", data: Uint8Array; }
    | { type: "png", data: Uint8Array; }
    | { type: "unknown", data: Uint8Array; };

export type ParsedImage = {
    source: {
        fileName: string;
        description: string;
    };
    data: ImageSectionData;
    image: Image;
};

export type ErrorOr<T> = { ok: true, data: T; } | { ok: false, error: string; };

export type Collection = {
    id: string;
    fileName: string;
    description: string;
};

export type RemoteImage = {
    id: string;
    fileName: string;
    dataType: Image[ "type" ];
};
