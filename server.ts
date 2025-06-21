import { assert } from "@std/assert";
import { CborType, encodeCbor } from "@std/cbor";
import { route, Route } from "@std/http/unstable-route";
import sharp from "sharp";
import { pipeline, redis } from "./redis.ts";
import { Collection, ErrorOr, RemoteImage } from "./spec.ts";

function serveFail<T extends Error>(req: Request, error: T) {
    if (req.headers.get("Accept")?.includes("application/json")) {
        return new Response(JSON.stringify(<ErrorOr<T>>{
            ok: false,
            error: error.message
        }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }
    else if (req.headers.get("Accept")?.includes("application/cbor")) {
        return new Response(encodeCbor(<ErrorOr<unknown>>{
            ok: false,
            error: error.message
        } as CborType), {
            headers: {
                "Content-Type": "application/cbor",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }
    else {
        return new Response("Unsupported Accept header", { status: 406 });
    }
}

function serveData<T extends CborType>(req: Request, data: T) {
    if (req.headers.get("Accept")?.includes("application/json")) {
        return new Response(JSON.stringify(<ErrorOr<T>>{
            ok: true,
            data
        }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }
    else if (req.headers.get("Accept")?.includes("application/cbor")) {
        return new Response(encodeCbor({
            ok: true,
            data
        }), {
            headers: {
                "Content-Type": "application/cbor",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }
    else {
        return new Response("Unsupported Accept header", { status: 406 });
    }
}

const routes: Route[] = [
    {
        pattern: new URLPattern({ pathname: "/api/collections" }),
        handler: async (req) => {
            const data = await redis.hgetall("collections");
            return serveData(req,
                data
                    .filter((_, index) => index % 2 === 1)
                    .map(data => JSON.parse(data))
                    .map((data): Collection => ({
                        id: data.id,
                        description: data.description,
                        fileName: data.fileName
                    }))
            );

        }
    },
    {
        pattern: new URLPattern({ pathname: "/api/collections/search-by-id/:id" }),
        handler: async (req, params) => {
            assert(params, "Missing params in request");
            const { id } = params.pathname.groups;
            assert(id, "Missing collection ID in request");
            const imagesInCollection = await redis.smembers(`collection:${id}`);
            const images: RemoteImage[] = [];

            const pl = redis.pipeline();
            for (const imageKey of imagesInCollection) {
                pl.hget(imageKey, "fileName");
                pl.hget(imageKey, "dataType");
            }
            const data = await pl.flush();

            for (const [ index, imageKey ] of imagesInCollection.entries()) {
                const filename = data[ index * 2 ];
                const dataType = data[ index * 2 + 1 ];
                images.push({
                    id: imageKey.split(":")[ 1 ],
                    fileName: filename as string,
                    dataType: dataType as 'jpeg' | 'tvl' | 'unknown',
                });
            }

            return serveData(req, images);
        }
    },
    {
        pattern: new URLPattern({ pathname: "/api/images/:id/image" }),
        handler: async (req, params) => {
            assert(params, "Missing params in request");
            const { id } = params.pathname.groups;
            assert(id, "Missing image ID in request");
            const imageKey = `image:${id}`;
            const doesWebpAlreadyExist = await redis.hexists(imageKey, "webp");

            if (doesWebpAlreadyExist) {
                const data = await redis.sendCommand("HGET", [ imageKey, "webp" ], {
                    returnUint8Arrays: true
                });

                return new Response(
                    data as Uint8Array,
                    {
                        headers: {
                            "Content-Type": "image/webp",
                            "Cache-Control": "public, max-age=3600"
                        }
                    }
                );
            }

            const dataType = await redis.hget(imageKey, "dataType") as 'jpeg' | 'tvl' | 'unknown';

            if (dataType === "unknown") {
                return serveFail(req, new Error("Image format is unknown"));
            }
            else if (dataType === "tvl") {
                const startTime = performance.now();
                const redisData = await pipeline(pl => ({
                    height: pl.hget(imageKey, "height") as Promise<string>,
                    width: pl.hget(imageKey, "width") as Promise<string>,
                    colorPalette: pl.sendCommand("HGET", [ imageKey, "colorPalette" ], {
                        returnUint8Arrays: true
                    }) as Promise<Uint8Array>,
                    indexedColors: pl.sendCommand("HGET", [ imageKey, "indexedColors" ], {
                        returnUint8Arrays: true
                    }) as Promise<Uint8Array>,
                    paletteSize: pl.hget(imageKey, "paletteSize") as Promise<string>,
                    options: pl.hget(imageKey, "options") as Promise<string>
                }));

                const width = parseInt(redisData.width, 10);
                const height = parseInt(redisData.height, 10);
                const colorPalette = redisData.colorPalette;
                const indexedColors = redisData.indexedColors;
                const hasTransparency = JSON.parse(redisData.options).hasTransparency;
                const bytes = 4;
                const data = new Uint8Array(width * height * bytes);

                for (let row = 0; row < height; row++) {
                    for (let col = 0; col < width; col++) {
                        const index = row * width + col;
                        const indexColorPalette = indexedColors[ index ];
                        const r = colorPalette[ indexColorPalette * 3 ];
                        const g = colorPalette[ indexColorPalette * 3 + 1 ];
                        const b = colorPalette[ indexColorPalette * 3 + 2 ];
                        const a = indexColorPalette === 0 && hasTransparency ? 0 : 255; // Handle transparency
                        if (a === 0)
                            continue; // Skip transparent pixels
                        data[ (row * width + col) * bytes ] = r;
                        data[ (row * width + col) * bytes + 1 ] = g;
                        data[ (row * width + col) * bytes + 2 ] = b;
                        data[ (row * width + col) * bytes + 3 ] = a; // Set alpha channel
                    }
                }

                const image = await sharp(data, {
                    raw: {
                        channels: bytes,
                        height,
                        width,
                    }
                })
                    .webp()
                    .toBuffer();

                const time = performance.now() - startTime;
                if (time > 10) {
                    console.log(`Took ${performance.now() - startTime}ms to convert TVL image to WebP`);
                }

                await redis.hset(imageKey, "webp", image);

                return new Response(image, {
                    headers: {
                        "Content-Type": "image/webp",
                        "Cache-Control": "public, max-age=3600"
                    }
                });
            }

            return serveFail(req, new Error("Image format conversion not implemented yet"));
        }
    }
];

console.log(routes.map(route => route.method ?? "GET" + " " + route.pattern.pathname).join("\n"));

Deno.serve(route(routes, () => new Response("Not found", { status: 404 })));