import * as assert from "node:assert/strict";
import test from "node:test";
import { rankOpenFileSuggestions, type SearchableOpenFileSuggestion } from "../src/ui/modals/openFileSuggestSearch";

function createSuggestion(fileName: string, filePath: string): SearchableOpenFileSuggestion {
    return { fileName, filePath };
}

test("rankOpenFileSuggestions prefers filename matches over path-only matches", () => {
    const suggestions = [
        createSuggestion("Unrelated", "docs/query-target.md"),
        createSuggestion("Query Notes", "docs/query-notes.md"),
        createSuggestion("Query", "docs/plain.md"),
        createSuggestion("Alpha Query", "docs/alpha-query.md"),
    ];

    assert.deepEqual(
        rankOpenFileSuggestions(suggestions, "query").map((suggestion) => suggestion.filePath),
        [
            "docs/plain.md",
            "docs/query-notes.md",
            "docs/alpha-query.md",
            "docs/query-target.md",
        ],
    );
});

test("rankOpenFileSuggestions preserves the existing order for empty queries", () => {
    const suggestions = [
        createSuggestion("Beta", "docs/beta.md"),
        createSuggestion("Alpha", "docs/alpha.md"),
    ];

    assert.deepEqual(
        rankOpenFileSuggestions(suggestions, "").map((suggestion) => suggestion.filePath),
        ["docs/beta.md", "docs/alpha.md"],
    );
});
