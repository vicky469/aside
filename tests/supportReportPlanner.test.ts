import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildSupportLogPreview,
    buildSupportLogPreviewFromSource,
    buildSupportLogPreviewSource,
    formatSupportAttachmentSize,
    formatSupportLogRowTime,
    formatSupportLogSummaryLine,
    truncateLogPreview,
    validateScreenshotSelection,
    validateSupportReportInput,
} from "../src/ui/views/supportReportPlanner";

test("validateSupportReportInput requires email, title, and content", () => {
    assert.equal(validateSupportReportInput({
        email: "",
        title: "Bug",
        content: "Steps",
    }).valid, false);

    assert.equal(validateSupportReportInput({
        email: "user@example.com",
        title: "Bug",
        content: "Steps",
    }).valid, true);
});

test("validateScreenshotSelection enforces type, size, and count limits", () => {
    assert.deepEqual(validateScreenshotSelection([
        { name: "one.png", size: 100, type: "image/png" },
        { name: "two.jpg", size: 200, type: "image/jpeg" },
    ], 2), {
        accepted: [],
        error: "Attach up to 3 screenshots.",
    });

    assert.deepEqual(validateScreenshotSelection([
        { name: "one.gif", size: 100, type: "image/gif" },
    ], 0), {
        accepted: [],
        error: "Only PNG, JPG, JPEG, and WEBP screenshots are supported.",
    });

    assert.deepEqual(validateScreenshotSelection([
        { name: "one.png", size: 6 * 1024 * 1024, type: "image/png" },
    ], 0), {
        accepted: [],
        error: "Each screenshot must be 5 MB or smaller.",
    });

    const valid = validateScreenshotSelection([
        { name: "one.png", size: 1024, type: "image/png" },
    ], 0);
    assert.equal(valid.error, null);
    assert.equal(valid.accepted.length, 1);
});

test("support planner formats sizes and truncates large log previews", () => {
    assert.equal(formatSupportAttachmentSize(512), "512 B");
    assert.equal(formatSupportAttachmentSize(2048), "2 KB");
    assert.equal(formatSupportAttachmentSize(2 * 1024 * 1024), "2.0 MB");

    const preview = truncateLogPreview("a".repeat(130_000));
    assert.equal(preview.truncated, true);
    assert.match(preview.content, /\[Preview truncated\]$/);
});

test("support planner builds a human-readable log preview in descending time order", () => {
    const content = [
        JSON.stringify({
            at: "2026-04-13T16:55:22.481Z",
            level: "info",
            area: "startup",
            event: "startup.load.begin",
            payload: { pluginVersion: "2.0.5" },
        }),
        JSON.stringify({
            at: "2026-04-13T16:55:22.486Z",
            level: "info",
            area: "persistence",
            event: "storage.note.parse.begin",
            payload: { filePath: "A.md" },
        }),
        JSON.stringify({
            at: "2026-04-13T16:55:22.489Z",
            level: "info",
            area: "persistence",
            event: "storage.note.parse.begin",
            payload: { filePath: "B.md" },
        }),
        JSON.stringify({
            at: "2026-04-13T16:55:22.688Z",
            level: "warn",
            area: "persistence",
            event: "storage.note.parse.unsupported",
            payload: { filePath: "Aside/README-dev.md" },
        }),
    ].join("\n");

    const preview = buildSupportLogPreview(content);
    assert.equal(preview.summary.totalEvents, 4);
    assert.equal(preview.summary.filteredEvents, 4);
    assert.equal(preview.summary.shownEvents, 4);
    assert.equal(preview.summary.hiddenEvents, 0);
    assert.deepEqual(preview.summary.counts, {
        info: 3,
        warn: 1,
        error: 0,
    });
    assert.deepEqual(preview.summary.kindCounts, {
        user: 0,
        system: 4,
    });
    assert.equal(preview.rows.length, 4);
    assert.equal(preview.rows[0].event, "storage.note.parse.unsupported");
    assert.equal(preview.rows[0].kind, "system");
    assert.equal(preview.rows[3].event, "startup.load.begin");
    assert.equal(formatSupportLogRowTime(preview.rows[0], { timeZone: "UTC" }), "16:55:22.688");
    assert.equal(
        formatSupportLogSummaryLine(preview.summary, { timeZone: "UTC" }),
        "2026-04-13 16:55:22.481 -> 2026-04-13 16:55:22.688",
    );
    assert.equal(preview.rawFallbackContent, null);
});

test("support planner falls back to raw text when log lines are not parseable jsonl", () => {
    const preview = buildSupportLogPreview("hello\nnot-json");

    assert.equal(preview.summary.totalEvents, 0);
    assert.equal(preview.summary.invalidLines, 2);
    assert.equal(preview.rows.length, 0);
    assert.ok(preview.rawFallbackContent);
    assert.match(preview.rawFallbackContent!, /hello/);
});

test("support planner filters the preview by recent minutes and kind", () => {
    const content = [
        JSON.stringify({
            at: "2026-04-13T16:40:00.000Z",
            level: "info",
            area: "startup",
            event: "startup.load.begin",
        }),
        JSON.stringify({
            at: "2026-04-13T16:52:00.000Z",
            level: "info",
            area: "index",
            event: "index.filter.changed",
            payload: { source: "view-state" },
        }),
        JSON.stringify({
            at: "2026-04-13T16:54:00.000Z",
            level: "warn",
            area: "persistence",
            event: "storage.note.parse.unsupported",
            payload: { filePath: "Example.md" },
        }),
    ].join("\n");

    const recentPreview = buildSupportLogPreview(content, {
        recentWindowMinutes: 5,
        referenceAt: "2026-04-13T16:55:00.000Z",
    });
    assert.equal(recentPreview.summary.filteredEvents, 2);
    assert.equal(recentPreview.rows.length, 2);
    assert.equal(recentPreview.rows[0].event, "storage.note.parse.unsupported");

    const userPreview = buildSupportLogPreview(content, {
        recentWindowMinutes: 30,
        kind: "user",
        referenceAt: "2026-04-13T16:55:00.000Z",
    });
    assert.equal(userPreview.summary.filteredEvents, 1);
    assert.equal(userPreview.summary.selectedKind, "user");
    assert.equal(userPreview.rows[0].event, "index.filter.changed");
    assert.equal(userPreview.rows[0].kind, "user");
});

test("support planner can reuse a parsed preview source across filter changes", () => {
    const content = [
        JSON.stringify({
            at: "2026-04-13T16:52:00.000Z",
            level: "info",
            area: "index",
            event: "index.filter.changed",
            payload: { source: "view-state" },
        }),
        JSON.stringify({
            at: "2026-04-13T16:54:00.000Z",
            level: "warn",
            area: "persistence",
            event: "storage.note.parse.unsupported",
            payload: { filePath: "Example.md" },
        }),
    ].join("\n");

    const source = buildSupportLogPreviewSource(content);
    const direct = buildSupportLogPreview(content, {
        recentWindowMinutes: 30,
        kind: "user",
        referenceAt: "2026-04-13T16:55:00.000Z",
    });
    const fromSource = buildSupportLogPreviewFromSource(source, {
        recentWindowMinutes: 30,
        kind: "user",
        referenceAt: "2026-04-13T16:55:00.000Z",
    });

    assert.deepEqual(fromSource, direct);
});
