import { appendBody, asRef, Color, Content, createPage, createRoute, Entry, Grid, Image, Label, List, MaterialIcon, PageRouter, PrimaryButton, StartRouting, WebGenTheme } from "https://raw.githubusercontent.com/lucsoft/WebGen/refs/heads/main/mod.ts";
import { Collection, ErrorOr, RemoteImage } from "../spec.ts";

const collections = asRef<Collection[]>([]);
const endpoint = "https://tvl-cdn.lucsoft.de";

createPage({
    label: "Collections",
    route: createRoute({
        path: "/",
        events: {
            onActive: async () => {
                const response = await fetch(`${endpoint}/api/collections`, {
                    headers: {
                        "Accept": "application/json",
                    }
                });

                if (!response.ok) {
                    console.error("Failed to fetch collections:", response.status, response.statusText);
                    alert("Failed to fetch collections. Please try again later.");
                    return;
                }

                const data = await response.json() as ErrorOr<Collection[]>;

                if (!data.ok) {
                    console.error("Error fetching collections:", data.error);
                    alert("Error fetching collections: " + data.error);
                    return;
                }

                collections.value = data.data;
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
                return List(collections, 100, item =>
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
                            url.searchParams.set("collectionName", item.fileName);
                            await navigation.navigate(url.toString()).finished;
                        })
                ).draw();
            }
        }
    )
        .setHeight("100dvh")
);

const collectionTitle = asRef<string>("");
const images = asRef<RemoteImage[]>([]);
const collection = createPage({
    label: "Item",
    route: createRoute({
        path: "/?collection=:id",
        events: {
            onActive: async () => {
                const url = new URL(globalThis.location.href);
                collectionTitle.value = url.searchParams.get("collectionName") ?? "Unknown Collection";

                const response = await fetch(`${endpoint}/api/collections/search-by-id/${url.searchParams.get("collection")}`, {
                    headers: {
                        "Accept": "application/json",
                    }
                });

                if (!response.ok) {
                    console.error("Failed to fetch collection images:", response.status, response.statusText);
                    alert("Failed to fetch collection images. Please try again later.");
                    return;
                }
                const data = await response.json() as ErrorOr<RemoteImage[]>;

                if (!data.ok) {
                    console.error("Error fetching collection images:", data.error);
                    alert("Error fetching collection images: " + data.error);
                    return;
                }

                images.value = data.data;
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
            Label(collectionTitle)
                .setFontWeight("bold")
                .setTextSize("3xl")
                .setMargin("20px 0 10px"),
        ),
        {
            // workaround: reconnecting of virtual list not working properly
            draw: () => {
                return List(images, 200, item => Entry(
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
