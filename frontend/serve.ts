import { serve } from "https://deno.land/x/esbuild_serve@1.5.0/mod.ts";

serve({
    pages: {
        "index": "index.ts"
    },
    poylfills: [
        "https://unpkg.com/urlpattern-polyfill@10.0.0/index.js",
        "https://esm.sh/@virtualstate/navigation@1.0.1-alpha.209/polyfill",
    ]
});