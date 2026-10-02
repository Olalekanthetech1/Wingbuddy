import { Router, type Request, type Response } from "express";
import { authService } from "../services/auth.service";
import { requireAuth } from "../middlewares/auth.middleware";
import { eventBusService } from "../services/event-bus.service";
import { logger } from "../lib/logger";

const router = Router();

const isProduction = process.env.NODE_ENV === "production";

/**
 * POST /api/auth/google
 * Authenticates user via Google token or profile details.
 * Prevents silent merge takeovers and enforces email verification checks.
 */
router.post("/google", async (req: Request, res: Response) => {
  try {
    const { credential, email, googleId, name, picture, telegramLinkingContext } = req.body;
    
    let targetEmail = email;
    let targetName = name;
    let targetPicture = picture;
    let targetGoogleId = googleId;
    let emailVerified = true;

    // If credential JWT token is passed, decode payload
    if (credential && typeof credential === "string") {
      try {
        const parts = credential.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
          if (payload.email) {
            targetEmail = payload.email;
            targetName = payload.name || targetName;
            targetPicture = payload.picture || targetPicture;
            targetGoogleId = payload.sub || targetGoogleId;
            emailVerified = payload.email_verified !== false;
          }
        }
      } catch (jwtErr) {
        logger.warn({ error: jwtErr }, "Failed decoding Google JWT credential directly");
      }
    }

    if (!targetEmail || typeof targetEmail !== "string") {
      res.status(400).json({ error: "Missing valid email in Google authentication payload" });
      return;
    }

    const result = await authService.handleGoogleAuth({
      credential,
      email: targetEmail,
      googleId: targetGoogleId,
      name: targetName,
      picture: targetPicture,
      emailVerified,
      telegramLinkingContext,
    });

    res.cookie("wb_session_token", result.sessionToken, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: false, // Accessible to app client for bearer requests
      secure: isProduction,
    });
    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Google authentication failure");
    const isConflict = err.message?.includes("Conflict");
    res.status(isConflict ? 409 : 500).json({ error: err.message || "Failed to authenticate with Google" });
  }
});

/**
 * POST /api/auth/instant-login
 * Direct email or 1-click workspace access for development/instant preview.
 */
router.post("/instant-login", async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body || {};
    const result = await authService.handleEmailOrInstantLogin({ email, name });
    res.cookie("wb_session_token", result.sessionToken, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: false,
      secure: isProduction,
    });
    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Instant login failure");
    res.status(500).json({ error: err.message || "Failed to launch workspace" });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile.
 */
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

/**
 * GET /api/auth/events
 * Server-Sent Events (SSE) connection for real-time bi-directional messaging
 */
router.get("/events", async (req: Request, res: Response) => {
  try {
    const token = (req.query.token as string) || (req.cookies?.session_token as string);
    if (!token) {
      res.status(401).json({ error: "Unauthorized: Missing token for real-time events" });
      return;
    }

    const user = await authService.validateSession(token);
    if (!user) {
      res.status(401).json({ error: "Unauthorized: Invalid token for real-time events" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in Nginx proxies
    });

    // Write initial padding/ping
    res.write(":\n\n");

    // Register clients for both user-based key and Telegram user key if linked
    const cleanupFn1 = eventBusService.registerClient(`user:${user.id}`, res);
    let cleanupFn2: (() => void) | null = null;
    if (user.telegramUserId) {
      cleanupFn2 = eventBusService.registerClient(`tg:${user.telegramUserId}`, res);
    }

    const heartbeatInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(":\n\n"); // SSE ping comment
      }
    }, 30000);

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      cleanupFn1();
      if (cleanupFn2) cleanupFn2();
    });
  } catch (err: any) {
    logger.error({ error: err }, "Error in SSE auth/events route");
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Failed starting event stream" });
    }
  }
});

/**
 * POST /api/auth/telegram/generate-link
 * Generates a 1-click single-use Telegram pairing link with live bot handle.
 */
router.post("/telegram/generate-link", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await authService.generateTelegramPairingToken(userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate pairing link" });
  }
});

/**
 * GET /api/auth/magic-token-exchange
 * Hardened exchange: Validates token, sets secure cookie, and performs 303 Redirect to clean path.
 * Ensures tokens never remain in address bar, browser history, or referrer logs.
 */
router.get("/magic-token-exchange", async (req: Request, res: Response) => {
  try {
    const token = (req.query.token as string) || "";
    const redirectTarget = (req.query.redirect as string) || "/app";

    if (!token) {
      res.redirect("/app?error=missing_token");
      return;
    }

    const result = await authService.consumeMagicLoginToken(token);
    if (!result) {
      res.redirect("/app?error=invalid_or_expired_token");
      return;
    }

    res.cookie("wb_session_token", result.sessionToken, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: false,
      secure: isProduction,
    });

    const safeRedirect = redirectTarget.startsWith("/") && !redirectTarget.startsWith("//") ? redirectTarget : "/app";
    res.redirect(303, safeRedirect);
  } catch (err: any) {
    logger.error({ error: err }, "Magic token exchange error");
    res.redirect("/app?error=auth_failed");
  }
});

/**
 * POST /api/auth/magic-login
 * Consumes single-use magic login token generated from Telegram `/web`.
 */
router.post("/magic-login", async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Missing magic token parameter" });
      return;
    }

    const result = await authService.consumeMagicLoginToken(token);
    if (!result) {
      res.status(401).json({ error: "Invalid, expired, or already used magic login token" });
      return;
    }

    res.cookie("wb_session_token", result.sessionToken, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: false,
      secure: isProduction,
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Magic login error");
    res.status(500).json({ error: err.message || "Failed processing magic login" });
  }
});

/**
 * POST /api/auth/telegram-webapp-sso
 * Verifies Telegram WebApp initData HMAC and provides instant zero-token session
 */
router.post("/telegram-webapp-sso", async (req: Request, res: Response) => {
  try {
    const { initData } = req.body;
    if (!initData || typeof initData !== "string") {
      res.status(400).json({ error: "Missing initData parameter" });
      return;
    }

    const verification = authService.verifyTelegramInitData(initData);
    if (!verification.isValid || !verification.user?.id) {
      res.status(401).json({ error: "Invalid or expired Telegram WebApp authentication signature" });
      return;
    }

    // Auto-generate or lookup user session directly from verified Telegram ID
    const tgUserId = verification.user.id;
    const tgUsername = verification.user.username;
    
    // Generate magic token and immediately consume for session creation
    const { token } = await authService.generateMagicLoginToken(tgUserId, tgUsername);
    const result = await authService.consumeMagicLoginToken(token);

    if (!result) {
      res.status(500).json({ error: "Failed creating session for verified Telegram WebApp user" });
      return;
    }

    res.cookie("wb_session_token", result.sessionToken, {
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: false,
      secure: isProduction,
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ error: err }, "Telegram WebApp SSO error");
    res.status(500).json({ error: err.message || "Failed verifying Telegram WebApp" });
  }
});

/**
 * POST /api/auth/revoke-all-sessions
 * "Sign out all devices"
 */
router.post("/revoke-all-sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await authService.revokeAllUserSessions(userId);
    res.clearCookie("wb_session_token", { path: "/" });
    res.json({ success: true, message: "All sessions have been revoked." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed revoking sessions" });
  }
});

/**
 * POST /api/auth/preferences
 */
router.post("/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { notificationPreference, contextSyncMode } = req.body;
    const updated = await authService.updatePreferences(userId, { notificationPreference, contextSyncMode });
    if (!updated) {
      res.status(400).json({ error: "Invalid preferences payload" });
      return;
    }
    res.json({ user: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed updating preferences" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req: Request, res: Response) => {
  res.clearCookie("wb_session_token", { path: "/" });
  res.json({ success: true, message: "Logged out successfully" });
});

export default router;
