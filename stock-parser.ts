import { CborSequenceEncoderStream } from "@std/cbor";
import { walk } from "@std/fs";
import { inflateStock, readStock, StockRecord } from "./stock.ts";

const source = Deno.args[ 0 ] ?? "./stock";
const target = Deno.args[ 1 ] ?? "stock.cbor";

using out = await Deno.open(target, { write: true, create: true, truncate: true });
const startTime = performance.now();

let files = 0, records = 0, animated = 0, frames = 0, annotations = 0;

async function* parsed(): AsyncGenerator<StockRecord> {
    for await (const entry of walk(source, { includeDirs: false, match: [ /\.stb$/i ] })) {
        files++;
        for (const record of readStock(inflateStock(await Deno.readFile(entry.path)))) {
            records++;
            frames += record.frames.length;
            annotations += record.annotations.length;
            // only records that actually say something are worth keeping
            if (!record.frames.length && !record.annotations.length) continue;
            if (record.frames.length) animated++;
            yield record;
        }
    }
}

await ReadableStream.from(parsed())
    .pipeThrough(new CborSequenceEncoderStream() as unknown as ReadableWritablePair<Uint8Array<ArrayBuffer>, StockRecord>)
    .pipeTo(out.writable);

const seconds = (performance.now() - startTime) / 1000;
const size = (await Deno.stat(target)).size;
console.log(`Done: ${files} files, ${records} records in ${seconds.toFixed(2)} s -> ${(size / 1048576).toFixed(1)} MB`);
console.log(`  pictures with animation frames: ${animated} (${frames} frames)`);
console.log(`  annotations: ${annotations}`);
