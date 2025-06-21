import data from "./import.json" with { type: "json" };

for (const [ url, _ ] of data) {
    const location = new URL(url);
    const file = await fetch(url).then(data => data.bytes());
    const fileName = location.pathname.split("/").at(-1);
    await Deno.writeFile("./export/" + fileName, file);
}