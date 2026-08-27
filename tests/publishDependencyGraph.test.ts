import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildPublishDependencyGraph,
	type BuildPublishDependencyGraphInput,
} from "../src/core/publish/publishDependencyGraph";

interface HarnessOptions {
	text?: Readonly<Record<string, string>>;
	binary?: Readonly<Record<string, ArrayBuffer>>;
	throwExists?: readonly string[];
	throwText?: readonly string[];
	throwBinary?: readonly string[];
}

interface Harness {
	input: Omit<BuildPublishDependencyGraphInput, "entryFiles">;
	existsCalls: string[];
	textReads: Map<string, number>;
	binaryReads: Map<string, number>;
}

function increment(calls: Map<string, number>, path: string): void {
	calls.set(path, (calls.get(path) ?? 0) + 1);
}

function makeHarness(options: HarnessOptions = {}): Harness {
	const text = new Map(Object.entries(options.text ?? {}));
	const binary = new Map(Object.entries(options.binary ?? {}));
	const throwExists = new Set(options.throwExists ?? []);
	const throwText = new Set(options.throwText ?? []);
	const throwBinary = new Set(options.throwBinary ?? []);
	const existsCalls: string[] = [];
	const textReads = new Map<string, number>();
	const binaryReads = new Map<string, number>();

	return {
		existsCalls,
		textReads,
		binaryReads,
		input: {
			allowedRoot: "public/",
			configDir: ".obsidian",
			async fileExists(path) {
				existsCalls.push(path);
				if (throwExists.has(path)) throw new Error("existence failure");
				return text.has(path) || binary.has(path);
			},
			async readTextFile(path) {
				increment(textReads, path);
				if (throwText.has(path)) throw new Error("text read failure");
				const contents = text.get(path);
				if (contents === undefined) throw new Error(`No text fixture for ${path}`);
				return contents;
			},
			async readBinaryFile(path) {
				increment(binaryReads, path);
				if (throwBinary.has(path)) throw new Error("binary read failure");
				const contents = binary.get(path);
				if (contents === undefined) throw new Error(`No binary fixture for ${path}`);
				return contents;
			},
		},
	};
}

function bytes(...values: number[]): ArrayBuffer {
	return Uint8Array.from(values).buffer;
}

function asciiBuffer(value: string): ArrayBuffer {
	return bytes(...Array.from(value, (character) => character.charCodeAt(0)));
}

function entry(vaultRelativePath: string, contents: string) {
	return { vaultRelativePath, contents };
}

function assertNoHostCalls(harness: Harness): void {
	assert.deepEqual(harness.existsCalls, []);
	assert.equal(harness.textReads.size, 0);
	assert.equal(harness.binaryReads.size, 0);
}

test("buildPublishDependencyGraph returns a deterministic breadth-first recursive closure", async () => {
	const logoBytes = bytes(0, 17, 128, 255);
	const harness = makeHarness({
		text: {
			"public/pigeon/pigeon.css": "@import 'theme.css'; body { background: url('assets/bg.png'); }",
			"public/pigeon/theme.css": ".theme { background: url('assets/logo.svg#mark'); }",
			"public/pigeon/app.js": "import './module.js'; new URL('./assets/worker.wasm', import.meta.url);",
			"public/pigeon/module.js": "import './app.js';",
			"public/pigeon/assets/logo.svg": "<svg><image href='logo.png'/></svg>",
		},
		binary: {
			"public/pigeon/assets/bg.png": bytes(1, 2, 3),
			"public/pigeon/assets/worker.wasm": bytes(0, 97, 115, 109),
			"public/pigeon/assets/logo.png": logoBytes,
		},
	});

	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry(
			"public/pigeon/index.html",
			"<link rel='stylesheet' href='pigeon.css'><script src='app.js'></script><img src='assets/logo.svg'>",
		)],
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.files.map((file) => file.vaultRelativePath), [
		"public/pigeon/pigeon.css",
		"public/pigeon/app.js",
		"public/pigeon/assets/logo.svg",
		"public/pigeon/theme.css",
		"public/pigeon/assets/bg.png",
		"public/pigeon/module.js",
		"public/pigeon/assets/worker.wasm",
		"public/pigeon/assets/logo.png",
	]);
	const logo = result.files.find((file) => file.vaultRelativePath === "public/pigeon/assets/logo.png");
	assert.ok(logo?.contents instanceof ArrayBuffer);
	assert.deepEqual(new Uint8Array(logo.contents), new Uint8Array(logoBytes));
	assert.equal(harness.textReads.get("public/pigeon/app.js"), 1);
	assert.equal(harness.textReads.get("public/pigeon/assets/logo.svg"), 1);
});

test("buildPublishDependencyGraph returns the exact missing dependency notice", async () => {
	const harness = makeHarness();
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/pigeon/index.html", "<link href='missing.css'>")],
	});

	assert.deepEqual(result, {
		ok: false,
		notice: "Publish failed: public/pigeon/index.html references missing local asset public/pigeon/missing.css.",
	});
});

test("buildPublishDependencyGraph rejects source-map markers in binary-read manifest data", async () => {
	const cases = [
		["site.webmanifest", `<link rel="manifest" href="site.webmanifest">`],
		["config.json", `<script src="config.json" type="application/json"></script>`],
	] as const;

	for (const [path, html] of cases) {
		const harness = makeHarness({
			binary: {
				[`public/${path}`]: asciiBuffer(`{"sourcesContent":["private source"]}`),
			},
		});
		const result = await buildPublishDependencyGraph({
			...harness.input,
			entryFiles: [entry("public/index.html", html)],
		});

		assert.deepEqual(result, {
			ok: false,
			notice: `Publish failed: source-map references cannot be published. Referenced by public/index.html: ${path}`,
		});
		assert.equal(harness.binaryReads.get(`public/${path}`), 1);
		assert.equal(harness.textReads.size, 0);
	}
});

test("buildPublishDependencyGraph ignores external references without inspecting the vault", async () => {
	const harness = makeHarness();
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/index.html", [
			"<script src='https://cdn.example/app.js'></script>",
			"<img src='//cdn.example/image.png'>",
			"<img src='data:image/png;base64,AA=='>",
			"<a href='blob:https://example.test/id'>blob</a>",
		].join(""))],
	});

	assert.deepEqual(result, { ok: true, files: [] });
	assert.deepEqual(harness.existsCalls, []);
});

test("buildPublishDependencyGraph honors the first remote base without local reads", async () => {
	const harness = makeHarness({
		text: { "public/local/theme.css": "body {}" },
	});
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/index.html", [
			"<base href='https://cdn.example/assets/'>",
			"<base href='./local/'>",
			"<link href='theme.css'>",
		].join(""))],
	});

	assert.deepEqual(result, { ok: true, files: [] });
	assertNoHostCalls(harness);
});

test("buildPublishDependencyGraph reads a dependency shared by two entries once", async () => {
	const harness = makeHarness({ text: { "public/shared.css": "body {}" } });
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [
			entry("public/one.html", "<link href='shared.css'>"),
			entry("public/two.html", "<link href='shared.css'>"),
		],
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.files.map((file) => file.vaultRelativePath), ["public/shared.css"]);
	assert.equal(harness.textReads.get("public/shared.css"), 1);
	assert.deepEqual(harness.existsCalls, ["public/shared.css"]);
});

test("buildPublishDependencyGraph terminates a CSS cycle and reads each file once", async () => {
	const harness = makeHarness({
		text: {
			"public/a.css": "@import 'b.css';",
			"public/b.css": "@import 'a.css';",
		},
	});
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/index.html", "<link href='a.css'>")],
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.files.map((file) => file.vaultRelativePath), ["public/a.css", "public/b.css"]);
	assert.equal(harness.textReads.get("public/a.css"), 1);
	assert.equal(harness.textReads.get("public/b.css"), 1);
});

test("buildPublishDependencyGraph preserves binary bytes and uses the binary reader", async () => {
	const binary = bytes(0, 1, 127, 128, 255);
	const harness = makeHarness({ binary: { "public/image.png": binary } });
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/index.html", "<img src='image.png'>")],
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.files.length, 1);
	assert.ok(result.files[0].contents instanceof ArrayBuffer);
	assert.deepEqual(new Uint8Array(result.files[0].contents), new Uint8Array(binary));
	assert.equal(harness.binaryReads.get("public/image.png"), 1);
	assert.equal(harness.textReads.has("public/image.png"), false);
});

test("buildPublishDependencyGraph fails closed on traversal outside the allowed root without reads", async () => {
	const harness = makeHarness({ text: { "secret.css": "body {}" } });
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/nested/index.html", "<link href='../../secret.css'>")],
	});

	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.match(result.notice, /outside configured publish folder/u);
	assert.ok(result.notice.includes("../../secret.css"));
	assert.deepEqual(harness.existsCalls, []);
	assert.equal(harness.textReads.size, 0);
	assert.equal(harness.binaryReads.size, 0);
});

test("buildPublishDependencyGraph appends reference context to every dependency guard failure", async () => {
	const cases = [
		[".env", "Publish failed: secret-bearing files cannot be published."],
		[".npmrc", "Publish failed: secret-bearing files cannot be published."],
		["private.key", "Publish failed: key and certificate files cannot be published."],
		["certificate.pem", "Publish failed: key and certificate files cannot be published."],
		["app.js.map", "Publish failed: source maps cannot be published."],
		["debug.log", "Publish failed: log files cannot be published."],
		["readme.md", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["readme.mdx", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["readme.markdown", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["readme.mdown", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["app.ts", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["app.mts", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["app.cts", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["app.tsx", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["view.jsx", "Publish failed: raw Markdown, TypeScript, and JSX source files cannot be published."],
		["assets/.obsidian/config", "Publish failed: Obsidian configuration files cannot be published."],
	] as const;

	for (const [reference, notice] of cases) {
		const path = `public/${reference}`;
		const harness = makeHarness({ binary: { [path]: bytes(1) } });
		const result = await buildPublishDependencyGraph({
			...harness.input,
			entryFiles: [entry("public/index.html", `<a href='${reference}'>asset</a>`)],
		});
		assert.deepEqual(result, {
			ok: false,
			notice: `${notice} Referenced by public/index.html: ${reference}`,
		}, reference);
		assertNoHostCalls(harness);
	}

	const markerReference = "marked.js";
	const markerHarness = makeHarness({
		text: { "public/marked.js": "//# sourceMappingURL=marked.js.map" },
	});
	const markerResult = await buildPublishDependencyGraph({
		...markerHarness.input,
		entryFiles: [entry("public/index.html", `<script src='${markerReference}'></script>`)],
	});
	assert.deepEqual(markerResult, {
		ok: false,
		notice: `Publish failed: source-map references cannot be published. Referenced by public/index.html: ${markerReference}`,
	});
	assert.deepEqual(markerHarness.existsCalls, ["public/marked.js"]);
	assert.equal(markerHarness.textReads.get("public/marked.js"), 1);
});

test("buildPublishDependencyGraph reports a thrown existence check exactly", async () => {
	const harness = makeHarness({ throwExists: ["public/app.css"] });
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("public/index.html", "<link href='app.css'>")],
	});

	assert.deepEqual(result, {
		ok: false,
		notice: "Publish failed: unable to inspect local asset public/app.css referenced by public/index.html.",
	});
});

test("buildPublishDependencyGraph reports thrown text and binary reads exactly", async () => {
	const cases = [
		{
			reference: "app.css",
			options: { text: { "public/app.css": "body {}" }, throwText: ["public/app.css"] },
		},
		{
			reference: "image.png",
			options: { binary: { "public/image.png": bytes(1) }, throwBinary: ["public/image.png"] },
		},
	] as const;

	for (const { reference, options } of cases) {
		const harness = makeHarness(options);
		const result = await buildPublishDependencyGraph({
			...harness.input,
			entryFiles: [entry("public/index.html", `<a href='${reference}'>asset</a>`)],
		});
		assert.deepEqual(result, {
			ok: false,
			notice: `Publish failed: unable to read local asset public/${reference} referenced by public/index.html.`,
		}, reference);
	}
});

test("buildPublishDependencyGraph normalizes one benign entry alias before scanning", async () => {
	const harness = makeHarness({ text: { "public/pigeon/app.css": "body {}" } });
	const result = await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry(" public\\pigeon\\.\\index.html ", "<link href='app.css'>")],
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.files.map((file) => file.vaultRelativePath), ["public/pigeon/app.css"]);
});

test("buildPublishDependencyGraph validates normalized entries as publish artifacts before host I/O", async () => {
	const cases = [
		{
			path: "private/index.html",
			contents: "<!doctype html>",
			notice: "Publish failed: artifact path is outside the configured publish folder: public/",
		},
		{
			path: "public/assets/.obsidian/index.html",
			contents: "<!doctype html>",
			notice: "Publish failed: Obsidian configuration files cannot be published.",
		},
		{
			path: "public/site.css",
			contents: "body {}",
			notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
		},
		{
			path: "public/app.js",
			contents: "export {};",
			notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
		},
		{
			path: "public/readme.md",
			contents: "# Draft",
			notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
		},
		{
			path: "public/.env",
			contents: "TOKEN=secret",
			notice: "Publish failed: secret-bearing files cannot be published.",
		},
		{
			path: "public/index.html",
			contents: "<script></script>\n//# sourceMappingURL=index.js.map",
			notice: "Publish failed: source-map references cannot be published.",
		},
	] as const;

	for (const { path, contents, notice } of cases) {
		const harness = makeHarness();
		const result = await buildPublishDependencyGraph({
			...harness.input,
			entryFiles: [entry(path, contents)],
		});
		assert.deepEqual(result, { ok: false, notice }, path);
		assertNoHostCalls(harness);
	}
});

test("buildPublishDependencyGraph rejects invalid and duplicate normalized entry paths deterministically", async () => {
	const harness = makeHarness();
	assert.deepEqual(await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [entry("../public/index.html", "")],
	}), {
		ok: false,
		notice: "Publish failed: invalid entry vault path ../public/index.html.",
	});

	assert.deepEqual(await buildPublishDependencyGraph({
		...harness.input,
		entryFiles: [
			entry("public/pigeon/index.html", "first"),
			entry("public/pigeon/./index.html", "second"),
		],
	}), {
		ok: false,
		notice: "Publish failed: duplicate entry aliases normalize to public/pigeon/index.html.",
	});
});

test("buildPublishDependencyGraph keeps state local to each invocation", async () => {
	let currentContents = "body { color: red; }";
	let reads = 0;
	const baseInput: Omit<BuildPublishDependencyGraphInput, "entryFiles"> = {
		allowedRoot: "public/",
		configDir: ".obsidian",
		async fileExists(path) { return path === "public/app.css"; },
		async readTextFile() { reads += 1; return currentContents; },
		async readBinaryFile() { throw new Error("unexpected binary read"); },
	};
	const entryFiles = [entry("public/index.html", "<link href='app.css'>")];

	const first = await buildPublishDependencyGraph({ ...baseInput, entryFiles });
	currentContents = "body { color: blue; }";
	const second = await buildPublishDependencyGraph({ ...baseInput, entryFiles });

	assert.deepEqual(first, {
		ok: true,
		files: [{ vaultRelativePath: "public/app.css", contents: "body { color: red; }" }],
	});
	assert.deepEqual(second, {
		ok: true,
		files: [{ vaultRelativePath: "public/app.css", contents: "body { color: blue; }" }],
	});
	assert.equal(reads, 2);
});
