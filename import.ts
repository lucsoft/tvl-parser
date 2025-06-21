import { CborSequenceDecoderStream } from "@std/cbor";
import { ulid } from "@std/ulid";
import { CborDepthDecoderStream } from "./loading.ts";
import { redis } from "./redis.ts";
import { Collection, ParsedImage } from "./spec.ts";
const exportFile = await Deno.open("export.cbor.z", { read: true });

const buffer: ParsedImage[] = [];
const stream = exportFile.readable
    .pipeThrough(new DecompressionStream("deflate"))
    .pipeThrough(new CborSequenceDecoderStream())
    .pipeThrough(new CborDepthDecoderStream<ParsedImage>())
    .pipeThrough(new TransformStream<ParsedImage, ParsedImage[]>({
        transform: (value, controller) => {
            buffer.push(value);
            if (buffer.length == 20_000) {
                controller.enqueue([ ...buffer ]);
                buffer.length = 0; // Clear the buffer
            }
        }
    }));

const currentList = await redis.hgetall("collections");
const collections: Collection[] = currentList
    .filter((_, index) => index % 2 === 1)
    .map(data => JSON.parse(data))
    .map((data): Collection => ({
        id: data.id,
        description: data.description,
        fileName: data.fileName
    }));

let imageCount = 0;
for await (const batch of stream) {
    const collectionsStart = performance.now();
    for (const element of batch) {
        if (!collections.find(collection => collection.fileName === element.source.fileName)) {
            console.log("Parsed collection:", element.source.fileName, element.source.description);

            const collection = {
                id: ulid(),
                description: element.source.description,
                fileName: element.source.fileName
            };
            collections.push(collection);

            await redis.hset("collections", collection.id, JSON.stringify(collection));
        }
    }
    const durationCollections = performance.now() - collectionsStart;
    if (durationCollections > 1000) {
        console.log("Collections processed in", performance.now() - collectionsStart, "ms");
    }

    const batchStart = performance.now();
    const pl = redis.pipeline();
    for (const element of batch) {
        const imageKey = `image:${ulid()}`;
        const parentKey = `collection:${collections.find(collection => collection.fileName === element.source.fileName)!.id}`;
        pl.sadd(parentKey, imageKey);
        pl.hset(imageKey, "fileName", element.data.fileName);
        pl.hset(imageKey, "width", element.data.width);
        pl.hset(imageKey, "height", element.data.height);
        pl.hset(imageKey, "contentSize", element.data.contentSize);
        pl.hset(imageKey, "options", JSON.stringify(element.data.options));
        pl.hset(imageKey, "dataType", element.image.type);
        if (element.image.type === "tvl") {
            pl.hset(imageKey, "paletteSize", element.image.paletteSize);
            pl.hset(imageKey, "colorPalette", element.image.colorPalette);
            pl.hset(imageKey, "indexedColors", element.image.indexedColors);
        }
        else {
            pl.hset(imageKey, "data", element.image.data);
        }
        imageCount++;
    }
    await pl.flush();
    console.log("Batch processed in", (performance.now() - batchStart).toFixed(2), "ms");
    if (imageCount % 50000 === 0) {
        console.log(`Processed ${imageCount} images`);
    }
}