export interface JavascriptDependencyReference {
	offset: number;
	value: string;
}

export interface JavascriptMarkupFragment {
	offset: number;
	contents: string;
}

export interface JavascriptDependencyScanResult {
	references: JavascriptDependencyReference[];
	markupFragments: JavascriptMarkupFragment[];
}

type JavascriptTokenKind = "identifier" | "keyword" | "number" | "punctuator" | "regex" | "string" | "template";

interface JavascriptToken {
	kind: JavascriptTokenKind;
	value: string;
	start: number;
	end: number;
	lineBreakBefore: boolean;
	blockClose?: boolean;
	controlClose?: boolean;
}

interface JavascriptScanState {
	braceStack: boolean[];
	markupFragments: JavascriptMarkupFragment[];
	parenStack: boolean[];
	pendingLineBreak: boolean;
	tokens: JavascriptToken[];
}

interface ReadStringResult {
	end: number;
	token: JavascriptToken | null;
}

interface ReadEscapeResult {
	end: number;
	value: string;
}

const KEYWORDS = new Set([
	"await", "break", "case", "catch", "class", "continue", "debugger", "delete", "do",
	"else", "export", "extends", "finally", "for", "function", "if", "import", "in",
	"instanceof", "new", "return", "switch", "throw", "try", "typeof", "void", "while",
	"with", "yield",
]);
const CONTROL_PAREN_KEYWORDS = new Set(["catch", "for", "if", "switch", "while", "with"]);
const REGEX_PREFIX_KEYWORDS = new Set([
	"await", "case", "delete", "do", "else", "extends", "in", "instanceof", "new", "return",
	"throw", "typeof", "void", "yield",
]);
const RESTRICTED_LINE_KEYWORDS = new Set(["break", "continue", "debugger", "return"]);
const LABELLED_LINE_KEYWORDS = new Set(["break", "continue"]);
const BLOCK_PREFIX_KEYWORDS = new Set(["catch", "do", "else", "finally", "try"]);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
});
const IDENTIFIER_START = /[$_\p{ID_Start}]/u;
const IDENTIFIER_CONTINUE = /[$_\u200c\u200d\p{ID_Continue}]/u;
const LINE_BREAK = /[\r\n\u2028\u2029]/u;

function readCodePoint(contents: string, offset: number): string {
	const codePoint = contents.codePointAt(offset);
	return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function isIdentifierStart(contents: string, offset: number): boolean {
	return IDENTIFIER_START.test(readCodePoint(contents, offset));
}

function isIdentifierContinue(contents: string, offset: number): boolean {
	return IDENTIFIER_CONTINUE.test(readCodePoint(contents, offset));
}

function pushToken(
	state: JavascriptScanState,
	token: Omit<JavascriptToken, "lineBreakBefore">,
): JavascriptToken {
	const completed = { ...token, lineBreakBefore: state.pendingLineBreak };
	state.pendingLineBreak = false;
	state.tokens.push(completed);
	return completed;
}

function readIdentifier(contents: string, offset: number, state: JavascriptScanState): number {
	let end = offset;
	while (end < contents.length && isIdentifierContinue(contents, end)) {
		end += readCodePoint(contents, end).length;
	}
	const value = contents.slice(offset, end);
	pushToken(state, {
		kind: KEYWORDS.has(value) ? "keyword" : "identifier",
		value,
		start: offset,
		end,
	});
	return end;
}

function readFixedHex(contents: string, offset: number, length: number): { end: number; value: string } | null {
	const digits = contents.slice(offset, offset + length);
	if (digits.length !== length || !new RegExp(`^[0-9a-f]{${length}}$`, "iu").test(digits)) return null;
	const codePoint = Number.parseInt(digits, 16);
	if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
	return { end: offset + length, value: String.fromCodePoint(codePoint) };
}

function readUnicodeEscape(contents: string, offset: number): { end: number; value: string } | null {
	if (contents[offset] !== "{") return readFixedHex(contents, offset, 4);
	const closing = contents.indexOf("}", offset + 1);
	if (closing < 0) return null;
	const digits = contents.slice(offset + 1, closing);
	if (!/^[0-9a-f]{1,6}$/iu.test(digits)) return null;
	const codePoint = Number.parseInt(digits, 16);
	if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
	return { end: closing + 1, value: String.fromCodePoint(codePoint) };
}

function skipInvalidString(contents: string, offset: number, quote: string): number {
	for (let index = offset; index < contents.length; index += 1) {
		if (LINE_BREAK.test(contents[index])) return index;
		if (contents[index] === "\\") {
			index += 1;
			continue;
		}
		if (contents[index] === quote) return index + 1;
	}
	return contents.length;
}

function readEscape(contents: string, offset: number): ReadEscapeResult | null {
	const escaped = contents[offset + 1];
	if (escaped === undefined) return null;
	if (escaped === "\r" || escaped === "\n" || escaped === "\u2028" || escaped === "\u2029") {
		return {
			end: offset + (escaped === "\r" && contents[offset + 2] === "\n" ? 3 : 2),
			value: "",
		};
	}
	if (escaped === "x") return readFixedHex(contents, offset + 2, 2);
	if (escaped === "u") return readUnicodeEscape(contents, offset + 2);
	if (escaped === "0" && /[0-9]/u.test(contents[offset + 2] ?? "")) return null;
	return {
		end: offset + 2,
		value: escaped === "0" ? "\0" : SIMPLE_ESCAPES[escaped] ?? escaped,
	};
}

function readString(
	contents: string,
	offset: number,
	state: JavascriptScanState,
): ReadStringResult {
	const quote = contents[offset];
	let value = "";
	for (let index = offset + 1; index < contents.length;) {
		const character = contents[index];
		if (character === quote) {
			const token = pushToken(state, {
				kind: "string",
				value,
				start: offset,
				end: index + 1,
			});
			if (value.includes("<")) {
				state.markupFragments.push({ contents: value, offset: token.start });
			}
			return { end: index + 1, token };
		}
		if (LINE_BREAK.test(character)) {
			return { end: index, token: null };
		}
		if (character !== "\\") {
			value += character;
			index += 1;
			continue;
		}

		const decoded = readEscape(contents, index);
		if (!decoded) {
			return { end: skipInvalidString(contents, index + 2, quote), token: null };
		}
		value += decoded.value;
		index = decoded.end;
	}
	return { end: contents.length, token: null };
}

function skipLineComment(contents: string, offset: number): number {
	let end = offset + 2;
	while (end < contents.length && !LINE_BREAK.test(contents[end])) end += 1;
	return end;
}

function skipBlockComment(contents: string, offset: number, state: JavascriptScanState): number {
	const closing = contents.indexOf("*/", offset + 2);
	const end = closing < 0 ? contents.length : closing + 2;
	if (LINE_BREAK.test(contents.slice(offset, end))) state.pendingLineBreak = true;
	return end;
}

function skipRegexLiteral(contents: string, offset: number): number | null {
	let inCharacterClass = false;
	for (let index = offset + 1; index < contents.length; index += 1) {
		const character = contents[index];
		if (LINE_BREAK.test(character)) return null;
		if (character === "\\") {
			index += 1;
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
			let end = index + 1;
			while (isIdentifierContinue(contents, end)) end += readCodePoint(contents, end).length;
			return end;
		}
	}
	return null;
}

function isPropertyAccess(tokens: readonly JavascriptToken[], index: number): boolean {
	const previous = tokens[index - 1]?.value;
	return previous === "." || previous === "?." || previous === "#";
}

function isControlParenthesis(tokens: readonly JavascriptToken[]): boolean {
	const previous = tokens[tokens.length - 1];
	if (!previous || isPropertyAccess(tokens, tokens.length - 1)) return false;
	if (CONTROL_PAREN_KEYWORDS.has(previous.value)) return true;
	return previous.value === "await" && tokens[tokens.length - 2]?.value === "for";
}

function findBodyOwnerKeyword(tokens: readonly JavascriptToken[]): number | null {
	let delimiterDepth = 0;
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const value = tokens[index].value;
		if ([")", "]", "}"].includes(value)) {
			delimiterDepth += 1;
			continue;
		}
		if (["(", "[", "{"].includes(value)) {
			if (delimiterDepth > 0) {
				delimiterDepth -= 1;
				continue;
			}
			break;
		}
		if (delimiterDepth > 0) continue;
		if (value === "function" || value === "class") return index;
		if (value === ";") break;
	}
	return null;
}

function bodyOwnerIsDeclaration(tokens: readonly JavascriptToken[], ownerIndex: number): boolean {
	let prefixIndex = ownerIndex - 1;
	while (["async", "default", "export"].includes(tokens[prefixIndex]?.value ?? "")) {
		prefixIndex -= 1;
	}
	const prefix = tokens[prefixIndex];
	return !prefix
		|| [";", "{", "}"].includes(prefix.value)
		|| prefix.controlClose === true
		|| BLOCK_PREFIX_KEYWORDS.has(prefix.value);
}

function colonStartsBlock(
	tokens: readonly JavascriptToken[],
	enclosingBraceStack: readonly boolean[],
): boolean {
	if (enclosingBraceStack[enclosingBraceStack.length - 1] === false) return false;
	for (let index = tokens.length - 2; index >= 0; index -= 1) {
		const token = tokens[index];
		if (token.value === "?") return false;
		if (token.value === "case" || token.value === "default") return true;
		if ([";", "{", "}"].includes(token.value)) return true;
	}
	return true;
}

function isBlockBraceStart(
	tokens: readonly JavascriptToken[],
	enclosingBraceStack: readonly boolean[],
): boolean {
	const previous = tokens[tokens.length - 1];
	if (!previous) return true;
	if (previous.value === "=>") return false;
	const bodyOwnerIndex = findBodyOwnerKeyword(tokens);
	if (bodyOwnerIndex !== null) return bodyOwnerIsDeclaration(tokens, bodyOwnerIndex);
	if (previous.controlClose || previous.value === ")") return true;
	if (previous.value === ":") return colonStartsBlock(tokens, enclosingBraceStack);
	if ([";", "{", "}"].includes(previous.value)) return true;
	if (BLOCK_PREFIX_KEYWORDS.has(previous.value)) return true;
	return false;
}

function shouldStartRegex(state: JavascriptScanState): boolean {
	const tokens = state.tokens;
	const previous = tokens[tokens.length - 1];
	if (!previous) return true;
	if (RESTRICTED_LINE_KEYWORDS.has(previous.value) && state.pendingLineBreak) return true;
	if (previous.kind === "identifier"
		&& state.pendingLineBreak
		&& !previous.lineBreakBefore
		&& LABELLED_LINE_KEYWORDS.has(tokens[tokens.length - 2]?.value ?? "")) return true;
	if (previous.kind === "identifier"
		|| previous.kind === "number"
		|| previous.kind === "regex"
		|| previous.kind === "string"
		|| previous.kind === "template") return false;
	if (previous.value === ")") return previous.controlClose === true;
	if (previous.value === "}") return previous.blockClose === true;
	if (previous.value === "]" || previous.value === "++" || previous.value === "--") return false;
	if (previous.kind === "keyword") return REGEX_PREFIX_KEYWORDS.has(previous.value)
		|| RESTRICTED_LINE_KEYWORDS.has(previous.value);
	return true;
}

function readNumber(contents: string, offset: number, state: JavascriptScanState): number {
	let end = offset + 1;
	while (/[a-z0-9_.]/iu.test(contents[end] ?? "")) end += 1;
	pushToken(state, { kind: "number", value: contents.slice(offset, end), start: offset, end });
	return end;
}

function readPunctuator(contents: string, offset: number): string {
	for (const length of [4, 3, 2]) {
		const value = contents.slice(offset, offset + length);
		if ([">>>=", "===", "!==", "**=", "&&=", "||=", "??=", ">>>", "<<=", ">>=", "...",
			"=>", "==", "!=", "<=", ">=", "++", "--", "&&", "||", "??", "**", "<<", ">>",
			"+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "?."].includes(value)) return value;
	}
	return contents[offset];
}

function appendTemplateFragment(
	state: JavascriptScanState,
	contents: string,
	offset: number,
): void {
	if (contents.includes("<")) state.markupFragments.push({ contents, offset });
}

function scanTemplate(
	contents: string,
	offset: number,
	state: JavascriptScanState,
): number {
	pushToken(state, { kind: "template", value: "", start: offset, end: offset + 1 });
	let chunkStart = offset + 1;
	let chunk = "";
	for (let index = offset + 1; index < contents.length;) {
		const character = contents[index];
		if (character === "\\") {
			const decoded = readEscape(contents, index);
			if (!decoded) {
				chunk += contents.slice(index, Math.min(index + 2, contents.length));
				index = Math.min(index + 2, contents.length);
				continue;
			}
			chunk += decoded.value;
			index = decoded.end;
			continue;
		}
		if (character === "`") {
			appendTemplateFragment(state, chunk, chunkStart);
			pushToken(state, { kind: "template", value: "", start: index, end: index + 1 });
			return index + 1;
		}
		if (character === "$" && contents[index + 1] === "{") {
			appendTemplateFragment(state, chunk, chunkStart);
			pushToken(state, { kind: "punctuator", value: "{", start: index + 1, end: index + 2 });
			state.braceStack.push(false);
			const expressionEnd = scanCode(contents, index + 2, state, true);
			if (expressionEnd <= contents.length && contents[expressionEnd - 1] === "}") {
				const closing = pushToken(state, {
					kind: "punctuator",
					value: "}",
					start: expressionEnd - 1,
					end: expressionEnd,
				});
				closing.blockClose = state.braceStack.pop() ?? false;
			}
			index = expressionEnd;
			chunkStart = index;
			chunk = "";
			continue;
		}
		if (LINE_BREAK.test(character)) state.pendingLineBreak = true;
		chunk += character;
		index += 1;
	}
	appendTemplateFragment(state, chunk, chunkStart);
	return contents.length;
}

function scanCode(
	contents: string,
	start: number,
	state: JavascriptScanState,
	stopAtTemplateBrace = false,
): number {
	let localBraceDepth = 0;
	for (let index = start; index < contents.length;) {
		const character = contents[index];
		if (/\s/u.test(character)) {
			if (LINE_BREAK.test(character)) state.pendingLineBreak = true;
			index += 1;
			continue;
		}
		if (contents.startsWith("//", index)) {
			index = skipLineComment(contents, index);
			continue;
		}
		if (contents.startsWith("/*", index)) {
			index = skipBlockComment(contents, index, state);
			continue;
		}
		if (character === "'" || character === "\"") {
			index = readString(contents, index, state).end;
			continue;
		}
		if (character === "`") {
			index = scanTemplate(contents, index, state);
			continue;
		}
		if (character === "/" && shouldStartRegex(state)) {
			const end = skipRegexLiteral(contents, index);
			if (end !== null) {
				pushToken(state, { kind: "regex", value: contents.slice(index, end), start: index, end });
				index = end;
				continue;
			}
		}
		if (isIdentifierStart(contents, index)) {
			index = readIdentifier(contents, index, state);
			continue;
		}
		if (/[0-9]/u.test(character)) {
			index = readNumber(contents, index, state);
			continue;
		}
		if (character === "}" && stopAtTemplateBrace && localBraceDepth === 0) return index + 1;

		const value = readPunctuator(contents, index);
		const token = pushToken(state, {
			kind: "punctuator",
			value,
			start: index,
			end: index + value.length,
		});
		if (value === "(") {
			state.parenStack.push(isControlParenthesis(state.tokens.slice(0, -1)));
		} else if (value === ")") {
			token.controlClose = state.parenStack.pop() ?? false;
		} else if (value === "{") {
			state.braceStack.push(isBlockBraceStart(state.tokens.slice(0, -1), state.braceStack));
			if (stopAtTemplateBrace) localBraceDepth += 1;
		} else if (value === "}") {
			token.blockClose = state.braceStack.pop() ?? false;
			if (stopAtTemplateBrace) localBraceDepth = Math.max(0, localBraceDepth - 1);
		}
		index += value.length;
	}
	return contents.length;
}

function indexClosingDelimiters(tokens: readonly JavascriptToken[]): Map<number, number> {
	const closingByOpening = new Map<number, number>();
	const stacks: Record<string, number[]> = { "(": [], "[": [], "{": [] };
	const openingByClosing: Readonly<Record<string, keyof typeof stacks>> = { ")": "(", "]": "[", "}": "{" };
	for (let index = 0; index < tokens.length; index += 1) {
		const value = tokens[index].value;
		if (value in stacks) {
			stacks[value].push(index);
			continue;
		}
		const opening = openingByClosing[value];
		if (opening) {
			const openingIndex = stacks[opening].pop();
			if (openingIndex !== undefined) closingByOpening.set(openingIndex, index);
		}
	}
	return closingByOpening;
}

function findFromString(tokens: readonly JavascriptToken[], offset: number): JavascriptToken | null {
	let depth = 0;
	for (let index = offset; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.value === ";" && depth === 0) return null;
		if (["(", "[", "{"].includes(token.value)) {
			depth += 1;
		} else if ([")", "]", "}"].includes(token.value)) {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0 && token.value === "from" && tokens[index + 1]?.kind === "string") {
			return tokens[index + 1];
		}
	}
	return null;
}

function matchDynamicImport(
	tokens: readonly JavascriptToken[],
	importIndex: number,
	closingByOpening: ReadonlyMap<number, number>,
): JavascriptToken | null {
	if (tokens[importIndex + 1]?.value !== "(" || tokens[importIndex + 2]?.kind !== "string") return null;
	const closingIndex = closingByOpening.get(importIndex + 1);
	if (closingIndex === undefined) return null;
	const literal = tokens[importIndex + 2];
	if (importIndex + 3 === closingIndex) return literal;
	if (tokens[importIndex + 3]?.value !== ",") return null;
	if (importIndex + 4 === closingIndex) return literal;
	let depth = 0;
	for (let index = importIndex + 4; index < closingIndex; index += 1) {
		const value = tokens[index].value;
		if (["(", "[", "{"].includes(value)) depth += 1;
		if ([")", "]", "}"].includes(value)) depth = Math.max(0, depth - 1);
		if (value === "," && depth === 0 && index !== closingIndex - 1) return null;
	}
	return literal;
}

function matchNewImportMetaUrl(
	tokens: readonly JavascriptToken[],
	newIndex: number,
	closingByOpening: ReadonlyMap<number, number>,
): JavascriptToken | null {
	const literal = tokens[newIndex + 3];
	if (tokens[newIndex + 1]?.value !== "URL"
		|| tokens[newIndex + 2]?.value !== "("
		|| literal?.kind !== "string"
		|| tokens[newIndex + 4]?.value !== ","
		|| tokens[newIndex + 5]?.value !== "import"
		|| tokens[newIndex + 6]?.value !== "."
		|| tokens[newIndex + 7]?.value !== "meta"
		|| tokens[newIndex + 8]?.value !== "."
		|| tokens[newIndex + 9]?.value !== "url") return null;
	const closingIndex = closingByOpening.get(newIndex + 2);
	return closingIndex === newIndex + 10
		|| (tokens[newIndex + 10]?.value === "," && closingIndex === newIndex + 11)
		? literal
		: null;
}

function collectReferences(tokens: readonly JavascriptToken[]): JavascriptDependencyReference[] {
	const references: JavascriptDependencyReference[] = [];
	const closingByOpening = indexClosingDelimiters(tokens);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		let literal: JavascriptToken | null = null;
		if (token.value === "import" && !isPropertyAccess(tokens, index)) {
			literal = tokens[index + 1]?.value === "("
				? matchDynamicImport(tokens, index, closingByOpening)
				: tokens[index + 1]?.kind === "string"
					? tokens[index + 1]
					: findFromString(tokens, index + 1);
		} else if (token.value === "export") {
			literal = findFromString(tokens, index + 1);
		} else if (token.value === "new") {
			literal = matchNewImportMetaUrl(tokens, index, closingByOpening);
		}
		if (literal) references.push({ offset: literal.start, value: literal.value });
	}
	return references.sort((left, right) => left.offset - right.offset);
}

export function scanJavascriptDependencies(contents: string): JavascriptDependencyScanResult {
	const state: JavascriptScanState = {
		braceStack: [],
		markupFragments: [],
		parenStack: [],
		pendingLineBreak: false,
		tokens: [],
	};
	scanCode(contents, 0, state);
	return {
		references: collectReferences(state.tokens),
		markupFragments: state.markupFragments.sort((left, right) => left.offset - right.offset),
	};
}
