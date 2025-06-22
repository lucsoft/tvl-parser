from denoland/deno as build

workdir /app/
copy . /app/
run deno run -A serve.ts build

from joseluisq/static-web-server

copy --from=build /app/dist /public/