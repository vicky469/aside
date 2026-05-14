type DomConstructor<T> = {
    new (...args: never[]): T;
    name: string;
};

function prototypeChainHasConstructorName(value: object, constructorName: string): boolean {
    let prototype = Object.getPrototypeOf(value) as object | null;
    while (prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
        const prototypeConstructor: unknown = descriptor?.value;
        const prototypeConstructorName = typeof prototypeConstructor === "function"
            ? prototypeConstructor.name
            : "";
        if (prototypeConstructorName === constructorName) {
            return true;
        }
        prototype = Object.getPrototypeOf(prototype) as object | null;
    }

    return false;
}

export function nodeInstanceOf<T>(node: unknown, type: DomConstructor<T>): node is T {
    if (!node || typeof node !== "object") {
        return false;
    }

    const candidate = node as {
        instanceOf?: (type: DomConstructor<T>) => boolean;
    };
    if (typeof candidate.instanceOf === "function") {
        return candidate.instanceOf(type);
    }

    return prototypeChainHasConstructorName(node, type.name);
}
