import { decodeHtmlAttributeReferences } from "./htmlAttributeDecoder";
import {
	scanJavascriptDependencies,
	type JavascriptMarkupFragment,
} from "./javascriptDependencyLexer";
import { normalizeVaultRelativePublishPath } from "./publishPath";
import { normalizePublishAllowedRoot } from "./publishSettings";

export type PublishDependencyTextKind = "html" | "css" | "javascript";

export interface ExtractPublishDependencyReferencesInput {
	vaultRelativePath: string;
	contents: string;
}

export interface ExtractPublishDependencyReferencesResult {
	baseHref: string | null;
	references: string[];
}

export type ResolvePublishDependencyReferenceResult =
	| { ok: true; kind: "ignored" }
	| { ok: true; kind: "local"; path: string }
	| { ok: false; notice: string };

export interface ResolvePublishDependencyReferenceInput {
	referrerPath: string;
	reference: string;
	baseHref: string | null;
	allowedRoot: string;
}

interface ReferenceEvent {
	offset: number;
	order: number;
	value: string | undefined;
}

interface HtmlAttribute {
	name: string;
	value: string | undefined;
	valueOffset: number;
}

type HtmlStructuralMode = "html" | "svg";

interface CssValue {
	value: string;
	offset: number;
	end: number;
}

const SYNTHETIC_PUBLISH_ORIGIN = "https://aside-publish.invalid";
const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

const RESOURCE_ATTRIBUTES_BY_TAG = {
	a: ["href"],
	area: ["href"],
	audio: ["src"],
	embed: ["src"],
	iframe: ["src"],
	image: ["href", "xlink:href"],
	img: ["src", "srcset"],
	input: ["src"],
	link: ["href"],
	object: ["data"],
	script: ["src"],
	source: ["src", "srcset"],
	track: ["src"],
	use: ["href", "xlink:href"],
	video: ["src", "poster"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const HTML_CLOSABLE_NON_DATA_ELEMENTS = [
	"script",
	"style",
	"textarea",
	"title",
	"iframe",
	"xmp",
	"noembed",
	"noframes",
	"noscript",
] as const;
type HtmlClosableNonDataElement = typeof HTML_CLOSABLE_NON_DATA_ELEMENTS[number];
const HTML_CLOSABLE_NON_DATA_ELEMENT_SET: ReadonlySet<string> = new Set(
	HTML_CLOSABLE_NON_DATA_ELEMENTS,
);
const HTML_PLAINTEXT_ELEMENT = "plaintext";

function appendUnique(target: string[], seen: Set<string>, value: string | undefined): void {
	const trimmed = value?.trim() ?? "";
	if (!trimmed || seen.has(trimmed)) return;
	seen.add(trimmed);
	target.push(trimmed);
}

function isHtmlClosableNonDataElement(tagName: string): tagName is HtmlClosableNonDataElement {
	return HTML_CLOSABLE_NON_DATA_ELEMENT_SET.has(tagName);
}

function containsAsciiControl(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 31 || codePoint === 127;
	});
}

function appendEvent(
	target: ReferenceEvent[],
	offset: number,
	value: string | undefined,
): void {
	target.push({ offset, order: target.length, value });
}

function referencesFromEvents(events: ReferenceEvent[]): string[] {
	const references: string[] = [];
	const seen = new Set<string>();
	events
		.sort((left, right) => left.offset - right.offset || left.order - right.order)
		.forEach((event) => appendUnique(references, seen, event.value));
	return references;
}

export function getPublishDependencyTextKind(path: string): PublishDependencyTextKind | null {
	if (/\.(?:html?|svg)$/iu.test(path)) return "html";
	if (/\.css$/iu.test(path)) return "css";
	if (/\.(?:js|mjs|cjs)$/iu.test(path)) return "javascript";
	return null;
}

function maskCharacters(characters: string[], start: number, end: number): void {
	for (let index = start; index < end; index += 1) {
		if (characters[index] !== "\r" && characters[index] !== "\n") characters[index] = " ";
	}
}

function skipCssString(contents: string, offset: number): number {
	const quote = contents[offset];
	for (let index = offset + 1; index < contents.length; index += 1) {
		if (contents[index] === "\\") {
			index += contents[index + 1] === "\r" && contents[index + 2] === "\n" ? 2 : 1;
		} else if (contents[index] === quote) {
			return index + 1;
		} else if (contents[index] === "\r"
			|| contents[index] === "\n"
			|| contents[index] === "\f") {
			return index + 1;
		}
	}
	return contents.length;
}

function maskCssComments(contents: string): string {
	const characters = contents.split("");
	for (let index = 0; index < contents.length;) {
		if (contents[index] === "'" || contents[index] === "\"") {
			index = skipCssString(contents, index);
			continue;
		}
		if (contents[index] === "/" && contents[index + 1] === "*") {
			const closingOffset = contents.indexOf("*/", index + 2);
			const end = closingOffset < 0 ? contents.length : closingOffset + 2;
			maskCharacters(characters, index, end);
			index = end;
			continue;
		}
		index += 1;
	}
	return characters.join("");
}

function readCssEscape(contents: string, offset: number): { value: string; end: number } {
	const next = contents[offset + 1];
	if (next === undefined) return { value: "", end: offset + 1 };
	if (next === "\r" && contents[offset + 2] === "\n") return { value: "", end: offset + 3 };
	if (next === "\r" || next === "\n" || next === "\f") return { value: "", end: offset + 2 };
	if (/[0-9a-f]/iu.test(next)) {
		let end = offset + 1;
		while (end < contents.length && end < offset + 7 && /[0-9a-f]/iu.test(contents[end])) end += 1;
		const codePoint = Number.parseInt(contents.slice(offset + 1, end), 16);
		if (/\s/u.test(contents[end] ?? "")) end += 1;
		return {
			value: codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
				? "�"
				: String.fromCodePoint(codePoint),
			end,
		};
	}
	return { value: next, end: offset + 2 };
}

function readCssString(contents: string, offset: number): CssValue | null {
	const quote = contents[offset];
	if (quote !== "'" && quote !== "\"") return null;
	let value = "";
	for (let index = offset + 1; index < contents.length;) {
		const character = contents[index];
		if (character === quote) return { value, offset: offset + 1, end: index + 1 };
		if (character === "\r" || character === "\n" || character === "\f") return null;
		if (character === "\\") {
			const escape = readCssEscape(contents, index);
			value += escape.value;
			index = escape.end;
		} else {
			value += character;
			index += 1;
		}
	}
	return null;
}

function isCssIdentifierCharacter(character: string | undefined): boolean {
	return character !== undefined
		&& (/[a-z0-9_-]/iu.test(character) || (character.codePointAt(0) ?? 0) >= 0x80);
}

function readCssUrl(contents: string, offset: number): CssValue | null {
	if (contents.slice(offset, offset + 3).toLowerCase() !== "url"
		|| isCssIdentifierCharacter(contents[offset - 1])) return null;
	let index = offset + 3;
	if (contents[index] !== "(") return null;
	index += 1;
	while (/\s/u.test(contents[index] ?? "")) index += 1;
	const valueOffset = index;
	if (contents[index] === "'" || contents[index] === "\"") {
		const quoted = readCssString(contents, index);
		if (!quoted) return null;
		index = quoted.end;
		while (/\s/u.test(contents[index] ?? "")) index += 1;
		return contents[index] === ")" ? { ...quoted, end: index + 1 } : null;
	}

	let value = "";
	while (index < contents.length) {
		const character = contents[index];
		if (character === ")") return { value: value.trim(), offset: valueOffset, end: index + 1 };
		if (character === "'" || character === "\"" || character === "(") return null;
		if (/\s/u.test(character)) {
			while (/\s/u.test(contents[index] ?? "")) index += 1;
			return contents[index] === ")"
				? { value: value.trim(), offset: valueOffset, end: index + 1 }
				: null;
		}
		if (character === "\\") {
			const escape = readCssEscape(contents, index);
			value += escape.value;
			index = escape.end;
		} else {
			value += character;
			index += 1;
		}
	}
	return null;
}

function readCssImport(contents: string, offset: number): CssValue | null {
	if (contents.slice(offset, offset + 7).toLowerCase() !== "@import"
		|| isCssIdentifierCharacter(contents[offset + 7])) return null;
	let index = offset + 7;
	while (/\s/u.test(contents[index] ?? "")) index += 1;
	return readCssString(contents, index) ?? readCssUrl(contents, index);
}

function collectCssReferenceEvents(
	contents: string,
	target: ReferenceEvent[],
	baseOffset = 0,
): void {
	const uncommented = maskCssComments(contents);
	for (let index = 0; index < uncommented.length;) {
		if (uncommented[index] === "'" || uncommented[index] === "\"") {
			index = skipCssString(uncommented, index);
			continue;
		}
		const reference = uncommented[index] === "@"
			? readCssImport(uncommented, index)
			: readCssUrl(uncommented, index);
		if (reference) {
			appendEvent(target, baseOffset + reference.offset, reference.value);
			index = reference.end;
		} else {
			index += 1;
		}
	}
}

function collectJavascriptReferenceEvents(
	contents: string,
	target: ReferenceEvent[],
	baseOffset = 0,
): JavascriptMarkupFragment[] {
	const result = scanJavascriptDependencies(contents);
	for (const reference of result.references) {
		appendEvent(target, baseOffset + reference.offset, reference.value);
	}
	return result.markupFragments;
}

function findHtmlTagEnd(contents: string, offset: number): number {
	let quote: "'" | "\"" | null = null;
	for (let index = offset; index < contents.length; index += 1) {
		const character = contents[index];
		if (quote) {
			if (character === quote) quote = null;
		} else if (character === "'" || character === "\"") {
			quote = character;
		} else if (character === ">") {
			return index;
		}
	}
	return -1;
}

function scanHtmlAttributes(contents: string, start: number, end: number): HtmlAttribute[] {
	const attributes: HtmlAttribute[] = [];
	let index = start;
	while (index < end) {
		while (index < end && /\s/u.test(contents[index])) index += 1;
		if (index >= end || contents[index] === "/") {
			index += 1;
			continue;
		}

		const nameStart = index;
		while (index < end && !/[\s=/>]/u.test(contents[index])) index += 1;
		if (index === nameStart) {
			index += 1;
			continue;
		}
		const name = contents.slice(nameStart, index).toLowerCase();
		while (index < end && /\s/u.test(contents[index])) index += 1;

		let value: string | undefined;
		let valueOffset = index;
		if (contents[index] === "=") {
			index += 1;
			while (index < end && /\s/u.test(contents[index])) index += 1;
			const quote = contents[index];
			if (quote === "'" || quote === "\"") {
				valueOffset = index + 1;
				index += 1;
				const valueStart = index;
				while (index < end && contents[index] !== quote) index += 1;
				value = contents.slice(valueStart, index);
				if (contents[index] === quote) index += 1;
			} else {
				valueOffset = index;
				const valueStart = index;
				while (index < end && !/[\s>]/u.test(contents[index])) index += 1;
				value = contents.slice(valueStart, index);
			}
		}
		attributes.push({
			name,
			value: value === undefined ? undefined : decodeHtmlAttributeReferences(value),
			valueOffset,
		});
	}
	return attributes;
}

function splitSrcset(value: string): string[] {
	const references: string[] = [];
	let index = 0;
	while (index < value.length) {
		while (index < value.length && (value[index] === "," || /\s/u.test(value[index]))) index += 1;
		const urlStart = index;
		while (index < value.length && !/\s/u.test(value[index])) index += 1;
		let url = value.slice(urlStart, index);
		const endedWithComma = url.endsWith(",");
		url = url.replace(/,+$/u, "");
		if (url) references.push(url);
		if (!endedWithComma) {
			let parenthesisDepth = 0;
			while (index < value.length) {
				if (value[index] === "(") parenthesisDepth += 1;
				if (value[index] === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
				if (value[index] === "," && parenthesisDepth === 0) {
					index += 1;
					break;
				}
				index += 1;
			}
		}
	}
	return references;
}

function findHtmlNonDataElementClosingTag(
	contents: string,
	tagName: HtmlClosableNonDataElement,
	bodyStart: number,
): { start: number; end: number } {
	const closingTag = new RegExp(`</${tagName}(?=[\\t\\n\\f\\r />])`, "giu");
	closingTag.lastIndex = bodyStart;
	for (let match = closingTag.exec(contents); match; match = closingTag.exec(contents)) {
		const tagEnd = findHtmlTagEnd(contents, match.index + match[0].length);
		if (tagEnd >= 0) return { start: match.index, end: tagEnd + 1 };
	}
	return { start: contents.length, end: contents.length };
}

interface HtmlCollectionOptions {
	baseOffset: number;
	allowBase: boolean;
	collectRawDependencies: boolean;
	mode: HtmlStructuralMode;
	eventAnchor?: number;
}

function isXmlSelfClosingTag(contents: string, tagEnd: number): boolean {
	let index = tagEnd - 1;
	while (index >= 0 && /\s/u.test(contents[index])) index -= 1;
	return contents[index] === "/";
}

function findXmlMarkupDeclarationEnd(contents: string, offset: number): number {
	let quote: "'" | "\"" | null = null;
	let subsetDepth = 0;
	for (let index = offset + 2; index < contents.length; index += 1) {
		const character = contents[index];
		if (quote) {
			if (character === quote) quote = null;
		} else if (contents.startsWith("<!--", index)) {
			const closingOffset = contents.indexOf("-->", index + 4);
			if (closingOffset < 0) return contents.length;
			index = closingOffset + 2;
		} else if (contents.startsWith("<?", index)) {
			const closingOffset = contents.indexOf("?>", index + 2);
			if (closingOffset < 0) return contents.length;
			index = closingOffset + 1;
		} else if (character === "'" || character === "\"") {
			quote = character;
		} else if (character === "[") {
			subsetDepth += 1;
		} else if (character === "]") {
			subsetDepth = Math.max(0, subsetDepth - 1);
		} else if (character === ">" && subsetDepth === 0) {
			return index + 1;
		}
	}
	return contents.length;
}

function skipSvgMarkup(contents: string, offset: number): number | null {
	if (contents.startsWith("<![CDATA[", offset)) {
		const closingOffset = contents.indexOf("]]>", offset + 9);
		return closingOffset < 0 ? contents.length : closingOffset + 3;
	}
	if (contents.startsWith("<?", offset)) {
		const closingOffset = contents.indexOf("?>", offset + 2);
		return closingOffset < 0 ? contents.length : closingOffset + 2;
	}
	return contents.startsWith("<!", offset)
		? findXmlMarkupDeclarationEnd(contents, offset)
		: null;
}

function collectHtmlAttributeReferences(
	tagName: string,
	attributes: HtmlAttribute[],
	target: ReferenceEvent[],
	options: HtmlCollectionOptions,
): void {
	const resourceAttributes = RESOURCE_ATTRIBUTES_BY_TAG[
		tagName as keyof typeof RESOURCE_ATTRIBUTES_BY_TAG
	] as readonly string[] | undefined;
	for (const attribute of attributes) {
		const offset = options.eventAnchor ?? options.baseOffset + attribute.valueOffset;
		if (attribute.name === "style" && attribute.value !== undefined) {
			if (options.eventAnchor === undefined) {
				collectCssReferenceEvents(attribute.value, target, offset);
			} else {
				const styleEvents: ReferenceEvent[] = [];
				collectCssReferenceEvents(attribute.value, styleEvents);
				for (const event of styleEvents) appendEvent(target, offset, event.value);
			}
		}
		if (!resourceAttributes?.includes(attribute.name)) continue;
		if (attribute.name === "srcset") {
			for (const reference of splitSrcset(attribute.value ?? "")) {
				appendEvent(target, offset, reference);
			}
		} else {
			appendEvent(target, offset, attribute.value);
		}
	}
}

function collectHtmlDataReferences(
	contents: string,
	target: ReferenceEvent[],
	options: HtmlCollectionOptions,
): string | null {
	const tagStartPattern = /<([a-z][a-z0-9:-]*)(?=\s|\/?>)/iyu;
	let baseHref: string | null = null;
	let baseHrefSeen = false;
	for (let index = 0; index < contents.length;) {
		if (contents.startsWith("<!--", index)) {
			const closingOffset = contents.indexOf("-->", index + 4);
			index = closingOffset < 0 ? contents.length : closingOffset + 3;
			continue;
		}
		if (options.mode === "svg") {
			const markupEnd = skipSvgMarkup(contents, index);
			if (markupEnd !== null) {
				index = markupEnd;
				continue;
			}
		}
		if (contents[index] !== "<") {
			index += 1;
			continue;
		}
		tagStartPattern.lastIndex = index;
		const tagMatch = tagStartPattern.exec(contents);
		if (!tagMatch) {
			index += 1;
			continue;
		}
		const tagName = tagMatch[1].toLowerCase();
		const attributesStart = index + tagMatch[0].length;
		const tagEnd = findHtmlTagEnd(contents, attributesStart);
		if (tagEnd < 0) break;
		const attributes = scanHtmlAttributes(contents, attributesStart, tagEnd);

		if (options.allowBase && tagName === "base" && !baseHrefSeen) {
			const href = attributes.find((attribute) => attribute.name === "href");
			if (href) {
				baseHref = (href.value ?? "").trim();
				baseHrefSeen = true;
			}
		}
		collectHtmlAttributeReferences(tagName, attributes, target, options);
		if (options.mode === "svg" && isXmlSelfClosingTag(contents, tagEnd)) {
			index = tagEnd + 1;
			continue;
		}

		if (tagName === HTML_PLAINTEXT_ELEMENT) return baseHref;
		if (!isHtmlClosableNonDataElement(tagName)) {
			index = tagEnd + 1;
			continue;
		}

		const bodyStart = tagEnd + 1;
		const closingTag = findHtmlNonDataElementClosingTag(contents, tagName, bodyStart);
		const collectRawBody = tagName === "style"
			|| (tagName === "script" && !attributes.some((attribute) => attribute.name === "src"));
		if (options.collectRawDependencies && collectRawBody) {
			const body = contents.slice(bodyStart, closingTag.start);
			const bodyOffset = options.baseOffset + bodyStart;
			if (tagName === "style") {
				collectCssReferenceEvents(body, target, bodyOffset);
			} else {
				const fragments = collectJavascriptReferenceEvents(body, target, bodyOffset);
				for (const fragment of fragments) {
					collectHtmlDataReferences(fragment.contents, target, {
						baseOffset: bodyOffset + fragment.offset,
						allowBase: false,
						collectRawDependencies: false,
						mode: options.mode,
						eventAnchor: bodyOffset + fragment.offset,
					});
				}
			}
		}
		index = closingTag.end;
	}
	return baseHref;
}

function extractHtmlReferences(
	contents: string,
	mode: HtmlStructuralMode,
): ExtractPublishDependencyReferencesResult {
	const events: ReferenceEvent[] = [];
	const baseHref = collectHtmlDataReferences(contents, events, {
		baseOffset: 0,
		allowBase: true,
		collectRawDependencies: true,
		mode,
	});
	return { baseHref, references: referencesFromEvents(events) };
}

export function extractPublishDependencyReferences(
	input: ExtractPublishDependencyReferencesInput,
): ExtractPublishDependencyReferencesResult {
	const kind = getPublishDependencyTextKind(input.vaultRelativePath);
	if (kind === "html") {
		return extractHtmlReferences(
			input.contents,
			/\.svg$/iu.test(input.vaultRelativePath) ? "svg" : "html",
		);
	}

	const events: ReferenceEvent[] = [];
	if (kind === "css") collectCssReferenceEvents(input.contents, events);
	if (kind === "javascript") collectJavascriptReferenceEvents(input.contents, events);
	return { baseHref: null, references: referencesFromEvents(events) };
}

function isIgnoredReference(reference: string): boolean {
	return !reference
		|| reference.startsWith("#")
		|| reference.startsWith("?")
		|| reference.startsWith("//")
		|| EXPLICIT_SCHEME_PATTERN.test(reference);
}

function resolutionFailure(
	input: ResolvePublishDependencyReferenceInput,
	reason: string,
): ResolvePublishDependencyReferenceResult {
	return {
		ok: false,
		notice: `Cannot resolve local asset reference "${input.reference}" from "${input.referrerPath}": ${reason}.`,
	};
}

export function resolvePublishDependencyReference(
	input: ResolvePublishDependencyReferenceInput,
): ResolvePublishDependencyReferenceResult {
	const reference = input.reference.trim();
	if (containsAsciiControl(reference)) {
		return resolutionFailure(input, "the reference contains an ASCII control character");
	}
	if (isIgnoredReference(reference)) return { ok: true, kind: "ignored" };

	const normalizedReferrer = normalizeVaultRelativePublishPath(input.referrerPath);
	if (!normalizedReferrer.ok) {
		return resolutionFailure(input, "the referrer path is not a valid vault-relative publish path");
	}
	const encodedReferrer = normalizedReferrer.path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");

	let resolved: URL;
	try {
		const documentUrl = new URL(`/${encodedReferrer}`, SYNTHETIC_PUBLISH_ORIGIN);
		const baseUrl = input.baseHref?.trim()
			? new URL(input.baseHref.trim(), documentUrl)
			: documentUrl;
		resolved = new URL(reference, baseUrl);
	} catch {
		return resolutionFailure(input, "invalid local asset URL");
	}

	if (resolved.origin !== SYNTHETIC_PUBLISH_ORIGIN) return { ok: true, kind: "ignored" };

	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(resolved.pathname).replace(/^\/+/, "");
	} catch {
		return resolutionFailure(input, "invalid local asset URL encoding");
	}
	if (containsAsciiControl(decodedPath)) {
		return resolutionFailure(input, "invalid local asset URL encoding");
	}

	const normalizedPath = normalizeVaultRelativePublishPath(decodedPath);
	if (!normalizedPath.ok) {
		return resolutionFailure(input, "the resolved path is not a valid vault-relative publish path");
	}
	const allowedRoot = normalizePublishAllowedRoot(input.allowedRoot);
	if (!normalizedPath.path.startsWith(allowedRoot)) {
		return resolutionFailure(input, "the resolved path is outside configured publish folder");
	}
	return { ok: true, kind: "local", path: normalizedPath.path };
}
