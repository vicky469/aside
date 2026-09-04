export type NativeHtmlAttributeDecoder = (value: string) => string | null;

const NAMED_ATTRIBUTE_REFERENCES: Readonly<Record<string, string>> = Object.freeze({
	amp: "&",
	apos: "'",
	bsol: "\\",
	colon: ":",
	commat: "@",
	dollar: "$",
	equals: "=",
	gt: ">",
	hyphen: "-",
	lbrack: "[",
	lpar: "(",
	lowbar: "_",
	lt: "<",
	nbsp: "\u00a0",
	num: "#",
	percnt: "%",
	period: ".",
	quest: "?",
	quot: "\"",
	rbrack: "]",
	rpar: ")",
	semi: ";",
	sol: "/",
});

const LEGACY_NAME_WITHOUT_SEMICOLON = new Set(["amp", "gt", "lt", "quot"]);
const WINDOWS_1252_CONTROLS: Readonly<Record<number, number>> = Object.freeze({
	0x80: 0x20ac,
	0x82: 0x201a,
	0x83: 0x0192,
	0x84: 0x201e,
	0x85: 0x2026,
	0x86: 0x2020,
	0x87: 0x2021,
	0x88: 0x02c6,
	0x89: 0x2030,
	0x8a: 0x0160,
	0x8b: 0x2039,
	0x8c: 0x0152,
	0x8e: 0x017d,
	0x91: 0x2018,
	0x92: 0x2019,
	0x93: 0x201c,
	0x94: 0x201d,
	0x95: 0x2022,
	0x96: 0x2013,
	0x97: 0x2014,
	0x98: 0x02dc,
	0x99: 0x2122,
	0x9a: 0x0161,
	0x9b: 0x203a,
	0x9c: 0x0153,
	0x9e: 0x017e,
	0x9f: 0x0178,
});

function decodeHtmlCodePoint(codePoint: number): string {
	if (codePoint === 0
		|| codePoint > 0x10ffff
		|| (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
		return "�";
	}
	return String.fromCodePoint(WINDOWS_1252_CONTROLS[codePoint] ?? codePoint);
}

function decodeWithoutDom(value: string): string {
	return value.replace(
		/&(?:#(?:([xX])([0-9a-f]+)|(\d+))|([a-z][a-z0-9]+))(;?)/giu,
		(match, hexMarker: string | undefined, hexDigits: string | undefined,
			decimalDigits: string | undefined, name: string | undefined,
			terminator: string, offset: number, contents: string) => {
			if (name !== undefined) {
				const normalizedName = name.toLowerCase();
				const decoded = NAMED_ATTRIBUTE_REFERENCES[normalizedName];
				if (decoded === undefined) return match;
				if (!terminator) {
					const next = contents[offset + match.length] ?? "";
					if (!LEGACY_NAME_WITHOUT_SEMICOLON.has(normalizedName)
						|| /[=a-z0-9]/iu.test(next)) return match;
				}
				return decoded;
			}

			const digits = hexMarker ? hexDigits : decimalDigits;
			if (!digits) return match;
			return decodeHtmlCodePoint(Number.parseInt(digits, hexMarker ? 16 : 10));
		},
	);
}

function decodeWithNativeParser(value: string): string | null {
	if (typeof DOMParser === "undefined") return null;
	const safeAttributeValue = value
		.replace(/"/gu, "&#34;")
		.replace(/</gu, "&#60;");
	const parsed = new DOMParser().parseFromString(
		`<span data-aside-value="${safeAttributeValue}"></span>`,
		"text/html",
	);
	return parsed.body.firstElementChild?.getAttribute("data-aside-value") ?? null;
}

export function decodeHtmlAttributeReferences(
	value: string,
	nativeDecoder: NativeHtmlAttributeDecoder = decodeWithNativeParser,
): string {
	return nativeDecoder(value) ?? decodeWithoutDom(value);
}
