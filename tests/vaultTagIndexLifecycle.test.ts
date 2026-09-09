import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { TFile } from "obsidian";
import { VaultCapabilityIndex } from "../src/core/vault/vaultCapabilityIndex";

function createHarness() {
    // Exercise the real startup registration block with a delayed metadata cache.
    const source = readFileSync("src/main.ts", "utf8");
    const start = source.indexOf("this.vaultCapabilityIndex.seed(", source.indexOf("async onload()"));
    const end = source.indexOf("this.pluginRegistrationController.register();", start);
    assert.ok(start >= 0 && end > start);
    const code = ts.transpileModule(source.slice(start, end), {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const files = Array.from({ length: 5 }, (_, i) => ({
        path: `Note ${i}.md`, basename: `Note ${i}`, extension: "md",
    } as TFile));
    const cache = new Map<string, string[]>([[files[0].path, ["#灵感"]]]);
    const events = new Map<string, (...args: unknown[]) => void>();
    const layoutCallbacks: Array<() => void> = [];
    let refreshes = 0;
    const plugin = {
        unloaded: false,
        vaultCapabilityIndex: new VaultCapabilityIndex(),
        getVaultFileTags: (file: TFile) => cache.get(file.path) ?? [],
        registerEvent: () => {},
        app: {
            vault: { getMarkdownFiles: () => files },
            metadataCache: {
                on: (event: string, handler: (...args: unknown[]) => void) => events.set(event, handler),
            },
            workspace: { onLayoutReady: (callback: () => void) => layoutCallbacks.push(callback) },
        },
        workspaceViewController: { refreshIndexTagSearchViews: () => { refreshes += 1; } },
    };
    runInNewContext(`(function () { ${code} }).call(plugin)`, {
        plugin, getAllTags: (metadata: { tags: string[] }) => metadata.tags,
    });
    return { plugin, files, cache, events, layoutCallbacks, getRefreshes: () => refreshes };
}

test("startup tag index catches up when cached metadata becomes available at layout ready", () => {
    const { plugin, files, cache, layoutCallbacks, getRefreshes } = createHarness();
    assert.equal(plugin.vaultCapabilityIndex.listMarkdownFilesForTag("灵感").length, 1);
    for (const file of files) cache.set(file.path, ["#灵感"]);
    for (const callback of layoutCallbacks) callback();
    assert.equal(plugin.vaultCapabilityIndex.listMarkdownFilesForTag("灵感").length, 5);
    assert.ok(getRefreshes() > 0);
});

test("metadata resolution updates tag membership without a changed event", () => {
    const { plugin, files, cache, events } = createHarness();
    for (const file of files) {
        cache.set(file.path, ["#灵感"]);
        events.get("resolve")?.(file);
    }
    assert.equal(plugin.vaultCapabilityIndex.listMarkdownFilesForTag("灵感").length, 5);
    cache.set(files[0].path, []);
    events.get("resolve")?.(files[0]);
    assert.equal(plugin.vaultCapabilityIndex.listMarkdownFilesForTag("灵感").length, 4);
});

test("layout callback does not rebuild the index after plugin unload", () => {
    const { plugin, files, cache, layoutCallbacks, getRefreshes } = createHarness();
    plugin.unloaded = true;
    for (const file of files) cache.set(file.path, ["#灵感"]);
    for (const callback of layoutCallbacks) callback();
    assert.equal(plugin.vaultCapabilityIndex.listMarkdownFilesForTag("灵感").length, 1);
    assert.equal(getRefreshes(), 0);
});
