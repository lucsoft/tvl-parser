import { Bitflags, Compounds, InnerType, Primitives, Strings } from "jsr:@denosaurs/byte-type";

export const fileHeaderSection = new Compounds.SizedStruct({
    magicHeader: new Strings.FixedLengthString(4),
});

export const imageSection = new Compounds.Struct({
    offset: Primitives.u32,
    width: Primitives.u16,
    height: Primitives.u16,
    contentSize: Primitives.u32,
    options: new Bitflags.BitFlags8<Record<string, number>, {
        [ key: string ]: boolean;
        hasTransparency: boolean;
        isJPEGFileMaybe: boolean;
        isCustomFormat: boolean;
    }>({
        // currently meaningless.
        ...Object.fromEntries(Array.from({ length: 8 }).map((_, i) => [ "unknown" + i, 1 << i ])),
        hasTransparency: 1 << 0,
        isJPEGFileMaybe: 1 << 2,
        isCustomFormat: 1 << 4
    } as const),
    unknown1: Primitives.u8,
    unknown2: Primitives.u8, // always 16 ???
    unknown3: Primitives.u8,
    fileName: Strings.cstring
});


export type Image = { type: "tvl", paletteSize: number, colorPalette: Uint8Array; indexedColors: Uint8Array; } | { type: "jpeg", data: Uint8Array; } | { type: "unknown", data: Uint8Array; };
export type ImageSectionData = InnerType<typeof imageSection>;
export type ParsedImage = {
    source: {
        fileName: string;
        description: string;
    };
    data: ImageSectionData;
    image: Image;
};
