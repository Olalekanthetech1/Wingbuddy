import { Router, type IRouter, type Request, type Response } from "express";
import { proactiveAssistantService, type ProactivePeriod } from "../services/proactive-assistant.service";

const router: IRouter = Router();

function period(value: unknown): ProactivePeriod | undefined {
  return value === "morning" || value === "evening" ? value : undefined;
}

router.get("/proactive-assistant/config", async (_req: Request, res: Response) => {
  try { res.json({ config: await proactiveAssistantService.getConfig() }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.patch("/proactive-assistant/config", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const patch = {
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.morningEnabled === "boolean" ? { morningEnabled: body.morningEnabled } : {}),
      ...(typeof body.morningTime === "string" ? { morningTime: body.morningTime } : {}),
      ...(typeof body.eveningEnabled === "boolean" ? { eveningEnabled: body.eveningEnabled } : {}),
      ...(typeof body.eveningTime === "string" ? { eveningTime: body.eveningTime } : {}),
      ...(typeof body.timezone === "string" ? { timezone: body.timezone } : {}),
      ...(typeof body.dailyMessageLimit === "number" ? { dailyMessageLimit: body.dailyMessageLimit } : {}),
      ...(typeof body.quietHoursStart === "string" ? { quietHoursStart: body.quietHoursStart } : {}),
      ...(typeof body.quietHoursEnd === "string" ? { quietHoursEnd: body.quietHoursEnd } : {}),
      ...(typeof body.maxMessageChars === "number" ? { maxMessageChars: body.maxMessageChars } : {}),
    };
    res.json({ message: "Proactive Assistant configuration saved to PostgreSQL", config: await proactiveAssistantService.updateConfig(patch) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.get("/proactive-assistant/status", async (_req: Request, res: Response) => {
  try { res.json(await proactiveAssistantService.getStatus()); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/proactive-assistant/preview", async (req: Request, res: Response) => {
  try {
    const userId = Number(req.body?.userId);
    const selectedPeriod = period(req.body?.period);
    if (!Number.isSafeInteger(userId) || !selectedPeriod) { res.status(400).json({ error: "Valid userId and period (morning|evening) are required" }); return; }
    res.json(await proactiveAssistantService.preview(userId, selectedPeriod));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/proactive-assistant/test", async (req: Request, res: Response) => {
  try {
    const userId = Number(req.body?.userId);
    const selectedPeriod = period(req.body?.period);
    if (!Number.isSafeInteger(userId) || !selectedPeriod) { res.status(400).json({ error: "Valid userId and period (morning|evening) are required" }); return; }
    res.json({ message: "Test message sent", ...(await proactiveAssistantService.sendTest(userId, selectedPeriod)) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

export default router;
