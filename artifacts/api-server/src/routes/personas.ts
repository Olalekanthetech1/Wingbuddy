import { Router, Request, Response } from "express";
import { personaService, AIPersona } from "../services/persona.service";
import { userTierService } from "../services/user-tier.service";
import { logger } from "../lib/logger";

const router = Router();

// 1. Get all personas & stats
router.get("/personas", async (_req: Request, res: Response) => {
  try {
    const [personas, stats] = await Promise.all([
      personaService.getAllPersonas(),
      personaService.getSummaryStats(),
    ]);
    res.json({
      success: true,
      stats,
      personas,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to list personas");
    res.status(500).json({ error: err.message || "Failed to list personas" });
  }
});

// 2. Get single persona
router.get("/personas/:id", async (req: Request, res: Response) => {
  try {
    const persona = await personaService.getPersonaById(req.params.id);
    if (!persona) {
      res.status(404).json({ error: `Persona '${req.params.id}' not found` });
      return;
    }
    res.json({ success: true, persona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create or save custom persona
router.post("/personas", async (req: Request, res: Response) => {
  try {
    const {
      id,
      name,
      emoji,
      tagline,
      systemPrompt,
      preferredModel,
      temperature,
      requiredTier,
      capabilities,
      enabled,
      sortOrder,
    } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Persona name is required" });
      return;
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      res.status(400).json({ error: "System prompt instructions are required" });
      return;
    }

    const saved = await personaService.savePersona({
      id: id ? String(id).trim().toLowerCase() : undefined,
      name: name.trim(),
      emoji: emoji ? String(emoji).trim() : "🎭",
      tagline: tagline ? String(tagline).trim() : undefined,
      systemPrompt: systemPrompt.trim(),
      preferredModel: preferredModel ? String(preferredModel).trim() : null,
      temperature: typeof temperature === "number" ? temperature : 0.7,
      requiredTier: ["free", "pro", "vip"].includes(requiredTier) ? requiredTier : "free",
      capabilities: Array.isArray(capabilities) ? capabilities : [],
      enabled: enabled !== false,
      sortOrder: typeof sortOrder === "number" ? sortOrder : undefined,
    });

    res.status(201).json({ success: true, persona: saved, message: `Persona '${saved.name}' saved` });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to create persona");
    res.status(500).json({ error: err.message || "Failed to create persona" });
  }
});

// 4. Update persona
router.put("/personas/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await personaService.getPersonaById(id);
    if (!existing) {
      res.status(404).json({ error: `Persona '${id}' not found` });
      return;
    }

    const {
      name,
      emoji,
      tagline,
      systemPrompt,
      preferredModel,
      temperature,
      requiredTier,
      capabilities,
      enabled,
      sortOrder,
    } = req.body || {};

    const updated = await personaService.savePersona({
      id,
      name: name !== undefined ? String(name).trim() : existing.name,
      emoji: emoji !== undefined ? String(emoji).trim() : existing.emoji,
      tagline: tagline !== undefined ? String(tagline).trim() : existing.tagline,
      systemPrompt: systemPrompt !== undefined ? String(systemPrompt).trim() : existing.systemPrompt,
      preferredModel: preferredModel !== undefined ? (preferredModel ? String(preferredModel).trim() : null) : existing.preferredModel,
      temperature: typeof temperature === "number" ? temperature : existing.temperature,
      requiredTier: ["free", "pro", "vip"].includes(requiredTier) ? requiredTier : existing.requiredTier,
      capabilities: Array.isArray(capabilities) ? capabilities : existing.capabilities,
      enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled,
      sortOrder: typeof sortOrder === "number" ? sortOrder : existing.sortOrder,
    });

    res.json({ success: true, persona: updated, message: `Persona '${updated.name}' updated` });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to update persona");
    res.status(500).json({ error: err.message || "Failed to update persona" });
  }
});

// 5. Toggle persona enabled state
router.patch("/personas/:id/toggle", async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body || {};
    const updated = await personaService.togglePersona(req.params.id, Boolean(enabled));
    if (!updated) {
      res.status(404).json({ error: `Persona '${req.params.id}' not found` });
      return;
    }
    res.json({ success: true, persona: updated, message: `Persona '${updated.name}' is now ${updated.enabled ? "active" : "disabled"}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete custom persona
router.delete("/personas/:id", async (req: Request, res: Response) => {
  try {
    const result = await personaService.deletePersona(req.params.id);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json({ success: true, message: result.message });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Reset personas to factory defaults
router.post("/personas/reset", async (_req: Request, res: Response) => {
  try {
    const personas = await personaService.resetToDefaults();
    res.json({ success: true, personas, message: "Reset to default personas successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Admin switch a user's active persona
router.post("/personas/switch-user", async (req: Request, res: Response) => {
  try {
    const { telegramUserId, personaId } = req.body || {};
    if (!telegramUserId || !personaId) {
      res.status(400).json({ error: "telegramUserId and personaId are required" });
      return;
    }
    const result = await personaService.setUserActivePersona(Number(telegramUserId), String(personaId));
    if (!result.success) {
      res.status(400).json({ error: result.error, requiresTier: result.requiresTier });
      return;
    }
    res.json({ success: true, message: `Switched user ${telegramUserId} to ${result.persona?.name}`, persona: result.persona });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
