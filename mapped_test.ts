import { assertEquals, assertInstanceOf } from "@std/assert";
import { Compounds, Primitives, SizedType, Strings, UnsizedType } from "@denosaurs/byte-type";
import { map } from "./mapped.ts";
import { paletteSize } from "./spec.ts";

const half = map(Primitives.u8, (raw) => raw / 2, (value) => value * 2);

Deno.test("map keeps the sized contract for sized inner types", () => {
    assertInstanceOf(half, SizedType);
    assertEquals((half as SizedType<number>).byteSize, Primitives.u8.byteSize);
    assertEquals(half.byteAlignment, Primitives.u8.byteAlignment);
});

Deno.test("map stays unsized for unsized inner types", () => {
    const upper = map(Strings.cstring, (t) => t.toUpperCase(), (t) => t.toLowerCase());
    assertInstanceOf(upper, UnsizedType);
    assertEquals(upper instanceof SizedType, false);

    const dt = new DataView(new TextEncoder().encode("tpl1\0").buffer);
    assertEquals(upper.readPacked(dt, { byteOffset: 0 }), "TPL1");
});

Deno.test("map advances the cursor by the inner type's width", () => {
    const dt = new DataView(new Uint8Array([ 8, 0 ]).buffer);
    const options = { byteOffset: 0 };
    assertEquals(half.readPacked(dt, options), 4);
    assertEquals(options.byteOffset, 1);
});

Deno.test("map round trips through writePacked", () => {
    const dt = new DataView(new ArrayBuffer(4));
    for (const value of [ 0, 1, 64, 127 ]) {
        const write = { byteOffset: 0 };
        half.writePacked(value, dt, write);
        const read = { byteOffset: 0 };
        assertEquals(half.readPacked(dt, read), value);
        assertEquals(write.byteOffset, read.byteOffset);
    }
});

Deno.test("map composes inside a Struct", () => {
    const struct = new Compounds.Struct({ a: half, b: Primitives.u8 });
    const dt = new DataView(new Uint8Array([ 10, 7 ]).buffer);
    assertEquals(struct.readPacked(dt, { byteOffset: 0 }), { a: 5, b: 7 });
});

Deno.test("paletteSize decodes a stored 0 as 256 colours", () => {
    const dt = new DataView(new ArrayBuffer(1));

    dt.setUint8(0, 0);
    assertEquals(paletteSize.readPacked(dt, { byteOffset: 0 }), 256);

    for (const value of [ 1, 2, 127, 255, 256 ]) {
        paletteSize.writePacked(value, dt, { byteOffset: 0 });
        assertEquals(paletteSize.readPacked(dt, { byteOffset: 0 }), value);
    }

    // 256 must go back out as a literal 0 byte
    paletteSize.writePacked(256, dt, { byteOffset: 0 });
    assertEquals(dt.getUint8(0), 0);
});

Deno.test("map infers sizedness and the mapped value without annotations", () => {
    // these must type-check with no explicit type arguments or annotations
    const sized = map(Primitives.u8, (raw) => raw === 0 ? 256 : raw, (v) => v === 256 ? 0 : v);
    const unsized = map(Strings.cstring, (t) => t.toUpperCase(), (t) => t.toLowerCase());

    type Assert<T extends true> = T;
    type Eq<A, B> = [ A ] extends [ B ] ? ([ B ] extends [ A ] ? true : false) : false;
    type _sized = Assert<Eq<typeof sized, SizedType<number>>>;
    type _unsized = Assert<Eq<typeof unsized, UnsizedType<string>>>;
    type _value = Assert<Eq<Parameters<typeof sized.writePacked>[ 0 ], number>>;

    assertInstanceOf(sized, SizedType);
    assertEquals(unsized instanceof SizedType, false);
});
