import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config, signExecutorRequest } from "./config";

export function requireExecutorAuth(req: Request, res: Response, next: NextFunction) {
  const organizationId = req.get("x-nebulosa-organization");
  const timestamp = req.get("x-nebulosa-timestamp");
  const signature = req.get("x-nebulosa-signature");
  if (organizationId !== config.organizationId || !timestamp || !/^\d{13}$/.test(timestamp)
    || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !signature || !/^[a-f0-9]{64}$/.test(signature)) {
    return res.status(401).json({ code: "invalid_signature", message: "Executor authentication failed." });
  }

  const expected = signExecutorRequest(organizationId, req.method, req.path, timestamp, req.body);
  if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    return res.status(401).json({ code: "invalid_signature", message: "Executor authentication failed." });
  }
  next();
}
