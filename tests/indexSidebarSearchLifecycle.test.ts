import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { commentToThread } from "../src/commentManager";
import * as searchState from "../src/ui/views/indexSidebarState";
import { buildIndexSidebarSearchWindow } from "../src/ui/views/indexSidebarSearchWindow";
import {
    buildStoredOrderSidebarItems,
    sortSidebarRenderableItems,
    type SidebarRenderableItem,
} from "../src/ui/views/sidebarRenderOrder";

// Execute the view's actual lifecycle methods and rendering expression without
// booting Obsidian. Only timers and the DOM/render boundary are replaced.
const source = ts.createSourceFile(
    "AsideView.ts", readFileSync("src/ui/views/AsideView.ts", "utf8"), ts.ScriptTarget.Latest, true,
);
const viewClass = source.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === "AsideView",
)!;

function createSearchHarness() {
    const names = new Set([
        "NOTE_SIDEBAR_SEARCH_DEBOUNCE_MS",
        "clearIndexSidebarSearchDebounceTimer",
        "clearIndexTagSearchDebounceTimer",
        "clearIndexSidebarSearchState",
        "applyIndexSidebarSearchStateForMode",
        "applyIndexSidebarSearchStateForFileScope",
        "scheduleIndexSidebarSearchQuery",
        "applyIndexSidebarSearchQuery",
    ]);
    const members = viewClass.members.filter((node) => node.name && names.has(node.name.getText(source)));
    assert.equal(members.length, names.size);
    const code = ts.transpileModule(
        `class AsideView { ${members.map((node) => node.getText(source)).join("\n")} }; new AsideView();`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const timers = new Map<number, () => void>();
    let timerId = 0;
    const view = runInNewContext(code, {
        ...searchState,
        HTMLInputElement: class {},
        nodeInstanceOf: (value: unknown, constructor: typeof Object) => value instanceof constructor,
        window: {
            setTimeout(callback: () => void) { timers.set(++timerId, callback); return timerId; },
            clearTimeout(id: number) { timers.delete(id); },
        },
    });
    const renderedQueries: string[] = [];
    Object.assign(view, {
        indexSidebarSearchInputValue: "old",
        indexSidebarSearchQuery: "old",
        indexSidebarSearchRequestVersion: 0,
        indexSidebarSearchDebounceTimer: null,
        indexTagSearchDebounceTimer: null,
        indexSidebarMode: "list",
        file: null,
        containerEl: { ownerDocument: { activeElement: null } },
        async renderComments() { renderedQueries.push(view.indexSidebarSearchQuery); },
    });
    return {
        view, renderedQueries,
        async flushTimers() {
            const callbacks = [...timers.values()];
            timers.clear();
            for (const callback of callbacks) callback();
            await Promise.resolve();
        },
    };
}

test("a pending search survives card-tab switches, including clearing the query", async () => {
    for (const mode of ["list", "todo", "agent"]) {
        for (const query of ["new", ""]) {
            const { view, renderedQueries, flushTimers } = createSearchHarness();
            view.scheduleIndexSidebarSearchQuery(query);
            view.indexSidebarMode = mode;
            view.applyIndexSidebarSearchStateForMode(mode);
            view.applyIndexSidebarSearchStateForFileScope("note.md");
            await flushTimers();
            assert.equal(view.indexSidebarSearchInputValue, query);
            assert.equal(view.indexSidebarSearchQuery, query, `stale query in ${mode}`);
            assert.deepEqual(renderedQueries, [query]);
        }
    }
});

test("leaving card tabs or losing a required file scope cancels pending search", async () => {
    for (const mode of ["tags", "thought-trail", "list", "agent"]) {
        const { view, renderedQueries, flushTimers } = createSearchHarness();
        view.scheduleIndexSidebarSearchQuery("new");
        view.indexSidebarMode = mode;
        view.applyIndexSidebarSearchStateForMode(mode);
        view.applyIndexSidebarSearchStateForFileScope(null);
        await flushTimers();
        assert.equal(view.indexSidebarSearchInputValue, "");
        assert.equal(view.indexSidebarSearchQuery, "");
        assert.deepEqual(renderedQueries, []);
    }
});

test("global Todo keeps only the latest pending query without a selected file", async () => {
    const { view, renderedQueries, flushTimers } = createSearchHarness();
    view.scheduleIndexSidebarSearchQuery("first");
    view.indexSidebarMode = "todo";
    view.applyIndexSidebarSearchStateForMode("todo");
    view.applyIndexSidebarSearchStateForFileScope(null);
    view.scheduleIndexSidebarSearchQuery("latest");
    await flushTimers();
    assert.equal(view.indexSidebarSearchInputValue, "latest");
    assert.equal(view.indexSidebarSearchQuery, "latest");
    assert.deepEqual(renderedQueries, ["latest"]);
});

test("global Todo renders relevance order during search and file order after clearing", () => {
    const anchor = { startLine: 0, startChar: 0, endLine: 0, endChar: 1, selectedTextHash: "hash" };
    const threads = [
        commentToThread({ ...anchor, id: "best", filePath: "z.md", selectedText: "architecture", comment: "@todo", timestamp: 1 }),
        commentToThread({ ...anchor, id: "weak", filePath: "a.md", selectedText: "unrelated", comment: "@todo architecture", timestamp: 1 }),
        commentToThread({ ...anchor, id: "unmatched", filePath: "b.md", selectedText: "unrelated", comment: "@todo", timestamp: 1 }),
    ];
    const renderMethod = viewClass.members.find((node) => node.name?.getText(source) === "renderComments")!;
    let renderExpression: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "renderableItems") {
            renderExpression = node.initializer;
        }
        ts.forEachChild(node, visit);
    };
    visit(renderMethod);
    assert.ok(renderExpression);
    for (const query of ["architecture", "", "   "]) {
        const ranked = buildIndexSidebarSearchWindow({ threads, query, mode: "todo", rootFilePath: null });
        const items: SidebarRenderableItem[] = runInNewContext(renderExpression.getText(source), {
            indexSidebarSearchQuery: query,
            isAllCommentsView: true,
            searchScopedVisibleThreads: ranked.items,
            pinnedScopedVisibleThreads: threads,
            topLevelDraftComment: null,
            replacedThreadId: null,
            buildStoredOrderSidebarItems,
            sortSidebarRenderableItems,
        });
        assert.deepEqual(items.map((item) => item.kind === "thread" ? item.thread.id : item.draft.id),
            query.trim() ? ["best", "weak"] : ["weak", "unmatched", "best"]);
    }
});
