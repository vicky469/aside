import * as assert from "node:assert/strict";
import test from "node:test";
import {
    isSidebarCommentOpenBlockingTarget,
    shouldRefocusSidebarCommentContent,
    shouldActivateSidebarComment,
} from "../src/ui/views/commentPointerAction";

function createClosestTarget(
    matcher: (selector: string) => boolean,
): Element {
    return {
        closest(selector: string) {
            return matcher(selector) ? this as Element : null;
        },
    } as unknown as Element;
}

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

test("isSidebarCommentOpenBlockingTarget treats links as card-open blockers", () => {
    const target = createClosestTarget((selector) => selector.includes("a"));

    assert.equal(isSidebarCommentOpenBlockingTarget(target), true);
});

test("isSidebarCommentOpenBlockingTarget treats inline editors as card-open blockers", () => {
    const target = createClosestTarget((selector) => selector.includes(".aside-inline-editor"));

    assert.equal(isSidebarCommentOpenBlockingTarget(target), true);
});

test("shouldRefocusSidebarCommentContent keeps wrapper focus for plain rendered content", () => {
    const target = createClosestTarget(() => false);

    assert.equal(shouldRefocusSidebarCommentContent(target), true);
});

test("shouldRefocusSidebarCommentContent does not steal focus from draft textareas", () => {
    const target = createClosestTarget((selector) => selector.includes("textarea"));

    assert.equal(shouldRefocusSidebarCommentContent(target), false);
});
