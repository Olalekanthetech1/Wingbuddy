import { Router, type Request, type Response } from "express";
import { runtimeBehaviorConfigService, type BehaviorKind } from "../services/runtime-behavior-config.service";

const router = Router();
const isKind = (value: string): value is BehaviorKind => value === "mode" || value === "personality";

router.get("/behaviors", async (req: Request, res: Response) => {
  try {
    const rawKind = typeof req.query.kind === "string" ? req.query.kind : "";
    const kind = isKind(rawKind) ? rawKind : "personality";
    res.json({ kind, profiles: await runtimeBehaviorConfigService.list(kind), defaults: { kind, key: runtimeBehaviorConfigService.getDefault(kind) } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/behaviors/:kind/:key", async (req: Request, res: Response) => {
  const rawKind = Array.isArray(req.params.kind) ? req.params.kind[0] : req.params.kind;
  const rawKey = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
  if (!isKind(rawKind)) return res.status(400).json({ error: "Invalid behavior kind" });
  try {
    const profile = await runtimeBehaviorConfigService.update(rawKind, rawKey, req.body || {});
    res.json({ success: true, profile });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/behaviors/:kind/:key/default", async (req: Request, res: Response) => {
  const rawKind = Array.isArray(req.params.kind) ? req.params.kind[0] : req.params.kind;
  const rawKey = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
  if (!isKind(rawKind)) return res.status(400).json({ error: "Invalid behavior kind" });
  try {
    const profile = await runtimeBehaviorConfigService.setDefault(rawKind, rawKey);
    res.json({ success: true, profile, defaultKey: runtimeBehaviorConfigService.getDefault(rawKind) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
