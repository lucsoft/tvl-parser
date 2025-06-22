import { appendBody, asRef, Color, Content, createPage, createRoute, Entry, Grid, Image, Label, List, MaterialIcon, PageRouter, PrimaryButton, ref, StartRouting, WebGenTheme } from "https://raw.githubusercontent.com/lucsoft/WebGen/refs/heads/main/mod.ts";
import { Collection, ErrorOr, RemoteImage } from "../spec.ts";

const endpoint = "https://tvl-cdn.lucsoft.de";

const dataCollections = asRef<Collection[]>([]);
const dataCollection = asRef<Collection | undefined>(undefined);
const dataImagesForCurrentCollection = asRef<RemoteImage[]>([]);

async function request<T>(request: Request): Promise<T | undefined> {
    const response = await fetch(new Request(request, {
        headers: {
            "Accept": "application/json",
        }
    }));

    if (!response.ok) {
        console.error("Failed to fetch collections:", response.status, response.statusText);
        alert("Failed to fetch collections. Please try again later.");
        return;
    }

    const data = await response.json() as ErrorOr<T>;

    if (!data.ok) {
        console.error("Error fetching collections:", data.error);
        alert("Error fetching collections: " + data.error);
        return;
    }
    return data.data;
}

createPage({
    label: "Collections",
    route: createRoute({
        path: "/",
        events: {
            onActive: async () => {
                const data = await request<Collection[]>(new Request(`${endpoint}/api/collections`));
                if (!data) return;
                dataCollections.value = data;
            }
        }
    })
},
    Grid(
        Label("Collections")
            .setFontWeight("bold")
            .setTextSize("4xl")
            .setMargin("50px 0 10px"),
        {
            draw: () => {
                return List(dataCollections, 100, item =>
                    Entry(
                        Grid(
                            Label(item.fileName)
                                .setFontWeight("bold")
                                .setTextSize("2xl"),
                            Label(item.description)
                        )
                            .setGap("5px")
                            .setPadding("15px 0 20px")
                    )
                        .onPromiseClick(async () => {
                            const url = new URL(collection.route.entry.patternUrl, globalThis.location.origin);
                            url.searchParams.set("collection", item.id);
                            await navigation.navigate(url.toString()).finished;
                        })
                ).draw();
            }
        }
    )
        .setHeight("100dvh")
);

const collection = createPage({
    label: "Item",
    route: createRoute({
        path: "/?collection=:id",
        events: {
            onActive: async () => {
                const url = new URL(globalThis.location.href);
                const dataCollections = await request<Collection[]>(new Request(`${endpoint}/api/collections`));
                if (!dataCollections) return;
                dataCollection.value = dataCollections.find(c => c.id === url.searchParams.get("collection"));

                const dataImages = await request<RemoteImage[]>(new Request(`${endpoint}/api/collections/search-by-id/${url.searchParams.get("collection")}`));
                dataImagesForCurrentCollection.value = dataImages ?? [];
            }
        }
    }),
},
    Grid(
        Grid(
            Grid(
                PrimaryButton("Back to Collections")
                    .addPrefix(MaterialIcon("arrow_back"))
                    .onClick(() => navigation.navigate("/"))
                    .setMargin("16px 0 0"),
            )
                .setJustifyItems("start"),
            Label(dataCollection.map(collection => collection?.fileName ?? ""))
                .setFontWeight("bold")
                .setTextSize("3xl")
                .setMargin("20px 0 10px"),
            Label(ref`${dataCollection.map(collection => collection?.description ?? "")} – ${dataImagesForCurrentCollection.map(images => images.length.toLocaleString())} Images`)
        )
            .setMargin("0 0 20px"),
        {
            // workaround: reconnecting of virtual list not working properly
            draw: () => {
                return List(dataImagesForCurrentCollection, 200, item => Entry(
                    Grid(
                        Grid(
                            Image(`${endpoint}/api/images/${item.id}/image`, `Image of ${item.fileName}`)
                                .setCssStyle("imageRendering", "pixelated"),
                        )
                            .setJustifyItems("center"),
                        Grid(
                            Label(item.fileName)
                                .setFontWeight("bold")
                                .setTextSize("2xl"),
                            Label(item.dataType + " File")
                        )
                            .setGap("5px")
                    )
                        .setGap("2rem")
                        .setTemplateColumns("18rem auto")
                        .setAutoFlow("row")
                        .setAlignItems("center")
                )).draw();
            }
        }
    )
        .setCssStyle("gridTemplateRows", "max-content")
        .setHeight("100dvh")
);

appendBody(
    WebGenTheme(
        Content(
            PageRouter
        )
    )
        .useAltLayout()
        .setPrimaryColor(new Color("#007bff"))
);


StartRouting();
