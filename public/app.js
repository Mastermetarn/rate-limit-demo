const REQUESTS_PER_SECOND = 20;
const REQUEST_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;
const MAX_LOG_ENTRIES = 12;

const elements = {
    tokenValue: document.querySelector("#token-value"),
    meter: document.querySelector(".meter"),
    meterFill: document.querySelector("#meter-fill"),
    refillStatus: document.querySelector("#refill-status"),
    singleRequest: document.querySelector("#single-request"),
    startFlood: document.querySelector("#start-flood"),
    stopFlood: document.querySelector("#stop-flood"),
    runState: document.querySelector("#run-state"),
    totalCount: document.querySelector("#total-count"),
    successCount: document.querySelector("#success-count"),
    limitedCount: document.querySelector("#limited-count"),
    errorCount: document.querySelector("#error-count"),
    responseLog: document.querySelector("#response-log")
};

const state = {
    apiKey: null,
    floodTimer: null,
    issuingKey: null,
    bucket: {
        capacity: 100,
        remaining: 100,
        refillPerMinute: 100,
        syncedAt: performance.now(),
        serverTimestamp: 0
    },
    stats: {
        total: 0,
        success: 0,
        limited: 0,
        error: 0
    }
};

function endpoint(relativePath) {
    return new URL(relativePath, new URL(".", window.location.href));
}

async function issueKey() {
    if (state.issuingKey) {
        return state.issuingKey;
    }

    state.issuingKey = (async () => {
        const response = await fetch(endpoint("api/key"), { method: "POST" });
        if (!response.ok) {
            throw new Error(`Could not create API key (${response.status}).`);
        }

        const body = await response.json();
        state.apiKey = body.apiKey;
        syncRateLimit(
            { capacity: 100, remaining: 100, refillPerMinute: 100 },
            { force: true }
        );
        return state.apiKey;
    })().finally(() => {
        state.issuingKey = null;
    });

    return state.issuingKey;
}

function syncRateLimit(rateLimit, { serverTimestamp, force = false } = {}) {
    if (!rateLimit) {
        return;
    }

    const parsedServerTimestamp = serverTimestamp ? Date.parse(serverTimestamp) : 0;
    if (!force && parsedServerTimestamp < state.bucket.serverTimestamp) {
        return;
    }

    state.bucket = {
        capacity: rateLimit.capacity,
        remaining: Math.max(0, rateLimit.remaining),
        refillPerMinute: rateLimit.refillPerMinute,
        syncedAt: performance.now(),
        serverTimestamp: parsedServerTimestamp
    };
    renderRateLimit();
}

function renderRateLimit() {
    const elapsedSeconds = Math.max(0, performance.now() - state.bucket.syncedAt) / 1000;
    const refillPerSecond = state.bucket.refillPerMinute / 60;
    const remaining = Math.min(
        state.bucket.capacity,
        state.bucket.remaining + elapsedSeconds * refillPerSecond
    );
    const percentage = Math.min(100, (remaining / state.bucket.capacity) * 100);
    const fullInSeconds = Math.ceil((state.bucket.capacity - remaining) / refillPerSecond);

    elements.tokenValue.textContent = `${remaining.toFixed(2)} / ${state.bucket.capacity}`;
    elements.meterFill.style.width = `${percentage}%`;
    elements.meterFill.classList.toggle("low", percentage > 0 && percentage <= 25);
    elements.meterFill.classList.toggle("empty", percentage === 0);
    elements.meter.setAttribute("aria-valuemax", String(state.bucket.capacity));
    elements.meter.setAttribute("aria-valuenow", String(remaining));

    const fullStatus = fullInSeconds > 0
        ? ` · full again in ${fullInSeconds}s without requests`
        : " · bucket is full";
    elements.refillStatus.textContent = `${state.bucket.refillPerMinute} tokens per minute · ${refillPerSecond.toFixed(2)} tokens per second${fullStatus}`;
}

function updateStats() {
    elements.totalCount.textContent = state.stats.total;
    elements.successCount.textContent = state.stats.success;
    elements.limitedCount.textContent = state.stats.limited;
    elements.errorCount.textContent = state.stats.error;
}

function addLog(status, message, className) {
    const emptyEntry = elements.responseLog.querySelector(".empty-log");
    emptyEntry?.remove();

    const entry = document.createElement("li");
    const time = document.createElement("time");
    const statusElement = document.createElement("strong");
    const messageElement = document.createElement("span");

    time.dateTime = new Date().toISOString();
    time.textContent = new Date().toLocaleTimeString();
    statusElement.textContent = status;
    statusElement.className = className;
    messageElement.textContent = message;

    entry.append(time, statusElement, messageElement);
    elements.responseLog.prepend(entry);

    while (elements.responseLog.children.length > MAX_LOG_ENTRIES) {
        elements.responseLog.lastElementChild.remove();
    }
}

async function sendDemoRequest({ retryInvalidKey = true } = {}) {
    if (!state.apiKey) {
        await issueKey();
    }

    state.stats.total += 1;
    updateStats();

    try {
        const response = await fetch(endpoint("api/demo"), {
            headers: { "X-API-Key": state.apiKey },
            cache: "no-store"
        });
        const body = await response.json();

        if (response.status === 401 && retryInvalidKey) {
            addLog("401", "Key expired; created a new demo key.", "status-error");
            state.apiKey = null;
            await issueKey();
            return sendDemoRequest({ retryInvalidKey: false });
        }

        syncRateLimit(body.rateLimit, { serverTimestamp: body.timestamp });

        if (response.ok) {
            state.stats.success += 1;
            addLog(String(response.status), body.message, "status-ok");
        } else if (response.status === 429) {
            state.stats.limited += 1;
            addLog("429", `Retry in ${body.rateLimit.nextTokenInSeconds}s`, "status-limited");
        } else {
            state.stats.error += 1;
            addLog(String(response.status), body.error ?? "Request failed.", "status-error");
        }
    } catch (error) {
        state.stats.error += 1;
        addLog("ERR", error.message, "status-error");
    } finally {
        updateStats();
    }
}

function startFlood() {
    if (state.floodTimer !== null) {
        return;
    }

    sendDemoRequest();
    state.floodTimer = window.setInterval(sendDemoRequest, REQUEST_INTERVAL_MS);
    elements.startFlood.disabled = true;
    elements.stopFlood.disabled = false;
    elements.runState.textContent = `Running at ${REQUESTS_PER_SECOND} requests/second`;
    elements.runState.classList.add("active");
}

function stopFlood() {
    if (state.floodTimer !== null) {
        window.clearInterval(state.floodTimer);
        state.floodTimer = null;
    }

    elements.startFlood.disabled = false;
    elements.stopFlood.disabled = true;
    elements.runState.textContent = "Idle";
    elements.runState.classList.remove("active");
}

elements.singleRequest.addEventListener("click", () => sendDemoRequest());
elements.startFlood.addEventListener("click", startFlood);
elements.stopFlood.addEventListener("click", stopFlood);

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopFlood();
    }
});
window.addEventListener("pagehide", stopFlood);

renderRateLimit();
window.setInterval(renderRateLimit, 100);
issueKey().catch((error) => {
    addLog("ERR", error.message, "status-error");
});
