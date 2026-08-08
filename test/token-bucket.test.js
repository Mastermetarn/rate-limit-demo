import assert from "node:assert/strict";
import test from "node:test";
import { TokenBucketStore } from "../src/token-bucket.js";

function createFixture(options = {}) {
    let now = 1_000;
    const limiter = new TokenBucketStore({
        clock: () => now,
        ...options
    });

    return {
        limiter,
        advance(milliseconds) {
            now += milliseconds;
        }
    };
}

test("a new key starts full and a request consumes one token", () => {
    const { limiter } = createFixture();
    limiter.register("key-a");

    const result = limiter.consume("key-a");

    assert.equal(result.allowed, true);
    assert.equal(result.capacity, 100);
    assert.equal(result.remaining, 99);
    assert.equal(result.refillPerMinute, 100);
});

test("an empty bucket blocks until enough of the continuous refill is available", () => {
    const fixture = createFixture();
    fixture.limiter.register("key-a");

    for (let request = 0; request < 100; request += 1) {
        assert.equal(fixture.limiter.consume("key-a").allowed, true);
    }

    const blocked = fixture.limiter.consume("key-a");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.nextTokenInSeconds, 1);

    fixture.advance(599);
    assert.equal(fixture.limiter.consume("key-a").allowed, false);

    fixture.advance(1);
    const refilled = fixture.limiter.consume("key-a");
    assert.equal(refilled.allowed, true);
    assert.equal(refilled.remaining, 0);
});

test("keys use independent buckets", () => {
    const { limiter } = createFixture();
    limiter.register("key-a");
    limiter.register("key-b");

    for (let request = 0; request < 100; request += 1) {
        limiter.consume("key-a");
    }

    assert.equal(limiter.consume("key-a").allowed, false);
    assert.equal(limiter.consume("key-b").remaining, 99);
});

test("unknown keys are rejected and idle buckets are removed", () => {
    const fixture = createFixture({ idleTtlMs: 1_000 });
    assert.equal(fixture.limiter.consume("missing"), null);

    fixture.limiter.register("stale");
    fixture.advance(1_001);

    assert.equal(fixture.limiter.cleanup(), 1);
    assert.equal(fixture.limiter.has("stale"), false);
});
