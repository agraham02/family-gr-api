export function omitFields<T extends object>(
    obj: T,
    fields: (keyof T)[]
): Partial<T> {
    const result: Partial<T> = {};
    for (const key in obj) {
        if (!fields.includes(key as keyof T)) {
            result[key] = obj[key];
        }
    }
    return result;
}
