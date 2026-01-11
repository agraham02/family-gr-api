// src/utils/httpErrors.ts
// Utility for creating HTTP errors with proper status codes

export class HttpError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.code = code;
    }
}

// Common error factories
export function notFound(message: string = "Resource not found"): HttpError {
    return new HttpError(message, 404);
}

export function badRequest(message: string = "Bad request"): HttpError {
    return new HttpError(message, 400);
}

export function forbidden(
    message: string = "Forbidden",
    code?: string
): HttpError {
    return new HttpError(message, 403, code);
}

export function conflict(message: string = "Conflict"): HttpError {
    return new HttpError(message, 409);
}

export function tooManyRequests(
    message: string = "Too many requests"
): HttpError {
    return new HttpError(message, 429);
}

export function unauthorized(message: string = "Unauthorized"): HttpError {
    return new HttpError(message, 401);
}
