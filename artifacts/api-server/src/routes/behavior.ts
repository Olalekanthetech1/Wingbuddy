import { Router, type Request, type Response } from "express";
import { behaviorRegistryService, type BehaviorKind } from "../services/behavior-registry.service";

const router = Router();
const validKind = (value: string): value is BehaviorKind => value === "mode" || value === "personality";

router.get("/behaviors", async (req: Request, res: Response) => {
  try {
    const kind = typeof req.query.kind === "string" && validKind(req.query.kind) ? req.query.kind : undefined;
    res.json(await behaviorRegistryService.list(kind));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.patch("/behaviors/:kind/:key", async (req: Request, res: Response) => {
  const { kind, key } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: "Invalid behavior kind" });
  try {
    res.json(await behaviorRegistryService.update(kind, key, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/behaviors/:kind/:key/default", async (req: Request, res: Response) => {
  const { kind, key } = req.params;
  if (!validKind(kind)) return res.status(400).json({ error: "Invalid behavior kind" });
  try {
    await behaviorRegistryService.setDefault(kind, key);
    res.json({ ok: true, kind, key });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
