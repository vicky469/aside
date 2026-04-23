export interface SearchableOpenFileSuggestion {
    fileName: string;
    filePath: string;
}

interface MatchRank {
    fieldPriority: 0 | 1;
    matchKind: 0 | 1 | 2 | 3;
    matchPosition: number;
    matchLength: number;
}

function isWordBoundaryCharacter(char: string | undefined): boolean {
    if (!char) {
        return true;
    }

    return !/[a-z0-9]/i.test(char);
}

function findWordPrefixPosition(text: string, query: string): number {
    for (let index = 0; index <= text.length - query.length; index += 1) {
        if (
            isWordBoundaryCharacter(text[index - 1])
            && text.slice(index, index + query.length) === query
        ) {
            return index;
        }
    }

    return -1;
}

function getTextMatchRank(text: string, query: string): Omit<MatchRank, "fieldPriority"> | null {
    if (text === query) {
        return {
            matchKind: 0,
            matchPosition: 0,
            matchLength: text.length,
        };
    }

    if (text.startsWith(query)) {
        return {
            matchKind: 1,
            matchPosition: 0,
            matchLength: text.length,
        };
    }

    const wordPrefixPosition = findWordPrefixPosition(text, query);
    if (wordPrefixPosition >= 0) {
        return {
            matchKind: 2,
            matchPosition: wordPrefixPosition,
            matchLength: text.length,
        };
    }

    const containsPosition = text.indexOf(query);
    if (containsPosition >= 0) {
        return {
            matchKind: 3,
            matchPosition: containsPosition,
            matchLength: text.length,
        };
    }

    return null;
}

function getOpenFileSuggestionRank(
    suggestion: SearchableOpenFileSuggestion,
    normalizedQuery: string,
): MatchRank | null {
    const fileNameRank = getTextMatchRank(suggestion.fileName.toLowerCase(), normalizedQuery);
    if (fileNameRank) {
        return {
            fieldPriority: 0,
            ...fileNameRank,
        };
    }

    const filePathRank = getTextMatchRank(suggestion.filePath.toLowerCase(), normalizedQuery);
    if (filePathRank) {
        return {
            fieldPriority: 1,
            ...filePathRank,
        };
    }

    return null;
}

function compareMatchRanks(left: MatchRank, right: MatchRank): number {
    if (left.fieldPriority !== right.fieldPriority) {
        return left.fieldPriority - right.fieldPriority;
    }

    if (left.matchKind !== right.matchKind) {
        return left.matchKind - right.matchKind;
    }

    if (left.matchPosition !== right.matchPosition) {
        return left.matchPosition - right.matchPosition;
    }

    return left.matchLength - right.matchLength;
}

export function rankOpenFileSuggestions<T extends SearchableOpenFileSuggestion>(
    suggestions: T[],
    query: string,
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return suggestions.slice();
    }

    return suggestions
        .map((suggestion, index) => ({
            suggestion,
            index,
            rank: getOpenFileSuggestionRank(suggestion, normalizedQuery),
        }))
        .filter((entry): entry is { suggestion: T; index: number; rank: MatchRank } => entry.rank !== null)
        .sort((left, right) => compareMatchRanks(left.rank, right.rank) || left.index - right.index)
        .map((entry) => entry.suggestion);
}
