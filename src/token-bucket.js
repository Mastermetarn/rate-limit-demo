export class TokenBucketStore {
    constructor({
        capacity = 100,
        refillPerMinute = 100,
        idleTtlMs = 30 * 60 * 1000,
        clock = () => Date.now()
    } = {}) {
        if (capacity <= 0 || refillPerMinute <= 0 || idleTtlMs <= 0) {
            throw new Error("Token bucket options must be positive numbers.");
        }

        this.capacity = capacity;
        this.refillPerMinute = refillPerMinute;
        this.refillPerMs = refillPerMinute / 60_000;
        this.idleTtlMs = idleTtlMs;
        this.clock = clock;
        this.buckets = new Map();
    }

    register(key) {
        const now = this.clock();
        this.buckets.set(key, {
            tokens: this.capacity,
            lastRefillAt: now,
            lastSeenAt: now
        });
    }

    has(key) {
        return this.buckets.has(key);
    }

    consume(key) {
        const bucket = this.buckets.get(key);
        if (!bucket) {
            return null;
        }

        const now = this.clock();
        const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
        bucket.tokens = Math.min(
            this.capacity,
            bucket.tokens + elapsedMs * this.refillPerMs
        );
        bucket.lastRefillAt = now;
        bucket.lastSeenAt = now;

        const allowed = bucket.tokens >= 1;
        if (allowed) {
            bucket.tokens -= 1;
        }

        return this.#snapshot(bucket.tokens, allowed);
    }

    cleanup() {
        const staleBefore = this.clock() - this.idleTtlMs;
        let deleted = 0;

        for (const [key, bucket] of this.buckets) {
            if (bucket.lastSeenAt < staleBefore) {
                this.buckets.delete(key);
                deleted += 1;
            }
        }

        return deleted;
    }

    #snapshot(tokens, allowed) {
        const nextTokenInMs = tokens >= 1 ? 0 : (1 - tokens) / this.refillPerMs;
        const fullInMs = (this.capacity - tokens) / this.refillPerMs;

        return {
            allowed,
            algorithm: "token-bucket",
            capacity: this.capacity,
            remaining: Math.round(tokens * 100) / 100,
            refillPerMinute: this.refillPerMinute,
            nextTokenInSeconds: Math.ceil(nextTokenInMs / 1000),
            fullInSeconds: Math.ceil(fullInMs / 1000)
        };
    }
}
