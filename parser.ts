import { Arrays, Options, Primitives } from "jsr:@denosaurs/byte-type";
import { CborMapDecodedStream, CborSequenceDecoderStream, CborSequenceEncoderStream, CborStreamOutput } from "jsr:@std/cbor";
import { fileHeaderSection, imageSection, ParsedImage } from "./spec.ts";

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

                if (data.height === 0 && data.width === 0 && data.contentSize === 0) {
                    console.log("CRAZY file?");
                    console.log(data);
                    break;
                };
                if (data.options.isCustomFormat) {
                    const paletteSize = Primitives.u8.readPacked(dataView, options);

                    if (data.contentSize > 1024 * 1024) {
                        console.warn("Skipping image because it is larger than 1 MB:", element.fileName, data.contentSize);
                        continue;
                    }
                    const contentType = new Arrays.Uint8ArrayType(data.contentSize - 1); // because the first byte is the palette size
                    const content = contentType.readPacked(dataView, options);

                    try {
                        const stream = new Response(content).body!
                            .pipeThrough(new DecompressionStream("deflate"));

                        const imageData = await new Response(stream).bytes();
                        const image: ParsedImage = {
                            source: {
                                fileName: element.fileName,
                                description: element.description
                            },
                            data,
                            image: {
                                type: "tvl",
                                paletteSize: paletteSize,
                                colorPalette: imageData.slice(0, 3 * paletteSize),
                                indexedColors: imageData.slice(3 * paletteSize)
                            }
                        };
                        imageCount++;
                        controller.enqueue(image);
                    } catch (error) {

                        // Deno.exit(1);
                        console.error("Failed to process image:", element.fileName, error);
                        // await Deno.writeFile("decompress_fail" + element.fileName + ".txt", content);
                    }
                } else {
                    const contentType = new Arrays.Uint8ArrayType(data.contentSize);
                    const content = contentType.readPacked(dataView, options);
                    const header = content.slice(0, 4);

                    if (content[ 0 ] === 0xFF && content[ 1 ] === 0xD8 && content[ 2 ] === 0xFF && content[ 3 ] === 0xDB) {
                        if (!data.options.isJPEGFileMaybe) {
                            console.warn("Image is JPEG but not marked as such:", element.fileName, "Header:", header);
                            Deno.exit(1);
                        }
                        const image: ParsedImage = {
                            source: {
                                fileName: element.fileName,
                                description: element.description
                            },
                            data,
                            image: {
                                type: "jpeg",
                                data: content
                            }
                        };
                        imageCount++;
                        controller.enqueue(image);
                    }
                    else {
                        unsupportedImages++;
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
    .pipeThrough(new CompressionStream("deflate"))
    .pipeTo(exportFile.writable);

console.log(unsupportedImages, "unsupported images found.");
