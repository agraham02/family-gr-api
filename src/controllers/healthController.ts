// Controller for /healthz route
import { Request, Response, NextFunction } from "express";

export async function healthCheck(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        next(err);
    }
}
