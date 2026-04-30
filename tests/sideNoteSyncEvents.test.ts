import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    mergeSideNoteSyncEventStates,
    SideNoteSyncEventStore,
} from "../src/control/sideNoteSyncEventStore";
import type { PersistedPluginData } from "../src/control/indexNoteSettingsPlanner";
import {
    buildSideNoteSyncEventInputsForThreadDiff,
    decodeSideNoteSyncEventLine,
    encodeSideNoteSyncEvent,
    parseSideNoteSyncEvents,
    reduceSideNoteSyncEvents,
    type SideNoteSyncEvent,
} from "../src/core/storage/sideNoteSyncEvents";

function createThread(filePath: string, overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: "thread-1",
        filePath,
        startLine: 1,
        startChar: 2,
        endLine: 1,
        endChar: 7,
        selectedText: "target",
        selectedTextHash: "hash-target",
        anchorKind: "selection",
        orphaned: false,
        resolved: false,
        entries: [{
            id: "entry-1",
            body: "hello",
            timestamp: 1710000000000,
        }],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
        ...overrides,
    };
}

function createEvent(overrides: Partial<SideNoteSyncEvent> = {}): SideNoteSyncEvent {
    return {
        schemaVersion: 1,
        eventId: "event-1",
        deviceId: "device-a",
        notePath: "docs/note.md",
        noteHash: "hash-docs_note.md",
        logicalClock: 1,
        baseRevisionId: null,
        createdAt: 1710000000100,
        op: "createThread",
        payload: {
            thread: createThread("docs/note.md"),
        },
        ...overrides,
    };
}

test("side-note sync event encoder round-trips event lines and rejects malformed lines", () => {
    const event = createEvent();
    const encoded = encodeSideNoteSyncEvent(event);
    const decoded = decodeSideNoteSyncEventLine(encoded);

    assert.deepEqual(decoded, event);
    assert.deepEqual(parseSideNoteSyncEvents(`ignored\n${encoded}\n%% bad %%`), [event]);
    assert.equal(decodeSideNoteSyncEventLine("not an event"), null);
});

test("side-note sync reducer applies duplicate events idempotently and keeps deletes authoritative", () => {
    const create = createEvent();
    const append = createEvent({
        eventId: "event-2",
        logicalClock: 2,
        op: "appendEntry",
        payload: {
            threadId: "thread-1",
            entry: {
                id: "entry-2",
                body: "reply",
                timestamp: 1710000000200,
            },
        },
    });
    const deleteThread = createEvent({
        eventId: "event-3",
        logicalClock: 3,
        op: "setThreadDeleted",
        payload: {
            threadId: "thread-1",
            deleted: true,
            deletedAt: 1710000000300,
            updatedAt: 1710000000300,
        },
    });
    const staleUpdate = createEvent({
        eventId: "event-4",
        logicalClock: 4,
        op: "updateEntry",
        payload: {
            threadId: "thread-1",
            entryId: "entry-2",
            entry: {
                id: "entry-2",
                body: "stale edit",
                timestamp: 1710000000400,
            },
        },
    });

    const reduced = reduceSideNoteSyncEvents([], [create, create, append, deleteThread, staleUpdate]);

    assert.equal(reduced.appliedEvents.length, 4);
    assert.equal(reduced.threads.length, 0);
    assert.equal(reduced.appliedEventIds.has("event-1"), true);
    assert.equal(reduced.appliedLogicalClocks.has("device-a:1"), true);
});

test("side-note sync diff emits compact mutation events", () => {
    const previous = createThread("docs/note.md");
    const next = createThread("docs/note.md", {
        resolved: true,
        entries: [
            previous.entries[0],
            {
                id: "entry-2",
                body: "reply",
                timestamp: 1710000000100,
            },
        ],
        updatedAt: 1710000000100,
    });

    const inputs = buildSideNoteSyncEventInputsForThreadDiff([previous], [next]);

    assert.deepEqual(inputs.map((input) => input.op), ["setThreadResolved", "appendEntry"]);
});

test("side-note sync diff includes previous entry snapshots for conflict recovery", () => {
    const previous = createThread("docs/note.md");
    const next = createThread("docs/note.md", {
        entries: [{
            ...previous.entries[0],
            body: "edited body",
            timestamp: 1710000000100,
        }],
        updatedAt: 1710000000100,
    });

    const update = buildSideNoteSyncEventInputsForThreadDiff([previous], [next])
        .find((input) => input.op === "updateEntry");

    assert.ok(update);
    assert.deepEqual((update.payload as { previousEntry?: unknown }).previousEntry, previous.entries[0]);
});

test("side-note sync reducer preserves overwritten body when the same entry is edited concurrently", () => {
    const baseThread = createThread("docs/note.md", {
        entries: [{
            id: "entry-1",
            body: "base body",
            timestamp: 1710000000000,
        }],
    });
    const deviceAUpdate = createEvent({
        eventId: "event-a",
        deviceId: "device-a",
        logicalClock: 1,
        op: "updateEntry",
        payload: {
            threadId: "thread-1",
            entryId: "entry-1",
            previousEntry: baseThread.entries[0],
            entry: {
                id: "entry-1",
                body: "device A body",
                timestamp: 1710000000100,
            },
        },
    });
    const deviceBUpdate = createEvent({
        eventId: "event-b",
        deviceId: "device-b",
        logicalClock: 1,
        createdAt: 1710000000200,
        op: "updateEntry",
        payload: {
            threadId: "thread-1",
            entryId: "entry-1",
            previousEntry: baseThread.entries[0],
            entry: {
                id: "entry-1",
                body: "device B body",
                timestamp: 1710000000200,
            },
        },
    });

    const reduced = reduceSideNoteSyncEvents([baseThread], [deviceBUpdate, deviceAUpdate]);
    const thread = reduced.threads[0];
    const recoveryEntry = thread.entries.find((entry) => entry.id === "sync-conflict-event-b");

    assert.equal(thread.entries[0].body, "device B body");
    assert.ok(recoveryEntry);
    assert.match(recoveryEntry.body, /device A body/);
});

test("side-note sync event store appends local events and marks them processed for the current device", async () => {
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const store = new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => "device-a",
        createEventId: () => `event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100,
    });

    const events = await store.appendLocalEvents("docs/note.md", [{
        op: "createThread",
        payload: {
            thread: createThread("docs/note.md"),
        },
    }]);
    const state = store.readState();

    assert.equal(events.length, 1);
    assert.equal(events[0].deviceId, "device-a");
    assert.equal(events[0].logicalClock, 1);
    assert.equal(state.deviceLogs["device-a"]?.lastClock, 1);
    assert.equal(state.processedWatermarks["device-a"]?.["device-a"], 1);
    assert.deepEqual(store.getUnprocessedEvents(), []);
});

test("side-note sync event store merges latest plugin data before writing stale local state", async () => {
    let diskData: PersistedPluginData = {};
    let deviceAData: PersistedPluginData = {};
    let deviceBData: PersistedPluginData = {};
    let eventCounter = 0;
    const createStore = (deviceId: string, getLocalData: () => PersistedPluginData, setLocalData: (data: PersistedPluginData) => void) =>
        new SideNoteSyncEventStore({
            readPersistedPluginData: getLocalData,
            readLatestPersistedPluginData: async () => diskData,
            writePersistedPluginData: async (data) => {
                setLocalData(data);
                diskData = data;
            },
            getDeviceId: () => deviceId,
            createEventId: () => `event-${++eventCounter}`,
            hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
            now: () => 1710000000100 + eventCounter,
        });

    await createStore("device-a", () => deviceAData, (data) => {
        deviceAData = data;
    }).appendLocalEvents("docs/a.md", [{
        op: "createThread",
        payload: {
            thread: createThread("docs/a.md", { id: "thread-a" }),
        },
    }]);

    await createStore("device-b", () => deviceBData, (data) => {
        deviceBData = data;
    }).appendLocalEvents("docs/b.md", [{
        op: "createThread",
        payload: {
            thread: createThread("docs/b.md", { id: "thread-b" }),
        },
    }]);

    const finalStore = createStore("device-c", () => diskData, (data) => {
        diskData = data;
    });
    const state = finalStore.readState();

    assert.equal(state.deviceLogs["device-a"]?.events.length, 1);
    assert.equal(state.deviceLogs["device-b"]?.events.length, 1);
    assert.equal(state.processedWatermarks["device-a"]?.["device-a"], 1);
    assert.equal(state.processedWatermarks["device-b"]?.["device-b"], 1);
});

test("side-note sync event state merge keeps device logs, max watermarks, and newest snapshots", () => {
    const left = new SideNoteSyncEventStore({
        readPersistedPluginData: () => ({}),
        writePersistedPluginData: async () => {},
        getDeviceId: () => "device-a",
        createEventId: () => "event-a",
        hashText: async (text) => `hash-${text}`,
        now: () => 1710000000000,
    }).readState();
    const right = new SideNoteSyncEventStore({
        readPersistedPluginData: () => ({}),
        writePersistedPluginData: async () => {},
        getDeviceId: () => "device-b",
        createEventId: () => "event-b",
        hashText: async (text) => `hash-${text}`,
        now: () => 1710000000000,
    }).readState();
    left.deviceLogs["device-a"] = {
        lastClock: 1,
        events: [createEvent({ eventId: "event-a", deviceId: "device-a", logicalClock: 1 })],
    };
    left.processedWatermarks["device-a"] = { "device-a": 1 };
    left.noteSnapshots["hash-docs_note.md"] = {
        notePath: "docs/note.md",
        noteHash: "hash-docs_note.md",
        updatedAt: 1,
        coveredWatermarks: { "device-a": 1 },
        threads: [createThread("docs/note.md", { id: "old-thread" })],
    };
    right.deviceLogs["device-b"] = {
        lastClock: 1,
        events: [createEvent({ eventId: "event-b", deviceId: "device-b", logicalClock: 1 })],
    };
    right.processedWatermarks["device-a"] = { "device-a": 0, "device-b": 1 };
    right.processedWatermarks["device-b"] = { "device-b": 1 };
    right.noteSnapshots["hash-docs_note.md"] = {
        notePath: "docs/note.md",
        noteHash: "hash-docs_note.md",
        updatedAt: 2,
        coveredWatermarks: { "device-a": 1, "device-b": 1 },
        threads: [createThread("docs/note.md", { id: "new-thread" })],
    };

    const merged = mergeSideNoteSyncEventStates(left, right);

    assert.equal(merged.deviceLogs["device-a"]?.events.length, 1);
    assert.equal(merged.deviceLogs["device-b"]?.events.length, 1);
    assert.equal(merged.processedWatermarks["device-a"]?.["device-a"], 1);
    assert.equal(merged.processedWatermarks["device-a"]?.["device-b"], 1);
    assert.equal(merged.noteSnapshots["hash-docs_note.md"]?.threads[0].id, "new-thread");
});

test("side-note sync event store exposes remote events until the current device processes them", async () => {
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const createStore = (deviceId: string) => new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => deviceId,
        createEventId: () => `event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100,
    });

    await createStore("device-b").appendLocalEvents("docs/note.md", [{
        op: "createThread",
        payload: {
            thread: createThread("docs/note.md"),
        },
    }]);

    const store = createStore("device-a");
    const unprocessedEvents = store.getUnprocessedEvents();

    assert.equal(unprocessedEvents.length, 1);
    assert.equal(unprocessedEvents[0].deviceId, "device-b");
    assert.equal(unprocessedEvents[0].logicalClock, 1);

    await store.markEventsProcessed(unprocessedEvents);

    assert.deepEqual(store.getUnprocessedEvents(), []);
    assert.equal(store.readState().processedWatermarks["device-a"]?.["device-b"], 1);
});

test("side-note sync event store compacts only globally covered log prefixes", async () => {
    let persistedData: PersistedPluginData = {};
    let eventCounter = 0;
    const createStore = (deviceId: string) => new SideNoteSyncEventStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
        getDeviceId: () => deviceId,
        createEventId: () => `event-${++eventCounter}`,
        hashText: async (text) => `hash-${text.replace(/\//g, "_")}`,
        now: () => 1710000000100,
    });
    const noteAThread = createThread("docs/a.md", { id: "thread-a" });
    const noteBThread = createThread("docs/b.md", { id: "thread-b" });

    const deviceA = createStore("device-a");
    await deviceA.appendLocalEvents("docs/a.md", [{
        op: "createThread",
        payload: {
            thread: noteAThread,
        },
    }]);
    await deviceA.appendLocalEvents("docs/b.md", [{
        op: "createThread",
        payload: {
            thread: noteBThread,
        },
    }]);

    const compacted = await deviceA.compactProcessedEventsForSnapshots([{
        notePath: "docs/a.md",
        threads: [noteAThread],
    }]);
    const state = deviceA.readState();

    assert.equal(compacted.removedEventCount, 1);
    assert.equal(state.compactedWatermarks["device-a"], 1);
    assert.deepEqual(state.deviceLogs["device-a"]?.events.map((event) => event.logicalClock), [2]);
    assert.equal(deviceA.getSnapshots().length, 1);

    const deviceC = createStore("device-c");
    const unprocessedEvents = deviceC.getUnprocessedEvents();
    assert.deepEqual(unprocessedEvents.map((event) => event.logicalClock), [2]);

    await deviceC.markEventsProcessed(unprocessedEvents);

    assert.equal(deviceC.readState().processedWatermarks["device-c"]?.["device-a"], 2);
});
