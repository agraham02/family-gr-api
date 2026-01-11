// Centralized error handler middleware
import { Request, Response, NextFunction } from "express";

export function errorHandler(
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction
) {
    console.error(err);

    const response: { error: string; code?: string } = {
        error: err.message || "Internal Server Error",
    };

    // Include error code if present (e.g., PRIVATE_ROOM, RATE_LIMITED)
    if (err.code) {
        response.code = err.code;
    }

    res.status(err.status || 500).json(response);
}
