# TVL Parser

tvl is a custom image collection file format used to store a custom bitmap format, pngs and jpegs. Collected from this site <https://pc2.pxtr.de/>

This parser has reverse engineered the file format and can convert it to the self describing format CBOR (Concise Binary Object Representation).

## Usage

Downloading the files

```bash
# Downloads all the files from the pc2.pxtr.de
# Which files to download are defined in the import.json file
deno run -A downloader.ts
# Now decompress the zips
```

Merging the files into a single cbor collection

```bash
# Just to collect all the tvl files into a single file - makes a sha256 hash and adds a description
deno run -A merger.ts
```

Converting the cbor collection to a parsed cbor export file

```bash
# This can take a while, as it will decompress multiple times and then parse them turns into the well defined structure and stream compresses it.
deno run -A parser.ts
```
