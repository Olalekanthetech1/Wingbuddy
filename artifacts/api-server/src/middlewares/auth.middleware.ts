import type { Request, Response, NextFunction } from "express";
import { authService, type AuthenticatedUser } from "../services/auth.service";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.query.token as string) || (req.cookies?.session_token as string);

  if (!token) {
    res.status(401).json({ error: "Unauthorized: Missing authentication token" });
    return;
  }

  const user = await authService.validateSession(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired session token" });
    return;
  }

  req.user = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Forbidden: Admin privileges required" });
      return;
    }
    next();
  });
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.query.token as string) || (req.cookies?.session_token as string);

  if (token) {
    const user = await authService.validateSession(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}
