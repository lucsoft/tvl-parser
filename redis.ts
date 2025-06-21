import { connect, RedisPipeline } from "jsr:@db/redis";

export const redis = await connect({
    hostname: "127.0.0.1",
    port: 6379,
});

export async function pipeline<T extends Record<string, Promise<unknown>>>(creator: (pl: RedisPipeline) => T) {
    const pl = redis.pipeline();
    const keys = Object.keys(creator(pl));
    const values = await pl.flush();

    return Object.fromEntries(
        keys.map((key, index) => [ key, values[ index ] ] as const)
    ) as { [ K in keyof T ]: Awaited<T[ K ]>; };
}