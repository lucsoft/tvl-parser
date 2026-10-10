import { Arrays, Options } from "@denosaurs/byte-type";
import zlib from "node:zlib";
import { Duplex } from "node:stream";
import { CborMapDecodedStream, CborSequenceDecoderStream, CborSequenceEncoderStream, CborStreamOutput } from "@std/cbor";
import { fileHeaderSection, imageSection, paletteSize as paletteSizeCodec, ParsedImage } from "./spec.ts";

interface CborData {
    fileName: string;
    sha256sum: string;
    description: string;
    data: Uint8Array;
}

using file = await Deno.open("collection.cbor", { read: true });
using exportFile = await Deno.open("export.cbor.z", { write: true, create: true, truncate: true });
const startTime = performance.now();

let unsupportedImages = 0;
let imageCount = 0;

const fakeDevNull = new WritableStream({
    write: () => { /* no-op */ },
});

await file.readable
    .pipeThrough(new CborSequenceDecoderStream())
    .pipeThrough(new TransformStream<CborStreamOutput, CborData>({
        transform: async (value, controller) => {
            if (value instanceof CborMapDecodedStream) {
                controller.enqueue(Object.fromEntries(await Array.fromAsync(value)) as unknown as CborData);
            }
        }
    }))
    .pipeThrough(new TransformStream<CborData, ParsedImage>({
        transform: async (element, controller) => {
            const options: Options = { byteOffset: 0 };
            const dataView = new DataView(element.data.buffer);

            fileHeaderSection.readPacked(dataView, options);

            while (options.byteOffset < dataView.byteLength) {

                const startOffset = options.byteOffset;
                const data = imageSection.readPacked(dataView, options);

                if (startOffset !== data.offset) {
                    console.warn("Offset mismatch:", element.fileName, "Expected:", startOffset, "Got:", data.offset);
                    Deno.exit(1);
                }

                // A zero sized record terminates the file. z2301.tvl ends with one that
                // still claims contentSize 9, so the dimensions are the reliable signal.
                if (data.width === 0 || data.height === 0) {
                    break;
                }
                const storage = data.options.storage;

                if (storage === "palette" || storage === "rgb" || storage === "rgba") {
                    const paletteSize = paletteSizeCodec.readPacked(dataView, options);

                    const contentType = new Arrays.Uint8ArrayType(data.contentSize - 1); // because the first byte is the palette size
                    const content = contentType.readPacked(dataView, options);

                    try {
                        // contentSize can be larger than the deflate stream it holds - 21 of
                        // 434212 records carry slack after the stream ends. DecompressionStream
                        // rejects that and throws its output away with it, Z_SYNC_FLUSH does not.
                        const imageData = zlib.inflateSync(content, {
                            finishFlush: zlib.constants.Z_SYNC_FLUSH,
                        });
                        const image: ParsedImage = {
                            source: {
                                fileName: element.fileName,
                                description: element.description
                            },
                            data,
                            image: storage === "palette"
                                ? {
                                    type: "tvl",
                                    paletteSize: paletteSize,
                                    colorPalette: imageData.slice(0, 3 * paletteSize),
                                    indexedColors: imageData.slice(3 * paletteSize)
                                }
                                : {
                                    // true colour records carry a 0 size byte and no palette
                                    type: storage,
                                    data: imageData
                                }
                        };
                        imageCount++;
                        controller.enqueue(image);
                    } catch (error) {
                        console.error("Failed to process image:", element.fileName, error);
                    }
                } else {
                    const contentType = new Arrays.Uint8ArrayType(data.contentSize);
                    const content = contentType.readPacked(dataView, options);
                    if (storage === "jpeg" || storage === "png") {
                        const image: ParsedImage = {
                            source: {
                                fileName: element.fileName,
                                description: element.description
                            },
                            data,
                            image: {
                                type: storage,
                                data: content
                            }
                        };
                        imageCount++;
                        controller.enqueue(image);
                    }
                    else {
                        unsupportedImages++;
                        const header = content.slice(0, 4);
                        console.log("Unsupported image format:", element.fileName, "Header:", header);
                        console.log(Array.from(header).map(b => b.toString(16).padStart(2, '0')));
                    }
                }

                if (imageCount % 5000 === 0 && imageCount > 5000) {
                    const elapsed = performance.now() - startTime;
                    console.log(`Processed ${imageCount} images in ${elapsed.toFixed(2)} ms (${element.fileName})`);
                }
            }
        }
    }))
    .pipeThrough(new CborSequenceEncoderStream())
    .pipeThrough(
        Duplex.toWeb(zlib.createDeflate({ level: 3 })) as unknown as ReadableWritablePair<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBufferLike>>,
    )
    .pipeTo(exportFile.writable);

const totalMs = performance.now() - startTime;
console.log(unsupportedImages, "unsupported images found.");
console.log(`Done: ${imageCount} images in ${(totalMs / 1000).toFixed(2)} s (${(imageCount / (totalMs / 1000)).toFixed(0)} images/s)`);
