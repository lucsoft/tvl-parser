/**
 * A `map` combinator for `@denosaurs/byte-type`.
 *
 * Kept in its own file because it is generic - nothing here knows about TVL -
 * and is a candidate for upstreaming into byte-type itself. See the design
 * notes at the bottom before opening that PR.
 */
import { InnerType, Options, SizedType, UnsizedType } from "@denosaurs/byte-type";

/**
 * Resolves to `SizedType<U>` when the wrapped codec is sized, `UnsizedType<U>`
 * otherwise, so `map` never loses the sizedness of its input.
 */
export type Mapped<C, U> = C extends SizedType<unknown> ? SizedType<U> : UnsizedType<U>;

function readMapped<T, U>(
    inner: UnsizedType<T>,
    decode: (value: T) => U,
    dt: DataView,
    options: Options,
): U {
    return decode(inner.readPacked(dt, options));
}

function writeMapped<T, U>(
    inner: UnsizedType<T>,
    encode: (value: U) => T,
    value: U,
    dt: DataView,
    options: Options,
): void {
    inner.writePacked(encode(value), dt, options);
}

/**
 * Two classes are unavoidable: `SizedType` carries a `protected` member, which
 * makes it nominal rather than structural, so a single class cannot stand in
 * for both. `map` hides the split behind one signature.
 */
class MappedUnsized<T, U> extends UnsizedType<U> {
    constructor(
        private readonly inner: UnsizedType<T>,
        private readonly decode: (value: T) => U,
        private readonly encode: (value: U) => T,
    ) {
        super(inner.byteAlignment);
    }

    readPacked(dt: DataView, options: Options = { byteOffset: 0 }): U {
        return readMapped(this.inner, this.decode, dt, options);
    }

    writePacked(value: U, dt: DataView, options: Options = { byteOffset: 0 }): void {
        writeMapped(this.inner, this.encode, value, dt, options);
    }
}

class MappedSized<T, U> extends SizedType<U> {
    constructor(
        private readonly inner: SizedType<T>,
        private readonly decode: (value: T) => U,
        private readonly encode: (value: U) => T,
    ) {
        super(inner.byteSize, inner.byteAlignment);
    }

    readPacked(dt: DataView, options: Options = { byteOffset: 0 }): U {
        return readMapped(this.inner, this.decode, dt, options);
    }

    writePacked(value: U, dt: DataView, options: Options = { byteOffset: 0 }): void {
        writeMapped(this.inner, this.encode, value, dt, options);
    }
}

/**
 * Wraps a codec so the decoded value is transformed on read and transformed
 * back on write. The wire layout is never touched, so alignment and size stay
 * those of `inner`.
 *
 * ```ts
 * // a u8 where a stored 0 means 256 - infers as SizedType<number>
 * const count = map(Primitives.u8, r => r === 0 ? 256 : r, v => v === 256 ? 0 : v);
 * ```
 *
 * `encode` is deliberately not optional: byte-type makes `writePacked`
 * abstract, so every codec is expected to work in both directions.
 */
export function map<C extends UnsizedType<unknown>, U>(
    inner: C,
    decode: (value: InnerType<C>) => U,
    encode: (value: U) => InnerType<C>,
): Mapped<C, U> {
    const mapped = inner instanceof SizedType
        ? new MappedSized(inner, decode as (value: unknown) => U, encode)
        : new MappedUnsized(inner, decode as (value: unknown) => U, encode);

    return mapped as Mapped<C, U>;
}

/*
 * Notes for upstreaming (as of byte-type 0.4.1 / main @ a321687):
 *
 * - The conditional return type is what keeps this to a single signature. It
 *   works because `sizeOf`/`alignmentOf` in util.ts only read `.byteSize` and
 *   `.byteAlignment` - sizedness is enforced on the type level, never through
 *   an `instanceof` check at runtime.
 * - Against `main` this also has to forward `maxSize` (added in #58, not in the
 *   published 0.4.1). For both classes that is `inner.maxSize` unchanged, since
 *   the transform never changes the byte layout.
 * - A `tryMap` sibling whose `decode` may throw would mirror binrw's
 *   `map` / `try_map` pair.
 */
