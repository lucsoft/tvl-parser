import { CborSequenceDecoderStream } from "@std/cbor";
import { ulid } from "@std/ulid";
import { CborDepthDecoderStream } from "./loading.ts";
import { redis } from "./redis.ts";
import { Collection, ParsedImage, RemoteImage } from "./spec.ts";
const exportFile = await Deno.open("export.cbor.z", { read: true });

const stream = exportFile.readable
    .pipeThrough(new DecompressionStream("deflate"))
    .pipeThrough(new CborSequenceDecoderStream())
    .pipeThrough(new CborDepthDecoderStream<ParsedImage>());

const currentList = await redis.hgetall("collections");
const collections: Collection[] = currentList
    .filter((_, index) => index % 2 === 1)
    .map(data => JSON.parse(data))
    .map((data): Collection => ({
        id: data.id,
        description: data.description,
        fileName: data.fileName
    }));

const imagesCache = new Map<string, RemoteImage[]>();
let imageCount = 0;

const importedImages = new Map<string, string[]>();
// 720 records corpus-wide share a fileName with an earlier record in the same
// collection, 459 of them with different pixels. Counting occurrences gives
// each one a stable identity across runs.
const nameOccurrences = new Map<string, number>();

for await (const element of stream) {
    if (!collections.find(collection => collection.fileName === element.source.fileName)) {
        const collection = {
            id: ulid(),
            description: element.source.description,
            fileName: element.source.fileName
        };
        collections.push(collection);

        await redis.hset("collections", collection.id, JSON.stringify(collection));
    }

    const parentKey = `collection:${collections.find(collection => collection.fileName === element.source.fileName)!.id}`;
    if (!importedImages.has(parentKey)) {
        importedImages.set(parentKey, []);
    }
    if (!imagesCache.has(parentKey)) {
        imagesCache.set(parentKey, await getImages(parentKey));
    }
    imageCount++;

    if (imageCount % 5000 === 0) {
        console.log(`Processed ${imageCount} images`);
    }

    const occurrenceKey = `${parentKey}|${element.data.fileName}`;
    const nameIndex = nameOccurrences.get(occurrenceKey) ?? 0;
    nameOccurrences.set(occurrenceKey, nameIndex + 1);

    const cachedImage = imagesCache.get(parentKey)!
        .find(image => image.fileName === element.data.fileName && image.nameIndex === nameIndex);

    const pl = redis.pipeline();
    const imageKey = cachedImage ? `image:${cachedImage.id}` : `image:${ulid()}`;
    importedImages.get(parentKey)!.push(imageKey.split(":")[ 1 ]);

    if (cachedImage) {
        // the payload is about to be overwritten, so anything derived from it is stale
        pl.hdel(imageKey, "webp");
        pl.hdel(imageKey, element.image.type === "tvl" ? "data" : "colorPalette", "indexedColors", "paletteSize");
    }

    pl.sadd(parentKey, imageKey);
    pl.hset(imageKey, "fileName", element.data.fileName);
    pl.hset(imageKey, "nameIndex", nameIndex);
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
    await pl.flush();
}

for (const [ collectionKey, imageIds ] of importedImages.entries()) {
    const images = await getImages(collectionKey);
    // Comparing lengths misses orphans whenever an id was imported more than
    // once, because the duplicate padded the count back to equal.
    const stillReferenced = new Set(imageIds);
    const toBeDeleted = images.filter(image => !stillReferenced.has(image.id));

    if (toBeDeleted.length === 0) {
        continue;
    }

    console.log(`Deleting ${toBeDeleted.length} images from collection ${collectionKey}`);

    for (const image of toBeDeleted) {
        await redis.srem(collectionKey, `image:${image.id}`);
        await redis.del(`image:${image.id}`);
    }
}

async function getImages(collectionKey: string) {
    const imagesInCollection = await redis.smembers(collectionKey);
    const images: RemoteImage[] = [];

    const pl = redis.pipeline();
    for (const imageKey of imagesInCollection) {
        pl.hget(imageKey, "fileName");
        pl.hget(imageKey, "dataType");
        pl.hget(imageKey, "nameIndex");
    }
    const data = await pl.flush();

    for (const [ index, imageKey ] of imagesInCollection.entries()) {
        const filename = data[ index * 3 ];
        const dataType = data[ index * 3 + 1 ];
        const nameIndex = data[ index * 3 + 2 ];
        images.push({
            id: imageKey.split(":")[ 1 ],
            fileName: filename as string,
            // entries written before nameIndex existed count as the first occurrence
            nameIndex: nameIndex === null ? 0 : Number(nameIndex),
            dataType: dataType as RemoteImage[ "dataType" ],
        });
    }
    return images;
}