const TAG_CHARACTER_REGEX = /[\p{L}\p{N}_/-]/u;
const TAG_START_CHARACTER_REGEX = /[\p{L}_]/u;

export function isTagCharacter(char: string): boolean {
    return char.length === 1 && TAG_CHARACTER_REGEX.test(char);
}

export function normalizeTagText(value: string): string {
    const normalized = value.trim().replace(/^#+/, "");
    return normalized ? `#${normalized}` : "";
}

export function isTagBoundaryChar(char: string): boolean {
    return !char || !isTagCharacter(char);
}

export function extractTagsFromText(value: string): string[] {
    const tags: string[] = [];

    for (let index = 0; index < value.length; index += 1) {
        if (value.charAt(index) !== "#") {
            continue;
        }

        if (!isTagBoundaryChar(value.charAt(index - 1))) {
            continue;
        }

        const firstChar = value.charAt(index + 1);
        if (!firstChar || !TAG_START_CHARACTER_REGEX.test(firstChar)) {
            continue;
        }

        let end = index + 1;
        while (end < value.length && isTagCharacter(value.charAt(end))) {
            end += 1;
        }

        tags.push(normalizeTagText(value.slice(index, end)));
        index = end - 1;
    }

    return tags;
}
