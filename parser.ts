import { chunkRecords, decodeChunk, decodeChunks, isMain, readCollection } from "./pipeline.ts";

// Workers re-import this module, so the task has to be reachable from it.
export { decodeChunk };

if (isMain) {
    using collection = await Deno.open("collection.cbor", { read: true });
    using exportFile = await Deno.open(Deno.env.get("OUT") ?? "export.cbor", { write: true, create: true, truncate: true });

    const threads = Number(Deno.env.get("THREADS") ?? 8);
    const startTime = performance.now();

    await readCollection(collection.readable)
        .pipeThrough(chunkRecords({ bytes: 1024 * 1024 }))
        .pipeThrough(decodeChunks({ threads }))
        .pipeTo(exportFile.writable);

    const seconds = (performance.now() - startTime) / 1000;
    const written = (await Deno.stat(Deno.env.get("OUT") ?? "export.cbor")).size.valueOf();
    console.log(
        `Done: ${(written / 1048576).toFixed(0)} MB in ${seconds.toFixed(2)} s`,
        threads > 0 ? `with ${threads} threads` : "inline, no pool",
    );
}
