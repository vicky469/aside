import {
	parse,
	tokenizer,
	tokTypes,
	type Comment,
	type Token,
} from "acorn";
import { decodeHTMLAttribute } from "entities";
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

type JavascriptToken = Token & { value?: unknown };

interface JavascriptTokenizationResult {
	tokens: JavascriptToken[];
	comments: Comment[];
}

interface JavascriptAstNode {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
}

interface JavascriptMarkupFragment {
	contents: string;
	offset: number;
}

const SYNTHETIC_PUBLISH_ORIGIN = "https://aside-publish.invalid";
const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const MAX_JAVASCRIPT_PREFIX_PARSE_ATTEMPTS = 8;

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

interface JavascriptParseAttempt {
	ast: JavascriptAstNode | null;
	errorOffset: number;
}

function parseJavascriptSource(contents: string): JavascriptParseAttempt {
	let errorOffset = 0;
	for (const sourceType of ["module", "script"] as const) {
		try {
			const ast = parse(contents, {
				ecmaVersion: "latest",
				sourceType,
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
				allowImportExportEverywhere: true,
				checkPrivateFields: false,
			}) as unknown as JavascriptAstNode;
			return { ast, errorOffset: contents.length };
		} catch (error) {
			const position = (error as { pos?: unknown }).pos;
			if (typeof position === "number") errorOffset = Math.max(errorOffset, position);
			// Try classic script parsing before falling back to incremental token recovery.
		}
	}
	return { ast: null, errorOffset };
}

function parseJavascript(contents: string): JavascriptAstNode | null {
	const fullAttempt = parseJavascriptSource(contents);
	if (fullAttempt.ast) return fullAttempt.ast;
	const prefixEnds = tokenizeJavascript(contents).tokens
		.filter((token) => token.type === tokTypes.semi && token.end <= fullAttempt.errorOffset)
		.map((token) => token.end);
	const firstPrefixIndex = Math.max(0, prefixEnds.length - MAX_JAVASCRIPT_PREFIX_PARSE_ATTEMPTS);
	for (let index = prefixEnds.length - 1; index >= firstPrefixIndex; index -= 1) {
		const prefixAttempt = parseJavascriptSource(contents.slice(0, prefixEnds[index]));
		if (prefixAttempt.ast) return prefixAttempt.ast;
	}
	return null;
}

function walkJavascriptAst(
	node: JavascriptAstNode,
	visit: (candidate: JavascriptAstNode) => void,
): void {
	const stack = [node];
	while (stack.length > 0) {
		const candidate = stack.pop();
		if (!candidate) continue;
		visit(candidate);
		const children: JavascriptAstNode[] = [];
		for (const value of Object.values(candidate)) {
			if (Array.isArray(value)) {
				for (const child of value) {
					if (isJavascriptAstNode(child)) children.push(child);
				}
			} else if (isJavascriptAstNode(value)) {
				children.push(value);
			}
		}
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
	}
}

function isJavascriptAstNode(value: unknown): value is JavascriptAstNode {
	return typeof value === "object"
		&& value !== null
		&& typeof (value as { type?: unknown }).type === "string";
}

function isJavascriptIdentifier(node: unknown, name: string): boolean {
	return isJavascriptAstNode(node) && node.type === "Identifier" && node.name === name;
}

function javascriptAstStringLiteral(node: unknown): JavascriptAstNode | null {
	return isJavascriptAstNode(node)
		&& node.type === "Literal"
		&& typeof node.value === "string"
		? node
		: null;
}

function isImportMetaUrl(node: unknown): boolean {
	if (!isJavascriptAstNode(node)
		|| node.type !== "MemberExpression"
		|| node.computed === true
		|| !isJavascriptIdentifier(node.property, "url")) return false;
	const object = node.object;
	return isJavascriptAstNode(object)
		&& object.type === "MetaProperty"
		&& isJavascriptIdentifier(object.meta, "import")
		&& isJavascriptIdentifier(object.property, "meta");
}

function collectJavascriptAstReferenceEvents(
	ast: JavascriptAstNode,
	target: ReferenceEvent[],
	baseOffset: number,
): void {
	walkJavascriptAst(ast, (node) => {
		let literal: JavascriptAstNode | null = null;
		if (node.type === "ImportDeclaration"
			|| node.type === "ExportNamedDeclaration"
			|| node.type === "ExportAllDeclaration") {
			literal = javascriptAstStringLiteral(node.source);
		} else if (node.type === "ImportExpression") {
			literal = javascriptAstStringLiteral(node.source);
		} else if (node.type === "NewExpression"
			&& isJavascriptIdentifier(node.callee, "URL")
			&& Array.isArray(node.arguments)
			&& node.arguments.length === 2
			&& isImportMetaUrl(node.arguments[1])) {
			literal = javascriptAstStringLiteral(node.arguments[0]);
		}
		if (literal) appendEvent(target, baseOffset + literal.start, literal.value as string);
	});
}

function collectJavascriptMarkupFragments(ast: JavascriptAstNode): JavascriptMarkupFragment[] {
	const fragments: JavascriptMarkupFragment[] = [];
	walkJavascriptAst(ast, (node) => {
		let contents: string | undefined;
		if (node.type === "Literal" && typeof node.value === "string") {
			contents = node.value;
		} else if (node.type === "TemplateElement"
			&& typeof node.value === "object"
			&& node.value !== null) {
			const templateValue = node.value as { cooked?: unknown; raw?: unknown };
			contents = typeof templateValue.cooked === "string"
				? templateValue.cooked
				: typeof templateValue.raw === "string"
					? templateValue.raw
					: undefined;
		}
		if (contents?.includes("<")) fragments.push({ contents, offset: node.start });
	});
	return fragments.sort((left, right) => left.offset - right.offset);
}

function scanFallbackJavascriptRegexEnd(contents: string, openingOffset: number): number | null {
	let inCharacterClass = false;
	for (let offset = openingOffset + 1; offset < contents.length; offset += 1) {
		const character = contents[offset];
		if (character === "\r"
			|| character === "\n"
			|| character === "\u2028"
			|| character === "\u2029") return null;
		if (character === "\\") {
			offset += 1;
			continue;
		}
		if (character === "[" && !inCharacterClass) {
			inCharacterClass = true;
			continue;
		}
		if (character === "]" && inCharacterClass) {
			inCharacterClass = false;
			continue;
		}
		if (character === "/" && !inCharacterClass) {
			let end = offset + 1;
			while (/[a-z]/iu.test(contents[end] ?? "")) end += 1;
			return end;
		}
	}
	return null;
}

function findFallbackJavascriptRegexRestart(
	contents: string,
	tokens: JavascriptToken[],
): { openingIndex: number; end: number } | null {
	const { openingByClosing } = indexJavascriptParentheses(tokens);
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		if (tokens[index].type !== tokTypes.slash
			|| !isFallbackJavascriptRegexStart(
				tokens,
				index,
				contents,
				openingByClosing.get(index - 1),
			)) continue;
		const end = scanFallbackJavascriptRegexEnd(contents, tokens[index].start);
		if (end !== null) return { openingIndex: index, end };
	}
	return null;
}

function tokenizeJavascript(contents: string): JavascriptTokenizationResult {
	const comments: Comment[] = [];
	const tokens: JavascriptToken[] = [];
	let sourceOffset = 0;
	while (sourceOffset < contents.length || tokens.length === 0) {
		const tokenStream = tokenizer(contents.slice(sourceOffset), {
			ecmaVersion: "latest",
			sourceType: "module",
			checkPrivateFields: false,
			onComment: (isBlock, value, start, end) => comments.push({
				type: isBlock ? "Block" : "Line",
				value,
				start: sourceOffset + start,
				end: sourceOffset + end,
			}),
		});
		let shouldRestart = false;
		while (true) {
			try {
				const localToken = tokenStream.getToken() as JavascriptToken;
				const token = {
					...localToken,
					start: sourceOffset + localToken.start,
					end: sourceOffset + localToken.end,
				};
				tokens.push(token);
				if (token.type === tokTypes.eof) return { tokens, comments };
			} catch {
				const regexRestart = findFallbackJavascriptRegexRestart(contents, tokens);
				if (regexRestart && regexRestart.end > sourceOffset) {
					const start = tokens[regexRestart.openingIndex].start;
					tokens.length = regexRestart.openingIndex;
					tokens.push({
						type: tokTypes.regexp,
						value: undefined,
						start,
						end: regexRestart.end,
					} as JavascriptToken);
					sourceOffset = regexRestart.end;
					shouldRestart = true;
					break;
				}
				const restartOffset = findKeywordPropertyDivisionRestart(contents, tokens);
				if (restartOffset === null || restartOffset <= sourceOffset) return { tokens, comments };
				sourceOffset = restartOffset;
				shouldRestart = true;
				break;
			}
		}
		if (!shouldRestart) break;
	}
	return { tokens, comments };
}

function findKeywordPropertyDivisionRestart(contents: string, tokens: JavascriptToken[]): number | null {
	const closingIndex = tokens.length - 1;
	if (tokens[closingIndex]?.type !== tokTypes.parenR) return null;
	let depth = 0;
	let openingIndex = -1;
	for (let index = closingIndex; index >= 0; index -= 1) {
		if (tokens[index].type === tokTypes.parenR) depth += 1;
		if (tokens[index].type === tokTypes.parenL) {
			depth -= 1;
			if (depth === 0) {
				openingIndex = index;
				break;
			}
		}
	}
	if (openingIndex < 2
		|| tokens[openingIndex - 1].type.keyword === undefined
		|| (tokens[openingIndex - 2].type !== tokTypes.dot
			&& tokens[openingIndex - 2].type !== tokTypes.questionDot)) return null;
	let slashOffset = tokens[closingIndex].end;
	while (/\s/u.test(contents[slashOffset] ?? "")) slashOffset += 1;
	return contents[slashOffset] === "/" ? slashOffset + 1 : null;
}

function javascriptStringValue(token: JavascriptToken | undefined): string | undefined {
	return token?.type === tokTypes.string && typeof token.value === "string"
		? token.value
		: undefined;
}

function isNamedJavascriptToken(token: JavascriptToken | undefined, value: string): boolean {
	return token?.type === tokTypes.name && token.value === value;
}

function indexJavascriptParentheses(tokens: JavascriptToken[]): {
	closingByOpening: Map<number, number>;
	openingByClosing: Map<number, number>;
} {
	const closingByOpening = new Map<number, number>();
	const openingByClosing = new Map<number, number>();
	const stack: number[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index].type === tokTypes.parenL) stack.push(index);
		if (tokens[index].type === tokTypes.parenR) {
			const openingIndex = stack.pop();
			if (openingIndex !== undefined) {
				closingByOpening.set(openingIndex, index);
				openingByClosing.set(index, openingIndex);
			}
		}
	}
	return { closingByOpening, openingByClosing };
}

function findJavascriptFromToken(tokens: JavascriptToken[], offset: number): JavascriptToken | undefined {
	let depth = 0;
	for (let index = offset; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === tokTypes.semi || token.type === tokTypes.eof) return undefined;
		if (token.type === tokTypes.braceL || token.type === tokTypes.bracketL || token.type === tokTypes.parenL) {
			depth += 1;
		} else if (token.type === tokTypes.braceR || token.type === tokTypes.bracketR || token.type === tokTypes.parenR) {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0 && isNamedJavascriptToken(token, "from")) {
			if (javascriptStringValue(tokens[index + 1]) !== undefined) return tokens[index + 1];
		}
	}
	return undefined;
}

function readDynamicImportToken(
	tokens: JavascriptToken[],
	importIndex: number,
	closingByOpening: Map<number, number>,
): JavascriptToken | undefined {
	if (tokens[importIndex + 1]?.type !== tokTypes.parenL) return undefined;
	const literal = tokens[importIndex + 2];
	if (javascriptStringValue(literal) === undefined) return undefined;
	const closingIndex = closingByOpening.get(importIndex + 1);
	if (closingIndex === undefined) return undefined;
	const afterLiteralIndex = importIndex + 3;
	if (afterLiteralIndex === closingIndex) return literal;
	const optionsIndex = afterLiteralIndex + 1;
	if (tokens[afterLiteralIndex]?.type !== tokTypes.comma) return undefined;
	if (optionsIndex === closingIndex) return literal;
	let depth = 0;
	for (let index = optionsIndex; index < closingIndex; index += 1) {
		const token = tokens[index];
		if (token.type === tokTypes.parenL
			|| token.type === tokTypes.braceL
			|| token.type === tokTypes.bracketL) {
			depth += 1;
		} else if (token.type === tokTypes.parenR
			|| token.type === tokTypes.braceR
			|| token.type === tokTypes.bracketR) {
			depth = Math.max(0, depth - 1);
		} else if (token.type === tokTypes.comma && depth === 0) {
			return index === closingIndex - 1 ? literal : undefined;
		}
	}
	return literal;
}

function readNewUrlToken(tokens: JavascriptToken[], newIndex: number): JavascriptToken | undefined {
	const literal = tokens[newIndex + 3];
	return isNamedJavascriptToken(tokens[newIndex + 1], "URL")
		&& tokens[newIndex + 2]?.type === tokTypes.parenL
		&& javascriptStringValue(literal) !== undefined
		&& tokens[newIndex + 4]?.type === tokTypes.comma
		&& tokens[newIndex + 5]?.type === tokTypes._import
		&& tokens[newIndex + 6]?.type === tokTypes.dot
		&& isNamedJavascriptToken(tokens[newIndex + 7], "meta")
		&& tokens[newIndex + 8]?.type === tokTypes.dot
		&& isNamedJavascriptToken(tokens[newIndex + 9], "url")
		&& (tokens[newIndex + 10]?.type === tokTypes.parenR
			|| (tokens[newIndex + 10]?.type === tokTypes.comma
				&& tokens[newIndex + 11]?.type === tokTypes.parenR))
		? literal
		: undefined;
}

function isFallbackJavascriptRegexStart(
	tokens: JavascriptToken[],
	index: number,
	contents: string,
	openingParenthesisIndex: number | undefined,
): boolean {
	const previous = tokens[index - 1];
	const hasLineTerminator = (token: JavascriptToken | undefined): boolean => token !== undefined
		&& /[\r\n\u2028\u2029]/u.test(contents.slice(token.end, tokens[index].start));
	if ((previous?.type === tokTypes._break
		|| previous?.type === tokTypes._continue
		|| previous?.type === tokTypes._return
		|| previous?.type === tokTypes._debugger)
		&& hasLineTerminator(previous)) return true;
	if (previous?.type === tokTypes.name
		&& (tokens[index - 2]?.type === tokTypes._break
			|| tokens[index - 2]?.type === tokTypes._continue)
		&& !/[\r\n\u2028\u2029]/u.test(contents.slice(tokens[index - 2].end, previous.start))
		&& hasLineTerminator(previous)) return true;
	if (previous?.type !== tokTypes.parenR
		|| openingParenthesisIndex === undefined) return false;
	return tokens[openingParenthesisIndex - 1]?.type === tokTypes.name
		&& tokens[openingParenthesisIndex - 1]?.value === "await"
		&& tokens[openingParenthesisIndex - 2]?.type === tokTypes._for;
}

function findClosingFallbackJavascriptRegex(
	tokens: JavascriptToken[],
	openingIndex: number,
	contents: string,
): number {
	const end = scanFallbackJavascriptRegexEnd(contents, tokens[openingIndex].start);
	if (end === null) return -1;
	let closingIndex = openingIndex;
	for (let index = openingIndex + 1; index < tokens.length && tokens[index].end <= end; index += 1) {
		closingIndex = index;
	}
	return closingIndex;
}

function collectJavascriptTokenReferenceEvents(
	contents: string,
	target: ReferenceEvent[],
	baseOffset = 0,
): void {
	const { tokens } = tokenizeJavascript(contents);
	const { closingByOpening, openingByClosing } = indexJavascriptParentheses(tokens);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.type === tokTypes.slash
			&& isFallbackJavascriptRegexStart(
				tokens,
				index,
				contents,
				openingByClosing.get(index - 1),
			)) {
			const closingIndex = findClosingFallbackJavascriptRegex(tokens, index, contents);
			if (closingIndex >= 0) index = closingIndex;
			continue;
		}
		let literal: JavascriptToken | undefined;
		if (token.type === tokTypes._import
			&& tokens[index - 1]?.type !== tokTypes.dot
			&& tokens[index - 1]?.type !== tokTypes.questionDot) {
			literal = tokens[index + 1]?.type === tokTypes.parenL
				? readDynamicImportToken(tokens, index, closingByOpening)
				: javascriptStringValue(tokens[index + 1]) !== undefined
					? tokens[index + 1]
					: findJavascriptFromToken(tokens, index + 1);
		} else if (token.type === tokTypes._export) {
			literal = findJavascriptFromToken(tokens, index + 1);
		} else if (token.type === tokTypes._new) {
			literal = readNewUrlToken(tokens, index);
		}
		if (literal) appendEvent(target, baseOffset + literal.start, javascriptStringValue(literal));
	}
}

function collectJavascriptReferenceEvents(
	contents: string,
	target: ReferenceEvent[],
	baseOffset = 0,
): JavascriptAstNode | null {
	const ast = parseJavascript(contents);
	if (ast) {
		collectJavascriptAstReferenceEvents(ast, target, baseOffset);
	} else {
		collectJavascriptTokenReferenceEvents(contents, target, baseOffset);
	}
	return ast;
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

function decodeHtmlAttributeReferences(value: string): string {
	return decodeHTMLAttribute(value);
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

function isLocalBaseHref(value: string | undefined): value is string {
	const trimmed = value?.trim() ?? "";
	return Boolean(trimmed)
		&& !trimmed.startsWith("#")
		&& !trimmed.startsWith("?")
		&& !trimmed.startsWith("//")
		&& !EXPLICIT_SCHEME_PATTERN.test(trimmed);
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

		if (options.allowBase && tagName === "base" && baseHref === null) {
			const href = attributes.find((attribute) => attribute.name === "href")?.value;
			if (isLocalBaseHref(href)) baseHref = href.trim();
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
		if (options.collectRawDependencies && (tagName === "script" || tagName === "style")) {
			const body = contents.slice(bodyStart, closingTag.start);
			const bodyOffset = options.baseOffset + bodyStart;
			if (tagName === "style") {
				collectCssReferenceEvents(body, target, bodyOffset);
			} else {
				const ast = collectJavascriptReferenceEvents(body, target, bodyOffset);
				if (ast) {
					for (const fragment of collectJavascriptMarkupFragments(ast)) {
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
