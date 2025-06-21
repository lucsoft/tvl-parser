import { fail } from "@std/assert";
import { CborSequenceEncoderStream } from "@std/cbor";
import { walk } from "@std/fs";
import importData from "./import.json" with { type: "json" };
const entries = walk("./export", {
    includeSymlinks: false,
    includeDirs: false,
    match: [
        /tvl$/
    ]
});

const file = await Deno.open("collection.cbor", { write: true, create: true, truncate: true });

await ReadableStream.from(entries)
    .pipeThrough(new TransformStream({
        transform: async (entry, controller) => {
            const fileData = await Deno.open(entry.path);
            const data = await new Response(fileData.readable).bytes();
            const hashBuffer = await crypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const sha256sum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            const obj = {
                fileName: entry.name,
                sha256sum,
                description: importData.find(([ url ]) => new URL(url).pathname.split("/").at(-1)?.startsWith(entry.name.replace(".tvl", "")))?.[ 1 ] ?? fail(`No description found for ${entry.name}`),
                data
            };

            console.log(obj);
            controller.enqueue(obj);
        }
    }))
    .pipeThrough(new CborSequenceEncoderStream())
    .pipeTo(file.writable);
