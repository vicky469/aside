import * as assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
	extractPublishDependencyReferences,
	getPublishDependencyTextKind,
	resolvePublishDependencyReference,
} from "../src/core/publish/publishDependencyReferences";

test("getPublishDependencyTextKind recognizes supported text assets case-insensitively", () => {
	const cases = [
		["page.html", "html"],
		["page.HTM", "html"],
		["icon.SvG", "html"],
		["theme.CSS", "css"],
		["app.js", "javascript"],
		["app.MJS", "javascript"],
		["app.cJs", "javascript"],
		["image.png", null],
	] as const;

	for (const [path, expected] of cases) {
		assert.equal(getPublishDependencyTextKind(path), expected, path);
	}
});

test("extractPublishDependencyReferences preserves ordered HTML references from attributes and inline assets", () => {
	const result = extractPublishDependencyReferences({
		vaultRelativePath: "public/site/index.html",
		contents: `<base href="./app/">
<link rel="stylesheet" href="../site.css?v=2">
<img src="images/logo.svg#mark" srcset="images/logo@2x.png 2x, images/logo@3x.png 3x">
<video poster="images/poster.jpg"></video>
<div style="background-image:url('images/paper.png')"></div>
<style>@import "theme.css"; @font-face { src: url(font.woff2); }</style>
<script>import "./boot.js"; new URL("./worker.wasm", import.meta.url);</script>`,
	});

	assert.deepEqual(result, {
		baseHref: "./app/",
		references: [
			"../site.css?v=2",
			"images/logo.svg#mark",
			"images/logo@2x.png",
			"images/logo@3x.png",
			"images/poster.jpg",
			"images/paper.png",
			"theme.css",
			"font.woff2",
			"./boot.js",
			"./worker.wasm",
		],
	});
});

test("HTML extraction supports the complete resource tag policy and attribute quote forms", () => {
	const result = extractPublishDependencyReferences({
		vaultRelativePath: "public/assets.svg",
		contents: `<A HREF="a.html"></A>
<area href='area.html'>
<audio src=audio.mp3></audio>
<embed src="embed.bin">
<iframe src='frame.html'></iframe>
<image href=image.svg xlink:href="legacy-image.svg" />
<img src='photo.png' srcset="small.png 1x, large.png 2x">
<input src=button.png>
<link href="theme.css">
<object data='movie.bin'></object>
<script src=app.js></script>
<source src="movie.mp4" srcset='movie-2x.mp4 2x, movie-3x.mp4 3x'>
<track src=captions.vtt>
<use href="#shape" xlink:href='sprite.svg#shape'></use>
<video src="clip.mp4" poster=poster.jpg></video>
<div data-src="not-an-asset.png" data-href='also-not-an-asset.html'></div>`,
	});

	assert.equal(result.baseHref, null);
	assert.deepEqual(result.references, [
		"a.html",
		"area.html",
		"audio.mp3",
		"embed.bin",
		"frame.html",
		"image.svg",
		"legacy-image.svg",
		"photo.png",
		"small.png",
		"large.png",
		"button.png",
		"theme.css",
		"movie.bin",
		"app.js",
		"movie.mp4",
		"movie-2x.mp4",
		"movie-3x.mp4",
		"captions.vtt",
		"#shape",
		"sprite.svg#shape",
		"clip.mp4",
		"poster.jpg",
	]);
});

test("HTML extraction preserves the first base href even when it is remote", () => {
	const result = extractPublishDependencyReferences({
		vaultRelativePath: "public/index.html",
		contents: `<!-- <img src="commented.png"> -->
<base href="https://cdn.example.com/">
<base href='./local/'>
<base href="./ignored/">
<div style="background:url(shared.png)"></div>
<style>/* url(commented.css) */ .hero { background: url("shared.png") }</style>
<script>
  const template = \`<img src="template.png">\`;
  // import "commented.js";
  import("shared.png");
</script>`,
	});

	assert.deepEqual(result, {
		baseHref: "https://cdn.example.com/",
		references: ["shared.png", "template.png"],
	});
	assert.deepEqual(resolvePublishDependencyReference({
		referrerPath: "public/index.html",
		reference: result.references[0],
		baseHref: result.baseHref,
		allowedRoot: "public/",
	}), { ok: true, kind: "ignored" });
});

test("HTML extraction treats an empty first base href as the document base and ignores later bases", () => {
	const result = extractPublishDependencyReferences({
		vaultRelativePath: "public/site/index.html",
		contents: `<base href><base href="./ignored/"><img src="logo.svg">`,
	});

	assert.deepEqual(result, {
		baseHref: "",
		references: ["logo.svg"],
	});
	assert.deepEqual(resolvePublishDependencyReference({
		referrerPath: "public/site/index.html",
		reference: result.references[0],
		baseHref: result.baseHref,
		allowedRoot: "public/",
	}), { ok: true, kind: "local", path: "public/site/logo.svg" });
});

test("HTML extraction ignores inline script contents when the start tag has src", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/index.html",
		contents: `<script src="./external.js">
import "./ignored.js";
new URL("./ignored.wasm", import.meta.url);
const fragment = '<img src="ignored.png">';
</script>
<script>import "./inline.js";</script>`,
	}), {
		baseHref: null,
		references: ["./external.js", "./inline.js"],
	});
});

test("HTML extraction decodes character references in resource, base, and style attributes", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/entities.html",
		contents: `<base href="./app&amp;dark/">
<img src="logo&amp;dark.svg">
<div style="background:url(&quot;paper.png&quot;)"></div>
<video poster="poster&#46;jpg"></video>`,
	}), {
		baseHref: "./app&dark/",
		references: ["logo&dark.svg", "paper.png", "poster.jpg"],
	});
});

test("HTML extraction decodes standards-aware named attribute entities", () => {
	const extracted = extractPublishDependencyReferences({
		vaultRelativePath: "public/entities.html",
		contents: `<img src="assets&sol;logo.svg">
<img src="https&colon;//cdn.example/x.png">`,
	});
	assert.deepEqual(extracted.references, ["assets/logo.svg", "https://cdn.example/x.png"]);
	assert.deepEqual(resolvePublishDependencyReference({
		referrerPath: "public/entities.html",
		reference: extracted.references[1],
		baseHref: null,
		allowedRoot: "public/",
	}), { ok: true, kind: "ignored" });
});

test("HTML extraction recognizes comments only in data state", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/comment-states.html",
		contents: `<div title="<!--"><img src="./attribute.png">
<script>const marker = "<!--"; import "./script.js";</script>
<script>const cssText = "<style>/*"; import "./after-string.js";</script>`,
	}).references, ["./attribute.png", "./script.js", "./after-string.js"]);
});

test("HTML extraction structurally skips regex, CSS, textarea, and title tag text", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/raw-bodies.html",
		contents: `<script>const r = /<img src="regex-ghost.png">/; import "./real.js";</script>
<style>.label { content: "<img src='css-ghost.png'>"; }</style>
<textarea><img src="textarea-ghost.png"></textarea>
<title><img src="title-ghost.png"></title>
<img src="real.png">`,
	}), {
		baseHref: null,
		references: ["./real.js", "real.png"],
	});
});

test("HTML extraction skips complete raw-text element bodies while retaining element resources", () => {
	const cases = [
		["iframe", `<iframe src="./frame.html"><img src="ghost.png"></iframe><img src="real.png">`, ["./frame.html", "real.png"]],
		["xmp", `<xmp><img src="ghost.png"></xmp><img src="real.png">`, ["real.png"]],
		["noembed", `<noembed><img src="ghost.png"></noembed><img src="real.png">`, ["real.png"]],
		["noframes", `<noframes><img src="ghost.png"></noframes><img src="real.png">`, ["real.png"]],
		["noscript", `<noscript><img src="ghost.png"></noscript><img src="real.png">`, ["real.png"]],
		["plaintext", `<plaintext><img src="ghost.png"><img src="real.png">`, []],
	] as const;

	for (const [element, contents, references] of cases) {
		assert.deepEqual(extractPublishDependencyReferences({
			vaultRelativePath: `public/${element}.html`,
			contents,
		}).references, references, element);
	}
});

test("HTML extraction discovers markup fragments in JS strings without accepting their base tags", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/fragments.html",
		contents: `<script>
const base = "<base href='./wrong/'>";
const quoted = "<img src='./quoted.png'>";
const templated = \`<source src="./templated.mp4">\`;
import "./real.js";
</script>`,
	}), {
		baseHref: null,
		references: ["./quoted.png", "./templated.mp4", "./real.js"],
	});
});

test("HTML extraction retains AST discovery for valid classic-only scripts", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/classic-script.html",
		contents: `<script>with (settings) {
	const quoted = "<img src='./classic.png'>";
	const templated = \`<source src="./classic.mp4">\`;
	import("./classic.js");
}</script>`,
	}), {
		baseHref: null,
		references: ["./classic.png", "./classic.mp4", "./classic.js"],
	});
});

test("HTML extraction recognizes raw closing tags with browser-tolerated syntax", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/raw-closing-tags.html",
		contents: `<script>import "./real.js";</script data-extra>
<img src="./after-script.png">
<style>@import "./real.css";</style/>
<img src="./after-style.png">`,
	}).references, ["./real.js", "./after-script.png", "./real.css", "./after-style.png"]);
});

test("HTML extraction masks tag-shaped strings inside raw script comments", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/comments.html",
		contents: `<script>// <img src="line-ghost.png">
/* <source src="block-ghost.mp4"> */
const loaded = \`\${/* <img src="expression-ghost.png"> */ import("./chunk.js")}\`;
import "./real.js";</script>`,
	}), {
		baseHref: null,
		references: ["./chunk.js", "./real.js"],
	});
});

test("HTML extraction preserves UTF-16 first-appearance order across mixed references", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/order.html",
		contents: `<!-- 😀 <img src="html-ghost.png"> -->
<img src="./first.png">
<script>/* 😀 <source src="script-ghost.mp4"> */
import "./second.js";
const markup = \`<img src="./third.png">\`;</script>
<style>/* 😀 <video poster="style-ghost.jpg"> */ @import "./fourth.css";</style>`,
	}), {
		baseHref: null,
		references: ["./first.png", "./second.js", "./third.png", "./fourth.css"],
	});
});

test("HTML extraction masks an unterminated comment through EOF", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/unterminated.html",
		contents: `<!-- 😀 <img src="ghost.png">`,
	}), { baseHref: null, references: [] });
});

test("standalone SVG extraction honors XML self-closing and markup boundaries", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/artwork.svg",
		contents: `<?aside preview="<image href='pi-ghost.png'/>>"?>
<!DOCTYPE svg [
	<!ENTITY ghost "<image href='declaration-ghost.png'/>">
]>
<svg>
	<text><![CDATA[<image href="cdata-ghost.png"/>]]></text>
	<style/>
	<image href="after-style.png"/>
	<script/>
	<use href="after-script.svg#icon"/>
	<style><![CDATA[
		@import "theme.css";
		.paper { background: url(paper.png); }
	]]></style>
	<image href="real.png"/>
	<use xlink:href="sprite.svg#icon"/>
</svg>`,
	}), {
		baseHref: null,
		references: [
			"after-style.png",
			"after-script.svg#icon",
			"theme.css",
			"paper.png",
			"real.png",
			"sprite.svg#icon",
		],
	});
});

test("standalone SVG DTD scanning ignores comments and processing instructions", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/internal-subset.svg",
		contents: `<!DOCTYPE svg [
	<!-- ]><image href="comment-ghost.png"/> -->
	<?aside data="]><image href='pi-ghost.png'/>"?>
]>
<svg><image href="real.png"/></svg>`,
	}).references, ["real.png"]);
});

test("HTML extraction does not apply XML self-closing semantics to raw elements", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/not-xml.html",
		contents: `<style/><img src="html-raw-text.png">`,
	}), { baseHref: null, references: [] });
});

test("CSS extraction ignores comments, supports imports and URLs, and deduplicates exact values", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/site.css",
		contents: `/* url(ignored.png) */
@import "theme.css";
.one { background: url(logo.svg) }
.two { background: url("logo.svg") }`,
	}), {
		baseHref: null,
		references: ["theme.css", "logo.svg"],
	});
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/print.css",
		contents: "@import url('print-base.css') print;",
	}).references, ["print-base.css"]);
});

test("CSS extraction skips strings, cooks escapes, and masks unterminated comments", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/lexical.css",
		contents: `.x { content: "url(ghost.png)"; background: url(logo\\ 2.png) }
@import "theme\\2e css";
@import url("print.css");
.y { mask: url('mask.svg'); background: url(logo\\ 2.png) }
/* url(commented.png) */
/* url(unterminated.png)`,
	}), {
		baseHref: null,
		references: ["logo 2.png", "theme.css", "print.css", "mask.svg"],
	});
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/unterminated.css",
		contents: "/* url(ghost.png)",
	}), { baseHref: null, references: [] });
});

test("CSS extraction recovers after invalid string line breaks and preserves continuations", () => {
	for (const [name, contents] of [
		["line feed", `.bad { content: "oops
} .good { background: url(real.png) }`],
		["form feed", `.bad { content: "oops\f} .good { background: url(real.png) }`],
		["escaped CRLF", `.bad { content: "continued\\\r
url(ghost.png)" } .good { background: url(real.png) }`],
	] as const) {
		assert.deepEqual(extractPublishDependencyReferences({
			vaultRelativePath: "public/invalid-strings.css",
			contents,
		}).references, ["real.png"], name);
	}
});

test("CSS extraction requires CSS name and function-token boundaries", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/boundaries.css",
		contents: `.one { background: πurl(ghost.png) }
.two { background: url (spaced-ghost.png) }
.three { background: url(real.png) }`,
	}).references, ["real.png"]);
});

test("JavaScript extraction finds only supported static literal forms in source order", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/app.mjs",
		contents: `// import "ignored.js";
import "./boot.js";
import value from './value.js';
export { value } from "./value.js";
const lazy = import("./lazy.js");
const icon = new URL('./icon.svg', import.meta.url);
const variable = "./variable.js";
import(variable);
import(\`./template.js\`);
fetch("./fetch.json");
new Worker("./worker.js");
const text = "import './string.js'";
/* export * from "./commented.js"; */`,
	}), {
		baseHref: null,
		references: ["./boot.js", "./value.js", "./lazy.js", "./icon.svg"],
	});
});

test("JavaScript extraction rejects import method calls while preserving dynamic import syntax", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/loader.js",
		contents: `loader.import("./method.js");
loader. import("./spaced-method.js");
loader?.import("./optional-method.js");
fn(...import("./spread.js"));
import("./lazy.js");`,
	}), {
		baseHref: null,
		references: ["./spread.js", "./lazy.js"],
	});
});

test("JavaScript extraction does not mistake regex character classes for comments", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/regex.js",
		contents: `const re = /[/*]/;
const pattern = /import("regex-ghost.js")/;
function matcher() { return /[/*]/; }
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction recognizes regex statement bodies after control conditions", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/control-regex.js",
		contents: `if (ready) /import(".\\/ghost.js")/.test(text);
for await (const item of items) /import("for-await-ghost.js")/.test(text);
if (ready) {} /import("block-ghost.js")/.test(text);
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction ignores import-shaped regexes in general statement contexts", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/statement-regex.js",
		contents: `function declared() {} /import("function-ghost.js")/.test(text);
class Declared {} /import("class-ghost.js")/.test(text);
{} /import("block-ghost.js")/.test(text);
try {} finally {} /import("finally-ghost.js")/.test(text);
while (ready) { continue
/import("continue-ghost.js")/.test(text); }
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction uses parser semantics for ASI regex statements", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/asi-regex.js",
		contents: `while (ready) { break
/import("break-ghost.js")/.test(text); }
outer: while (ready) { continue outer
/import("continue-ghost.js")/.test(text); }
debugger
/import("debugger-ghost.js")/.test(text);
const characterClass = /[/*]/;
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript token recovery skips ASI regex statements before malformed tails", () => {
	const cases = [
		["break", `while (ready) { break
/import("break-ghost.js")/.test(text); }`],
		["debugger comment", `debugger /* line
break */ /import("debugger-ghost.js")/.test(text);`],
		["labeled break", `outer: while (ready) { break outer // line
/import("labeled-break-ghost.js")/.test(text); }`],
		["labeled continue", `outer: while (ready) { continue outer /* line
break */ /import("continue-ghost.js")/.test(text); }`],
		["return comment", `function load() { return // line
/import("return-ghost.js")/.test(text); }`],
	] as const;

	for (const [name, statement] of cases) {
		assert.deepEqual(extractPublishDependencyReferences({
			vaultRelativePath: "public/recovery-asi.js",
			contents: `${statement}
import "./real.js";
@`,
		}).references, ["./real.js"], name);
	}
});

test("JavaScript malformed-tail recovery preserves imports after escaped-class regexes", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/recovery-regex-class.js",
		contents: `break
/[\\/]x/.test(s); import "./real.js"; @`,
	}).references, ["./real.js"]);
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/recovery-valid-prefix.js",
		contents: `while (ready) { break
/[\\/]x/.test(s); } import "./real.js"; @`,
	}).references, ["./real.js"]);
});

test("JavaScript token recovery requires labels to stay on the restricted line", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/recovery-label-boundary.js",
		contents: `break
ratio
/ import("./real.js") / divisor; @`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction does not classify ordinary call-result division as regex", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/division.js",
		contents: `const ratio = calculate() / import("./division.js");
const memberRatio = handlers.if(ready) / import("./member-division.js");
const objectRatio = { value: 4 } / import("./object-division.js");`,
	}).references, ["./division.js", "./member-division.js", "./object-division.js"]);
});

test("JavaScript extraction keeps division after returned identifiers", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/return-division.js",
		contents: `function load() {
			return value
			/ import("./asset.js") / divisor;
		}`,
	}).references, ["./asset.js"]);
});

test("JavaScript extraction cooks surrogate escape pairs", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/surrogate-escape.js",
		contents: `import("./\\uD83D\\uDE80.js");`,
	}).references, ["./🚀.js"]);
});

test("JavaScript extraction ignores property access named new", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/property-new.js",
		contents: `registry.new
		URL("./phantom.js", import.meta.url);`,
	}).references, []);
});

test("JavaScript extraction ignores prototype-named identifiers during delimiter indexing", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/prototype-names.js",
		contents: `Object.prototype.hasOwnProperty.call(record, "key");
record.constructor;
record.toString();
record.__proto__;
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction scans template expressions and accepts literal imports with options", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/templates.js",
		contents: `const chunk = \`loaded: \${import("./chunk.js")}\`;
import(\`./\${name}.js\`);
import("./data.json", { with: { type: "json" } });`,
	}).references, ["./chunk.js", "./data.json"]);
});

test("JavaScript extraction handles regex tokens nested in import options and template expressions", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/nested.js",
		contents: `import("./data.json", { pattern: /\\(/ });
const nested = \`\${/}/.test(x) ? import("./chunk.js") : 0}\`;`,
	}).references, ["./data.json", "./chunk.js"]);
});

test("JavaScript extraction rejects constructed string arguments while accepting import options", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/constructed-imports.js",
		contents: `import("./ghost.js" + suffix);
import("./template-ghost.js" + \`-\${suffix}\`);
import("./data.json", { with: { type: "json" } });`,
	}).references, ["./data.json"]);
});

test("JavaScript extraction accepts legal trailing commas in static URL forms", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/trailing-commas.js",
		contents: `import("./chunk.js",);
new URL("./worker.wasm", import.meta.url,);`,
	}).references, ["./chunk.js", "./worker.wasm"]);
});

test("JavaScript recovery retains earlier trailing-comma references after malformed code", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/trailing-comma-recovery.js",
		contents: `import("./chunk.js",);
new URL("./worker.wasm", import.meta.url,);
import "./bad\\xZZ.js";`,
	}).references, ["./chunk.js", "./worker.wasm"]);
});

test("JavaScript recovery rejects dynamic imports with more than one options argument", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/malformed-import-options.js",
		contents: `import("./ghost.js", { with: {} }, extra);
import "./real.js";`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction ignores property, optional, and private import methods", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/methods.js",
		contents: `loader.import("./property.js");
loader?.import("./optional.js");
this.#import("./private.js");
import("./real.js");`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction respects BMP and astral Unicode identifier boundaries", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/unicode.js",
		contents: `变量import("./bmp-ghost.js");
𐐀import("./astral-ghost.js");
void import("./real.js");`,
	}).references, ["./real.js"]);
});

test("JavaScript extraction continues past imported bindings named from", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/from.js",
		contents: `import { from as source } from "./real.js";
export { source } from "./exported.js";`,
	}).references, ["./real.js", "./exported.js"]);
});

test("JavaScript extraction cooks valid string escapes and rejects malformed literals", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/escapes.js",
		contents: `import "./\\u006dodule.js";
import "./folder\\x2fasset.js";
import "./joined\\
path.js";
import "./bad\\xZZ.js";`,
	}).references, ["./module.js", "./folder/asset.js", "./joinedpath.js"]);
});

test("JavaScript extraction processes a 32KB division fixture linearly", () => {
	const contents = "f()/g();".repeat(4_000);
	const startedAt = performance.now();
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/performance.js",
		contents,
	}).references, []);
	assert.ok(performance.now() - startedAt < 2_000);
});

test("JavaScript recovery bounds malformed-prefix parsing work", () => {
	const contents = `{${"x;".repeat(4_000)}`;
	const startedAt = performance.now();
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/malformed-performance.js",
		contents,
	}).references, []);
	assert.ok(performance.now() - startedAt < 2_000);
});

test("JavaScript extraction handles deeply chained valid syntax without recursive overflow", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/deep-chain.js",
		contents: `const value = root${".child".repeat(12_000)}; import "./real.js";`,
	}).references, ["./real.js"]);
});

test("unsupported asset extraction returns no base or references", () => {
	assert.deepEqual(extractPublishDependencyReferences({
		vaultRelativePath: "public/image.png",
		contents: "url(hidden.png)",
	}), { baseHref: null, references: [] });
});

test("resolvePublishDependencyReference resolves local URL forms", () => {
	const cases = [
		["pigeon.css?v=7#top", null, "public/site/pigeon.css"],
		["assets/pigeon%20logo.svg", null, "public/site/assets/pigeon logo.svg"],
		["../shared.css", "./app/", "public/site/shared.css"],
		["/public/global.css", null, "public/global.css"],
		["./nested/../clean.css?x=1#part", null, "public/site/clean.css"],
	] as const;

	for (const [reference, baseHref, path] of cases) {
		assert.deepEqual(resolvePublishDependencyReference({
			referrerPath: "public/site/index.html",
			reference,
			baseHref,
			allowedRoot: "public/",
		}), { ok: true, kind: "local", path }, reference);
	}
});

test("resolvePublishDependencyReference ignores non-local references without network access", () => {
	for (const reference of [
		"https://cdn.example.com/app.css",
		"//cdn.example.com/app.css",
		"data:image/svg+xml;base64,AA==",
		"blob:https://example.com/id",
		"mailto:hello@example.com",
		"tel:+123456",
		"#workspaces",
		"?preview=true",
		"   ",
	]) {
		assert.deepEqual(resolvePublishDependencyReference({
			referrerPath: "public/site/index.html",
			reference,
			baseHref: null,
			allowedRoot: "public/",
		}), { ok: true, kind: "ignored" }, reference);
	}

	assert.deepEqual(resolvePublishDependencyReference({
		referrerPath: "public/site/index.html",
		reference: "relative.css",
		baseHref: "https://cdn.example.com/assets/",
		allowedRoot: "public/",
	}), { ok: true, kind: "ignored" });
});

test("resolvePublishDependencyReference reports invalid, traversal, and outside-root local references with context", () => {
	const cases = [
		["../../secret.css", /outside configured publish folder/iu],
		["/private/outside.css", /outside configured publish folder/iu],
		["bad%ZZ.css", /invalid local asset URL/iu],
		["bad\nname.css", /ASCII control/iu],
		["../../../above-root.css", /outside configured publish folder/iu],
	] as const;

	for (const [reference, messagePattern] of cases) {
		const result = resolvePublishDependencyReference({
			referrerPath: "public/site/index.html",
			reference,
			baseHref: null,
			allowedRoot: "public/",
		});
		assert.equal(result.ok, false, reference);
		if (result.ok) continue;
		assert.match(result.notice, messagePattern, reference);
		assert.match(result.notice, /public\/site\/index\.html/u, reference);
		assert.ok(result.notice.includes(reference), reference);
	}
});

test("resolvePublishDependencyReference reports invalid referrers and base URLs with both inputs", () => {
	for (const input of [
		{
			referrerPath: "../index.html",
			reference: "asset.css",
			baseHref: null,
		},
		{
			referrerPath: "public/index.html",
			reference: "asset.css",
			baseHref: "http://[invalid",
		},
	]) {
		const result = resolvePublishDependencyReference({
			...input,
			allowedRoot: "public/",
		});
		assert.equal(result.ok, false);
		if (result.ok) continue;
		assert.ok(result.notice.includes(input.referrerPath));
		assert.ok(result.notice.includes(input.reference));
	}
});
