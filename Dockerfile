from denoland/deno

workdir /app/

copy deno.jsonc /app/
copy deno.lock /app/

run deno install

copy *.ts /app/

cmd ["deno", "run", "-A", "--cached-only", "server.ts"]