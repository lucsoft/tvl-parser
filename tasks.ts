/**
 * Worker tasks. Kept deliberately lean: every worker re-imports this module and
 * its top level imports run in each of them, so nothing server- or CLI-shaped
 * belongs here.
 */
import { Arrays, Options } from "@denosaurs/byte-type";
import zlib from "node:zlib";
import { Envelope } from "knitting";
import type { BufferReference } from "knitting/unsafe";
import { encodeCbor } from "@std/cbor";
import { imageSection, inflatedSize, paletteSize as paletteSizeCodec, ParsedImage } from "./spec.ts";

/**
 * A record-aligned slice of a .tvl file plus the two strings its records need.
 *
 * Only a top-level binary value crosses the worker boundary as bytes - nested in
 * a plain object it silently arrives as an object with numeric keys - so the
 * strings travel in the envelope header rather than alongside the array.
 */
export type ChunkEnvelope = Envelope<{ fileName: string; description: string; }, BufferReference>;

/**
 * Decodes a chunk into a CBOR sequence, keeping every payload deflated.
 *
 * Each payload is still inflated once to check it against the size its header
 * implies - that check is what surfaced the 21 records whose deflate stream ends
 * before `contentSize` does - but the inflated bytes are thrown away again.
 */
export function decodeChunk(chunk: ChunkEnvelope): Uint8Array {
    const { fileName, description } = chunk.header;
    const bytes = chunk.payload.toUint8Array();
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const options: Options = { byteOffset: 0 };
    const encoded: Uint8Array[] = [];
    let total = 0;

    while (options.byteOffset < dataView.byteLength) {
        const data = imageSection.readPacked(dataView, options);

        // z2301.tvl carries a 0x0 record with contentSize 9 in the middle of the
        // file. Skip past its payload - the records behind it are fine.
        if (data.width === 0 || data.height === 0) {
            options.byteOffset += data.contentSize;
            continue;
        }

        const storage = data.options.storage;
        let image: ParsedImage[ "image" ] | undefined;

        if (storage === "palette" || storage === "rgb" || storage === "rgba") {
            const paletteSize = paletteSizeCodec.readPacked(dataView, options);
            const deflated = new Arrays.Uint8ArrayType(data.contentSize - 1).readPacked(dataView, options);

            // contentSize is the payload size and all 768 embedded jpeg/png records
            // end exactly on it - but 21 deflate payloads were written over a
            // longer predecessor and still carry its tail inside that size. zlib
            // ignores the leftovers; bytesWritten says where the stream really
            // ended, so they are dropped rather than carried into the export.
            //
            // The size check has never rejected a record. It is kept because it
            // guards the parser, not the data: a misread paletteSize or a lost
            // offset walk would land here instead of in a rendered image. It is
            // also free, since the inflate has to happen for bytesWritten anyway.
            let inflated: Uint8Array;
            let streamLength: number;
            try {
                const result = zlib.inflateSync(deflated, { info: true }) as unknown as {
                    buffer: Uint8Array;
                    engine: { bytesWritten: number; };
                };
                inflated = result.buffer;
                streamLength = result.engine.bytesWritten;
            } catch {
                continue;
            }
            if (inflated.length !== inflatedSize(data, paletteSize)) continue;

            const payload = streamLength < deflated.length ? deflated.subarray(0, streamLength) : deflated;
            image = storage === "palette"
                ? { type: "tvl", paletteSize, deflated: payload }
                : { type: storage, deflated: payload };
        } else {
            const content = new Arrays.Uint8ArrayType(data.contentSize).readPacked(dataView, options);
            if (storage === "jpeg" || storage === "png") image = { type: storage, data: content };
        }

        if (!image) continue;

        const record = encodeCbor({ source: { fileName, description }, data, image } satisfies ParsedImage);
        encoded.push(record);
        total += record.length;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of encoded) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
