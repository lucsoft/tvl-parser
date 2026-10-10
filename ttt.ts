/**
 * Parser for the `.ttt` scene definition files that ship with the Traffic
 * installer. They carry what the `.tvl` libraries do not: where an animation
 * frame, a mask or an overlay sits on its base picture.
 *
 * The grammar is only partly documented (TRAFFICE.HLP), so this keeps the raw
 * text of everything it parses. Nothing is dropped silently - `parseFile`
 * reports what it could not classify.
 */

/** `[A:DOOR,CSD_810DLO,15,3,16,27,0,0,18,9,16,0]` and friends. */
export interface Annotation {
    /** `A`, `O`, `MSK`, `MI`, ... - 14 kinds occur in the shipped files. */
    kind: string;
    args: string[];
    raw: string;
}

/** One alternative inside a `$DEF`, e.g. `FR_KO34[MI:20]`. */
export interface PictureRef {
    name: string;
    annotations: Annotation[];
}

export interface Node {
    /** Directive name without the `$`, e.g. `DEF`, `SCENE`, `PATH`. */
    name: string;
    /** 1-based line of the first physical line, for pointing at the source. */
    line: number;
    /** The joined logical line, comments stripped, exactly as parsed. */
    raw: string;
    /** `$DEF NAME=...` - the name being defined. */
    target?: string;
    /** `KEY=VALUE;` pairs, when the body is a parameter list. */
    params?: Record<string, string>;
    /** `|` separated picture alternatives, when the body is one. */
    alternatives?: PictureRef[];
    /** Annotations found in parameter values, e.g. a mask on a `FG=`. */
    annotations?: Annotation[];
    /** Nested nodes for block directives. */
    children?: Node[];
}

export interface TttFile {
    fileName: string;
    nodes: Node[];
    /** Logical lines that are neither comment nor recognised directive. */
    unclassified: { line: number; text: string; }[];
}

/** Block openers mapped to the directive that closes them. */
const BLOCKS: Record<string, string> = {
    IF: "}",
    SECTION: "ENDSECTION",
    GROUP: "ENDGROUP",
    SCENE: "ENDSCENE",
    PATH: "ENDPATH",
    POOL: "ENDPOOL",
    SPOOL: "ENDPOOL",
    IPOOL: "ENDPOOL",
};

const ANNOTATION = /\[([A-Z]+)[:!]([^\]]*)\]/g;

function parseAnnotations(text: string): { name: string; annotations: Annotation[]; } {
    const annotations: Annotation[] = [];
    let name = text;
    const first = text.indexOf("[");
    if (first >= 0) name = text.slice(0, first);
    for (const m of text.matchAll(ANNOTATION)) {
        annotations.push({ kind: m[1], args: m[2].split(","), raw: m[0] });
    }
    return { name: name.trim(), annotations };
}

/** Splits on a separator that is not inside brackets or parentheses. */
function splitTop(text: string, separator: string): string[] {
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "[" || c === "(") depth++;
        else if (c === "]" || c === ")") depth--;
        else if (c === separator && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
}

function parseBody(name: string, body: string): Partial<Node> {
    if (!body) return {};

    // `$DEF NAME=a|b|c` - a named list of picture alternatives
    if (name === "DEF") {
        const eq = body.indexOf("=");
        if (eq < 0) return {};
        const alternatives = splitTop(body.slice(eq + 1), "|")
            .map((part) => parseAnnotations(part.trim()))
            .filter((p) => p.name || p.annotations.length);
        return { target: body.slice(0, eq).trim(), alternatives };
    }

    // `KEY=VALUE; KEY=VALUE;` - the shape scenes, paths and groups use
    if (body.includes("=")) {
        const params: Record<string, string> = {};
        for (const part of splitTop(body, ";")) {
            const eq = part.indexOf("=");
            if (eq < 0) continue;
            const key = part.slice(0, eq).trim();
            if (key && !key.includes(" ")) params[key] = part.slice(eq + 1).trim();
        }
        if (Object.keys(params).length) {
            const annotations: Annotation[] = [];
            for (const value of Object.values(params)) {
                for (const m of value.matchAll(ANNOTATION)) {
                    annotations.push({ kind: m[ 1 ], args: m[ 2 ].split(","), raw: m[ 0 ] });
                }
            }
            return annotations.length ? { params, annotations } : { params };
        }
    }

    return {};
}

export function parseFile(fileName: string, text: string): TttFile {
    const root: Node[] = [];
    const stack: Node[] = [];
    const unclassified: { line: number; text: string; }[] = [];

    const physical = text.split(/\r?\n/);
    let i = 0;
    while (i < physical.length) {
        const startLine = i + 1;

        // join continuations, then strip a trailing comment
        let joined = "";
        while (i < physical.length) {
            const line = physical[i++];
            const continues = line.endsWith("\\");
            joined += continues ? line.slice(0, -1) : line;
            if (!continues) break;
        }
        const hash = joined.indexOf("#");
        if (hash >= 0) joined = joined.slice(0, hash);
        const trimmed = joined.trim();
        // both # and a leading ; introduce a comment
        if (!trimmed || trimmed.startsWith(";")) continue;

        // directives are written in either case in the shipped files
        // `{E4?` ... `}` is a conditional block: include the body when the
        // condition holds. The condition is kept verbatim - its grammar is not
        // documented beyond the examples.
        if (trimmed === "}") {
            const open = stack[ stack.length - 1 ];
            if (open?.name === "IF") { stack.pop(); continue; }
            unclassified.push({ line: startLine, text: trimmed });
            continue;
        }
        if (trimmed.startsWith("{") && trimmed.endsWith("?")) {
            const node: Node = {
                name: "IF",
                line: startLine,
                raw: trimmed,
                params: { condition: trimmed.slice(1, -1).trim() },
            };
            const open = stack[ stack.length - 1 ];
            (open ? (open.children ??= []) : root).push(node);
            stack.push(node);
            continue;
        }

        // `%NAME(args)` invokes a macro defined elsewhere in the file set.
        const macro = trimmed.match(/^%([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?/);
        if (macro) {
            const node: Node = {
                name: "MACRO",
                line: startLine,
                raw: trimmed,
                target: macro[ 1 ],
                params: macro[ 2 ] ? Object.fromEntries(macro[ 2 ].split(",").map((a, i) => [ String(i), a.trim() ])) : undefined,
            };
            const open = stack[ stack.length - 1 ];
            (open ? (open.children ??= []) : root).push(node);
            continue;
        }

        const match = trimmed.match(/^\$([A-Za-z_]+)\s*(.*)$/s);
        if (!match) {
            // Scene and path bodies are bare `KEY=VALUE;` lists with no directive
            // in front - one line per train, vehicle group or background element.
            const parsed = parseBody("ENTRY", trimmed);
            if (parsed.params) {
                const entry: Node = { name: "ENTRY", line: startLine, raw: trimmed, ...parsed };
                const open = stack[ stack.length - 1 ];
                (open ? (open.children ??= []) : root).push(entry);
            } else {
                unclassified.push({ line: startLine, text: trimmed });
            }
            continue;
        }

        const name = match[ 1 ].toUpperCase();
        const body = match[ 2 ];
        const parent = stack[ stack.length - 1 ];

        // a closing directive pops its block
        if (name.startsWith("END")) {
            if (parent && BLOCKS[ parent.name ] === name) { stack.pop(); continue; }
            // unmatched close - keep it rather than guess
            unclassified.push({ line: startLine, text: trimmed });
            continue;
        }

        const node: Node = { name, line: startLine, raw: trimmed, ...parseBody(name, body.trim()) };
        (parent ? (parent.children ??= []) : root).push(node);
        if (BLOCKS[ name ]) stack.push(node);
    }

    return { fileName, nodes: root, unclassified };
}
