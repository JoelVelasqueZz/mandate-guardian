import type { NextFunction, Request, Response } from "express";

/**
 * Small fixed-window limiter, per client IP, in memory. It protects the routes that spend model or
 * catalog quota. Behind a proxy (Render) the server sets `trust proxy` so req.ip is the real client.
 */
export function rateLimit(options: { windowMs: number; max: number; now?: () => number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
    const key = req.ip ?? "unknown";
    const entry = hits.get(key) ?? { count: 0, resetAt: t + options.windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > options.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      return res.status(429).json({ error: "Too many requests. Wait a moment and try again." });
    }
    next();
  };
}
