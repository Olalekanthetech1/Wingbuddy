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

export async function apiAdminGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();
    if (!adminPassword) {
      res.status(500).json({ error: "Admin Password Not Configured" });
      return;
    }

    const cookieHeader = req.headers.cookie || "";
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)wb_admin_token=([^;]+)/);
    const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (token && token === adminPassword) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : (req.query.token as string) || (req.cookies?.session_token as string);

    if (sessionToken) {
      const user = await authService.validateSession(sessionToken);
      if (user && user.role === "admin") {
        req.user = user;
        next();
        return;
      }
    }

    res.status(403).json({ error: "Forbidden: Admin access required" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error during admin validation" });
  }
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
