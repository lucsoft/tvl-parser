import { serve } from "https://deno.land/x/esbuild_serve@1.5.0/mod.ts";

serve({
    pages: {
        "index": "index.ts"
    }
});