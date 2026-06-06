import * as assert from "node:assert/strict";
import test from "node:test";
import { shouldShowTransientNotice } from "../src/ui/notices/noticePolicy";

test("notice policy suppresses routine Aside workflow messages", () => {
    const suppressed = [
        { message: "Please select some text to add a comment.", area: "draft", event: "draft.notice" },
        { message: "Side notes are limited to 250 words.", area: "draft", event: "draft.notice" },
        { message: "Use only one explicit supported agent target per side note.", area: "agents", event: "agents.notice" },
        { message: "Folder does not exist: docs", area: "index", event: "index.notice" },
        { message: "Support report sent.", area: "support", event: "support.notice" },
    ];

    for (const notice of suppressed) {
        assert.equal(shouldShowTransientNotice(notice), false, notice.message);
    }
});

test("notice policy keeps external open failures visible", () => {
    const visible = [
        { message: "Unable to open Raw/Note.md.", area: "index", event: "index.file.open.error" },
        { message: "Unable to open Aside index.md.", area: "index", event: "index.open.error" },
        { message: "Unable to find that file.", area: "navigation", event: "navigation.notice" },
        { message: "Failed to open that file.", area: "navigation", event: "navigation.notice" },
        { message: "Failed to jump to Markdown view.", area: "navigation", event: "navigation.notice" },
        { message: "Unable to find that side comment.", area: "navigation", event: "navigation.notice" },
    ];

    for (const notice of visible) {
        assert.equal(shouldShowTransientNotice(notice), true, notice.message);
    }
});
