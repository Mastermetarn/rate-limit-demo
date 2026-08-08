import { createApp } from "./app.js";
import { TokenBucketStore } from "./token-bucket.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const limiter = new TokenBucketStore();
const app = createApp({ limiter });

const cleanupTimer = setInterval(() => limiter.cleanup(), 5 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Rate limit demo listening on port ${port}`);
});

function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    clearInterval(cleanupTimer);
    server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
