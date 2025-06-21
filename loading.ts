import { CborMapDecodedStream, CborStreamOutput } from "jsr:@std/cbor";

async function decompressStream(value: CborStreamOutput): Promise<unknown> {
    if (value instanceof CborMapDecodedStream) {
        const list: [ string, unknown ][] = [];
        for await (const element of value) {
            list.push([
                element[ 0 ],
                await decompressStream(element[ 1 ])
            ]);
        }
        return Object.fromEntries(list);
    }
    else if (value instanceof ReadableStream) {
        console.log(value);
        throw new Error("Unexpected ReadableStream in CBOR data. This should not happen.");
    }
    else {
        return value;
    }
}

export class CborDepthDecoderStream<T> extends TransformStream<CborStreamOutput, T> {
    constructor() {
        super({
            transform: async (value, controller) => {
                controller.enqueue(await decompressStream(value) as T);
            }
        });
    }
}