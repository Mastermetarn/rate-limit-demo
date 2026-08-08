import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { TokenBucketStore } from "../src/token-bucket.js";

async function startTestServer(limiter = new TokenBucketStore()) {
    const server = createApp({ limiter }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    };
}

test("the API issues a key and returns rate limit state", async (context) => {
    const server = await startTestServer();
    context.after(server.close);

    const keyResponse = await fetch(`${server.baseUrl}/api/key`, { method: "POST" });
    const { apiKey } = await keyResponse.json();
    const demoResponse = await fetch(`${server.baseUrl}/api/demo`, {
        headers: { "X-API-Key": apiKey }
    });
    const body = await demoResponse.json();

    assert.equal(keyResponse.status, 201);
    assert.match(apiKey, /^demo_[A-Za-z0-9_-]+$/);
    assert.equal(demoResponse.status, 200);
    assert.equal(demoResponse.headers.get("x-ratelimit-limit"), "100");
    assert.equal(body.rateLimit.remaining, 99);
});

test("missing and unknown keys return 401", async (context) => {
    const server = await startTestServer();
    context.after(server.close);

    const missing = await fetch(`${server.baseUrl}/api/demo`);
    const unknown = await fetch(`${server.baseUrl}/api/demo`, {
        headers: { "X-API-Key": "demo_unknown" }
    });

    assert.equal(missing.status, 401);
    assert.equal(unknown.status, 401);
});

test("the 101st immediate request returns 429 with Retry-After", async (context) => {
    let now = 1_000;
    const limiter = new TokenBucketStore({ clock: () => now });
    const server = await startTestServer(limiter);
    context.after(server.close);

    const keyResponse = await fetch(`${server.baseUrl}/api/key`, { method: "POST" });
    const { apiKey } = await keyResponse.json();
    let response;

    for (let request = 0; request < 101; request += 1) {
        response = await fetch(`${server.baseUrl}/api/demo`, {
            headers: { "X-API-Key": apiKey }
        });
    }

    const body = await response.json();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "1");
    assert.equal(body.rateLimit.remaining, 0);

    now += 600;
    const recovered = await fetch(`${server.baseUrl}/api/demo`, {
        headers: { "X-API-Key": apiKey }
    });
    assert.equal(recovered.status, 200);
});
