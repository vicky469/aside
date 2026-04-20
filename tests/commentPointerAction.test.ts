import * as assert from "node:assert/strict";
import test from "node:test";
import {
    shouldActivateSidebarComment,
    shouldStartSidebarCommentEditOnDoubleClick,
} from "../src/ui/views/commentPointerAction";

test("shouldActivateSidebarComment allows plain clicks with no selection", () => {
    assert.equal(shouldActivateSidebarComment({
        clickedInteractiveElement: false,
        clickedInsideCommentContent: false,
        selection: null,
        selectionInsideSidebarCommentContent: false,
    }), true);
});

test("shouldActivateSidebarComment blocks interactive targets", () => {
    assert.equal(
        shouldActivateSidebarComment({
            clickedInteractiveElement: true,
            clickedInsideCommentContent: false,
            selection: {
                isCollapsed: true,
                toString: () => "",
            },
            selectionInsideSidebarCommentContent: false,
        }),
        false,
    );
});

test("shouldActivateSidebarComment blocks rendered comment content", () => {
    assert.equal(
        shouldActivateSidebarComment({
            clickedInteractiveElement: false,
            clickedInsideCommentContent: true,
            selection: {
                isCollapsed: true,
                toString: () => "",
            },
            selectionInsideSidebarCommentContent: true,
        }),
        false,
    );
});

test("shouldActivateSidebarComment blocks when text is selected", () => {
    assert.equal(
        shouldActivateSidebarComment({
            clickedInteractiveElement: false,
            clickedInsideCommentContent: false,
            selection: {
                isCollapsed: false,
                toString: () => "copied text",
            },
            selectionInsideSidebarCommentContent: true,
        }),
        false,
    );
});

test("shouldActivateSidebarComment allows clicks when selection is outside the sidebar", () => {
    assert.equal(
        shouldActivateSidebarComment({
            clickedInteractiveElement: false,
            clickedInsideCommentContent: false,
            selection: {
                isCollapsed: false,
                toString: () => "editor selection",
            },
            selectionInsideSidebarCommentContent: false,
        }),
        true,
    );
});

test("shouldStartSidebarCommentEditOnDoubleClick allows plain card double clicks", () => {
    assert.equal(shouldStartSidebarCommentEditOnDoubleClick({
        clickedInteractiveElement: false,
        commentDeleted: false,
    }), true);
});

test("shouldStartSidebarCommentEditOnDoubleClick blocks interactive targets and deleted comments", () => {
    assert.equal(shouldStartSidebarCommentEditOnDoubleClick({
        clickedInteractiveElement: true,
        commentDeleted: false,
    }), false);
    assert.equal(shouldStartSidebarCommentEditOnDoubleClick({
        clickedInteractiveElement: false,
        commentDeleted: true,
    }), false);
});
