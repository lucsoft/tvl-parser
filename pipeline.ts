/**
 * The streaming machinery behind the converter. Everything here is about moving
 * bytes in the right order and at the right concurrency - the actual decoding
 * lives in tasks.ts.
 */
import { Options } from "@denosaurs/byte-type";
import { createPool, Envelope, isMain } from "knitting";
import { BufferReference } from "knitting/unsafe";
import { CborMapDecodedStream, CborSequenceDecoderStream, CborStreamOutput } from "@std/cbor";
import { fileHeaderSection, imageSection } from "./spec.ts";
import { ChunkEnvelope, decodeChunk } from "./tasks.ts";

export { decodeChunk, isMain };

/** One .tvl file as merger.ts stored it. */
export interface Collected {
    fileName: string;
    sha256sum: string;
    description: string;
    data: Uint8Array;
}

/** Decodes the outer CBOR sequence that merger.ts wrote. */
export function readCollection(source: ReadableStream<Uint8Array>): ReadableStream<Collected> {
    return source
        .pipeThrough(new CborSequenceDecoderStream())
        .pipeThrough(
            new TransformStream<CborStreamOutput, Collected>({
                transform: async (value, controller) => {
                    if (value instanceof CborMapDecodedStream) {
                        controller.enqueue(Object.fromEntries(await Array.fromAsync(value)) as unknown as Collected);
                    }
                },
            }),
        );
}

/**
 * Cuts each file into record-aligned slices of roughly `bytes`, and checks every
 * record's self-reported offset on the way through - a mismatch means the walk
 * lost sync and nothing downstream can be trusted.
 *
 * The slice is a copy on purpose: `BufferReference` detaches whatever it is given,
 * and detaching a view would take the whole file's buffer with it.
 */
export function chunkRecords({ bytes = 1024 * 1024 } = {}): TransformStream<Collected, ChunkEnvelope> {
    return new TransformStream<Collected, ChunkEnvelope>({
        transform: (element, controller) => {
            const dataView = new DataView(element.data.buffer, element.data.byteOffset, element.data.byteLength);
            const options: Options = { byteOffset: 0 };
            fileHeaderSection.readPacked(dataView, options);

            const header = { fileName: element.fileName, description: element.description };
            let start = options.byteOffset;

            const emit = (end: number) =>
                controller.enqueue(new Envelope(header, new BufferReference(element.data.slice(start, end))));

            while (options.byteOffset < dataView.byteLength) {
                const recordStart = options.byteOffset;
                const data = imageSection.readPacked(dataView, options);

                if (recordStart !== data.offset) {
                    throw new Error(
                        `${element.fileName}: record claims offset ${data.offset} but sits at ${recordStart}`,
                    );
                }

                options.byteOffset += data.contentSize;

                if (options.byteOffset - start >= bytes) {
                    emit(options.byteOffset);
                    start = options.byteOffset;
                }
            }

            if (options.byteOffset > start) emit(options.byteOffset);
        },
    }, { highWaterMark: 64 });
}

/**
 * Runs `decodeChunk` across a worker pool and emits the results in input order.
 *
 * `threads: 0` skips the pool entirely and decodes inline, which is the honest
 * baseline to compare the parallel run against.
 */
export function decodeChunks({ threads = 8 } = {}): TransformStream<ChunkEnvelope, Uint8Array> {
    const pool = threads > 0 ? createPool({ threads })({ decodeChunk }) : undefined;
    const run = (chunk: ChunkEnvelope): Promise<Uint8Array> =>
        pool ? pool.call.decodeChunk(chunk) as Promise<Uint8Array> : Promise.resolve(decodeChunk(chunk));

    const inFlight: Promise<Uint8Array>[] = [];
    const window = Math.max(1, threads * 2);

    return new TransformStream<ChunkEnvelope, Uint8Array>({
        transform: async (chunk, controller) => {
            inFlight.push(run(chunk));
            while (inFlight.length >= window) controller.enqueue(await inFlight.shift()!);
        },
        flush: async (controller) => {
            while (inFlight.length > 0) controller.enqueue(await inFlight.shift()!);
            await pool?.shutdown();
        },
    }, { highWaterMark: 64 });
}
