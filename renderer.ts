import { isLittleEndian } from "@denosaurs/byte-type";
import { EventType, PixelFormat, Rect, Texture, TextureAccess, TextureCreator, WindowBuilder } from "@divy/sdl2";
import { ParsedImage } from "./spec.ts";

let frameCounter = 0;
const size = 2;

function performanceLoop(noop: boolean, mainLoop: () => void) {
    if (noop) {
        mainLoop();
        return;
    }
    frameCounter++;
    mainLoop();
}

function createTexture(creator: TextureCreator, image: ParsedImage): Texture {
    const format = isLittleEndian ? PixelFormat.ABGR8888 : PixelFormat.RGBA8888;
    const { data: { width, height, options: { hasTransparency } }, image: imageText } = image;
    if (imageText.type !== "tvl") {
        console.warn("Unsupported image type:", imageText.type, "for file:", image.data.fileName);
        throw new Error("Unsupported image type: " + imageText.type);
    }
    const { colorPalette, indexedColors } = imageText;
    const texture = creator.createTexture(format, TextureAccess.Static, width, height);
    const data = new Uint8Array(width * height * 4);

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
            data[ (row * width + col) * 4 ] = r;
            data[ (row * width + col) * 4 + 1 ] = g;
            data[ (row * width + col) * 4 + 2 ] = b;
            data[ (row * width + col) * 4 + 3 ] = a; // Set alpha channel
        }
    }

    texture.update(data, width * 4);
    return texture;
}

async function renderWindow() {
    if (images.length === 0) {
        console.error("No images found. Please check the file paths.");
        return;
    }
    setInterval(() => {
        console.log(`FPS: ${frameCounter / 1}`);
        frameCounter = 0;
    }, 1000);

    const maxWidth = 200;
    const maxHeight = 80;
    const window = new WindowBuilder("Image View", maxWidth * size, maxHeight * size * 3)
        .resizable()
        .build();
    const canvas = window.canvas();
    const creator = canvas.textureCreator();

    let lastFame = performance.now();
    const scrollSpeed = .8;
    const imageHeight = size * maxHeight;
    let scrollOffset = 0;

    console.log("Creating textures...");
    const textures: Texture[] = images
        .filter(image => image.data.width < 16384)
        .filter(image => image.data.height > 0)
        .filter(image => image.data.width > 0)
        .filter(image => image.image.type === "raw")
        .map(image => createTexture(creator, image));
    console.log("Textures created:", textures.length);

    function lerp(value: number, min: number, max: number): number {
        return min + (max - min) * value;
    }

    for await (const event of window.events(false)) {
        if (event.type == EventType.Quit) {
            Deno.exit(0);
        } else if (event.type == EventType.Draw) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            const currentTime = performance.now();
            const deltaTime = currentTime - lastFame;
            lastFame = currentTime;

            canvas.setDrawColor(0, 0, 0, 255);
            canvas.clear();

            scrollOffset += scrollSpeed * deltaTime;

            const totalHeight = imageHeight * textures.length;
            scrollOffset = scrollOffset % totalHeight;

            // Calculate the index of the first image to draw
            const firstImageIndex = Math.floor(scrollOffset / imageHeight);
            const offsetY = -(scrollOffset % imageHeight);

            performanceLoop(false, () => {
                for (let i = 0; i < 6; i++) {

                    const index = (firstImageIndex + i) % textures.length;

                    const ratioReachedTop = Math.min(1, offsetY / imageHeight + i + .8);
                    const scaling = Math.pow(ratioReachedTop, 2);
                    const image = textures[ index ].query();
                    const width = image.w * (lerp(scaling, 0.8, 1.0));
                    const height = image.h * (lerp(scaling, 0.8, 1.0));

                    const x = (maxWidth / 2 - (width / 2));

                    const imageRect = new Rect(x * size, offsetY + i * imageHeight, width * size, height * size);
                    canvas.copy(textures[ index ], undefined, imageRect);
                }
            });

            canvas.present();
        }
    }
}

renderWindow();