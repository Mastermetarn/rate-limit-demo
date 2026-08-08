import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { TokenBucketStore } from "./token-bucket.js";

const publicDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "public"
);

function setRateLimitHeaders(response, rateLimit) {
    response.set({
        "Cache-Control": "no-store",
        "X-RateLimit-Algorithm": rateLimit.algorithm,
        "X-RateLimit-Limit": String(rateLimit.capacity),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Refill-Per-Minute": String(rateLimit.refillPerMinute),
        "X-RateLimit-Full-In": String(rateLimit.fullInSeconds)
    });
}

export function createApp({ limiter = new TokenBucketStore() } = {}) {
    const app = express();

    app.disable("x-powered-by");
    app.use(express.json({ limit: "1kb" }));

    app.get("/healthz", (_request, response) => {
        response.json({ ok: true });
    });

    app.post("/api/key", (_request, response) => {
        const apiKey = `demo_${crypto.randomBytes(18).toString("base64url")}`;
        limiter.register(apiKey);

        response
            .set("Cache-Control", "no-store")
            .status(201)
            .json({ apiKey });
    });

    app.get("/api/demo", (request, response) => {
        const apiKey = request.get("X-API-Key");

        if (!apiKey || !limiter.has(apiKey)) {
            response
                .set("Cache-Control", "no-store")
                .status(401)
                .json({
                    ok: false,
                    error: "A valid demo API key is required."
                });
            return;
        }

        const rateLimit = limiter.consume(apiKey);
        setRateLimitHeaders(response, rateLimit);

        if (!rateLimit.allowed) {
            response
                .set("Retry-After", String(Math.max(1, rateLimit.nextTokenInSeconds)))
                .status(429)
                .json({
                    ok: false,
                    error: "Rate limit exceeded.",
                    timestamp: new Date().toISOString(),
                    rateLimit
                });
            return;
        }

        response.json({
            ok: true,
            message: "Request accepted.",
            timestamp: new Date().toISOString(),
            rateLimit
        });
    });

    app.use(express.static(publicDirectory, {
        etag: true,
        maxAge: 0
    }));

    return app;
}
