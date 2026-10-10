import {
    CborArrayDecodedStream,
    CborByteDecodedStream,
    CborMapDecodedStream,
    CborStreamOutput,
    CborTextDecodedStream,
} from "@std/cbor";

async function concatBytes(stream: CborByteDecodedStream): Promise<Uint8Array> {
    const chunks = await Array.fromAsync(stream);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/** Pulls a streamed CBOR value fully into memory, including nested containers. */
async function materialize(value: CborStreamOutput): Promise<unknown> {
    if (value instanceof CborMapDecodedStream) {
        const entries: [ string, unknown ][] = [];
        for await (const [ key, nested ] of value) {
            entries.push([ key, await materialize(nested) ]);
        }
        return Object.fromEntries(entries);
    }

    if (value instanceof CborArrayDecodedStream) {
        const items: unknown[] = [];
        for await (const nested of value) {
            items.push(await materialize(nested));
        }
        return items;
    }

    if (value instanceof CborByteDecodedStream) return await concatBytes(value);
    if (value instanceof CborTextDecodedStream) return (await Array.fromAsync(value)).join("");

    if (value instanceof ReadableStream) {
        throw new Error(`Unhandled CBOR stream type: ${value.constructor.name}`);
    }

    return value;
}

export class CborDepthDecoderStream<T> extends TransformStream<CborStreamOutput, T> {
    constructor() {
        super({
            transform: async (value, controller) => {
                controller.enqueue(await materialize(value) as T);
            },
        });
    }
}
