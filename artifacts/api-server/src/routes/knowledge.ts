import { Router } from "express";
import { knowledgeVaultService } from "../services/knowledge-vault.service";

const router = Router();

// For dashboard testing, we use a generic user ID. In production it's linked to the Telegram User ID.
const DEFAULT_USER = "admin";

router.get("/knowledge", async (req, res) => {
  try {
    const docs = await knowledgeVaultService.listDocuments(DEFAULT_USER);
    res.json({ documents: docs });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post("/knowledge", async (req, res) => {
  try {
    const { filename, mimeType, content } = req.body;
    if (!filename || !content) {
      return res.status(400).json({ error: "filename and content are required" });
    }
    const id = await knowledgeVaultService.uploadDocument(DEFAULT_USER, filename, mimeType || "text/plain", content);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete("/knowledge/:id", async (req, res) => {
  try {
    await knowledgeVaultService.deleteDocument(DEFAULT_USER, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// A test endpoint to query the vault
router.post("/knowledge/search", async (req, res) => {
  try {
    const { query } = req.body;
    const results = await knowledgeVaultService.searchSimilar(DEFAULT_USER, query);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
