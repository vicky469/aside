import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README documents the source-free DevTools publish feature flag workflow", async () => {
    const readme = await readFile("README.md", "utf8");

    assert.match(
        readme,
        /localStorage\.setItem\(`aside\.feature\.publish\.\$\{app\.vault\.getName\(\)\}`, "true"\)/u,
    );
    assert.match(
        readme,
        /localStorage\.setItem\(`aside\.feature\.publish\.\$\{app\.vault\.getName\(\)\}`, "false"\)/u,
    );
    assert.match(readme, /app\.plugins\.disablePlugin\("aside"\)/u);
    assert.match(readme, /app\.plugins\.enablePlugin\("aside"\)/u);
    assert.doesNotMatch(readme, /npm run feature:flag/u);
});
