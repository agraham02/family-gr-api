// Health check route
import { Router } from "express";
import { healthCheck } from "../controllers/healthController";

const router = Router();

router.get("/healthz", healthCheck);

export default router;
