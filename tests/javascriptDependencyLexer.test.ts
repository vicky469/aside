import * as assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { scanJavascriptDependencies } from "../src/core/publish/javascriptDependencyLexer";

function references(contents: string): string[] {
	return scanJavascriptDependencies(contents).references.map((reference) => reference.value);
}

test("JavaScript dependency lexer finds only supported static forms", () => {
	assert.deepEqual(references(`
import "./boot.js";
import value from "./value.js";
export { value } from "./exported.js";
const lazy = import("./lazy.js", { with: { type: "json" } });
const icon = new URL("./icon.svg", import.meta.url,);
`), ["./boot.js", "./value.js", "./exported.js", "./lazy.js", "./icon.svg"]);
});

test("JavaScript dependency lexer skips methods, comments, strings, regexes, and Unicode identifiers", () => {
	assert.deepEqual(references(`
loader.import("./method.js");
loader?.import("./optional.js");
this.#import("./private.js");
// import "./comment.js";
const text = 'import "./string.js"';
const pattern = /import(".\\/regex.js")/;
变量import("./bmp.js");
𐐀import("./astral.js");
void import("./real.js");
`), ["./real.js"]);
});

test("JavaScript dependency lexer distinguishes statement regexes from division", () => {
	assert.deepEqual(references(`
if (ready) /import(".\\/if-ghost.js")/.test(text);
function declared() {} /import("function-ghost.js")/.test(text);
const callRatio = calculate() / import("./call.js");
const objectRatio = { value: 4 } / import("./object.js");
break
/import("break-ghost.js")/.test(text);
`), ["./call.js", "./object.js"]);
});

test("JavaScript dependency lexer scans template expressions and markup chunks", () => {
	const result = scanJavascriptDependencies(`
const markup = \`<img src="./image.png">\`;
const lazy = \`loaded: \${import("./chunk.js")}\`;
import(\`./\${name}.js\`);
`);
	assert.deepEqual(result.references.map((reference) => reference.value), ["./chunk.js"]);
	assert.deepEqual(result.markupFragments.map((fragment) => fragment.contents), [
		'<img src="./image.png">',
	]);
});

test("JavaScript dependency lexer cooks strings and recovers before malformed tails", () => {
	assert.deepEqual(references(`
import "./\\u006dodule.js";
import "./folder\\x2fasset.js";
import("./chunk.js",);
new URL("./worker.wasm", import.meta.url,);
import "./bad\\xZZ.js";
`), ["./module.js", "./folder/asset.js", "./chunk.js", "./worker.wasm"]);
});

test("JavaScript dependency lexer stays linear on large division input", () => {
	const contents = "f()/g();".repeat(4_000);
	const startedAt = performance.now();
	assert.deepEqual(references(contents), []);
	assert.ok(performance.now() - startedAt < 2_000);
});
