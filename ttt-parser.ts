import { CborSequenceEncoderStream } from "@std/cbor";
import { walk } from "@std/fs";
import { parseFile, TttFile } from "./ttt.ts";

const source = Deno.args[ 0 ] ?? "./ttt";
const target = Deno.args[ 1 ] ?? "scenes.cbor";

using out = await Deno.open(target, { write: true, create: true, truncate: true });
const startTime = performance.now();

let files = 0, nodes = 0, unclassified = 0;
const countNodes = (list: TttFile[ "nodes" ]): number =>
    list.reduce((total, node) => total + 1 + (node.children ? countNodes(node.children) : 0), 0);

await ReadableStream.from(walk(source, { includeDirs: false, match: [ /\.ttt$/i ] }))
    .pipeThrough(
        new TransformStream({
            transform: async (entry, controller) => {
                // the files are Latin-1, same as the picture names in the libraries
                const text = new TextDecoder("latin1").decode(await Deno.readFile(entry.path));
                const parsed = parseFile(entry.name, text);
                files++;
                nodes += countNodes(parsed.nodes);
                unclassified += parsed.unclassified.length;
                controller.enqueue(parsed);
            },
        }),
    )
    .pipeThrough(new CborSequenceEncoderStream())
    .pipeTo(out.writable);

const seconds = (performance.now() - startTime) / 1000;
const size = (await Deno.stat(target)).size;
console.log(`Done: ${files} files, ${nodes} nodes in ${seconds.toFixed(2)} s -> ${(size / 1048576).toFixed(1)} MB`);
console.log(`Unclassified lines kept verbatim: ${unclassified} (${(nodes / (nodes + unclassified) * 100).toFixed(2)}% classified)`);
