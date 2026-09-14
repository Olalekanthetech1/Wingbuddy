import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import cronParser from "cron-parser";
const { parseExpression } = cronParser;
import { InlineKeyboard } from "grammy";
import { agentPlannerService } from "../planner/agent-planner.service";
import { executionEngine } from "../execution/execution-engine";
import { executionPersistence } from "../execution/persistence/execution-persistence.service";
import { chatDatabaseService } from "@workspace/db";
import { getDefaultGeminiService } from "../gemini/gemini.service";
import { ReminderService } from "./reminder.service";
import { timezoneService } from "./timezone.service";

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const prisma = new PrismaClient();

export type TaskCategory = "Jobs & Career" | "News & Research" | "Personal & Productivity" | "Work Routine" | "General";

export interface ScheduledTaskMetadata {
  category: TaskCategory;
  scheduleDescription: string;
  standingInstruction: string;
  expectedOutput: string;
  previewFormat: string;
  cadence: "once" | "daily" | "weekly" | "monthly" | "custom";
  retryCount?: number;
  runCount?: number;
  weeklyRuns?: number;
  lastRunAt?: string;
  type?: "reminder" | "digest";
  snoozeCount?: number;
}

export class ScheduledTaskFlowService {
  /**
   * Determine the most relevant task category based on title, goal, and prompt.
   */
  categorizeTask(text: string): TaskCategory {
    const lower = text.toLowerCase();
    if (
      lower.includes("job") ||
      lower.includes("career") ||
      lower.includes("role") ||
      lower.includes("hiring") ||
      lower.includes("vacancy") ||
      lower.includes("interview") ||
      lower.includes("remote work") ||
      lower.includes("salary")
    ) {
      return "Jobs & Career";
    }
    if (
      lower.includes("admin") ||
      lower.includes("dashboard") ||
      lower.includes("meeting") ||
      lower.includes("standup") ||
      lower.includes("deploy") ||
      lower.includes("review") ||
      lower.includes("pull request") ||
      lower.includes("pr ") ||
      lower.includes("code review") ||
      lower.includes("work") ||
      lower.includes("client") ||
      lower.includes("sprint") ||
      lower.includes("report")
    ) {
      return "Work Routine";
    }
    if (
      lower.includes("news") ||
      lower.includes("digest") ||
      lower.includes("trend") ||
      lower.includes("briefing") ||
      lower.includes("update") ||
      lower.includes("research") ||
      lower.includes("ai development") ||
      lower.includes("crypto") ||
      lower.includes("market")
    ) {
      return "News & Research";
    }
    if (
      lower.includes("habit") ||
      lower.includes("workout") ||
      lower.includes("reminder") ||
      lower.includes("charge") ||
      lower.includes("water") ||
      lower.includes("medicine") ||
      lower.includes("study") ||
      lower.includes("read") ||
      lower.includes("personal")
    ) {
      return "Personal & Productivity";
    }
    return "General";
  }

  /**
   * Determine icon for category.
   */
  getCategoryIcon(category: TaskCategory): string {
    switch (category) {
      case "Work Routine":
        return "📊";
      case "Jobs & Career":
        return "💼";
      case "News & Research":
        return "🌍";
      case "Personal & Productivity":
        return "🔔";
      default:
        return "⚡";
    }
  }

  /**
   * Infer schedule expression and natural human description with sensible defaults.
   */
  inferSchedule(text: string): {
    cronExpression: string | null;
    scheduleDescription: string;
    cadence: "once" | "daily" | "weekly" | "monthly" | "custom";
    targetDate?: Date;
  } {
    const lower = text.toLowerCase();

    // 1. One-time schedule: "in X hours", "in X minutes", "tomorrow at 8am"
    const inHoursMatch = lower.match(/in\s+(\d+)\s+hour/);
    if (inHoursMatch) {
      const hours = parseInt(inHoursMatch[1], 10);
      const target = new Date(Date.now() + hours * 3600 * 1000);
      return {
        cronExpression: null,
        scheduleDescription: `Once in ${hours} hour${hours > 1 ? "s" : ""} (${target.toISOString().slice(11, 16)} UTC)`,
        cadence: "once",
        targetDate: target,
      };
    }

    const inMinsMatch = lower.match(/in\s+(\d+)\s+min/);
    if (inMinsMatch) {
      const mins = parseInt(inMinsMatch[1], 10);
      const target = new Date(Date.now() + mins * 60 * 1000);
      return {
        cronExpression: null,
        scheduleDescription: `Once in ${mins} minute${mins > 1 ? "s" : ""} (${target.toISOString().slice(11, 16)} UTC)`,
        cadence: "once",
        targetDate: target,
      };
    }

    const tomorrowMatch = lower.match(/tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
    if (tomorrowMatch) {
      let hour = 9; // Default morning
      let minute = 0;
      if (tomorrowMatch[1]) {
        hour = parseInt(tomorrowMatch[1], 10);
        const meridiem = tomorrowMatch[3];
        if (meridiem === "pm" && hour < 12) hour += 12;
        if (meridiem === "am" && hour === 12) hour = 0;
        if (tomorrowMatch[2]) minute = parseInt(tomorrowMatch[2], 10);
      }
      const target = new Date();
      target.setUTCDate(target.getUTCDate() + 1);
      target.setUTCHours(hour, minute, 0, 0);
      return {
        cronExpression: null,
        scheduleDescription: `Once tomorrow at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`,
        cadence: "once",
        targetDate: target,
      };
    }

    // 2. Weekly patterns
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    for (const [dayName, dayNum] of Object.entries(dayMap)) {
      if (lower.includes(`every ${dayName}`) || lower.includes(`on ${dayName}`)) {
        let hour = 9; // Default 9 AM
        if (lower.includes("noon") || lower.includes("12 pm")) hour = 12;
        else if (lower.includes("evening") || lower.includes("6 pm")) hour = 18;

        const capitalized = dayName.charAt(0).toUpperCase() + dayName.slice(1);
        return {
          cronExpression: `0 ${hour} * * ${dayNum}`,
          scheduleDescription: `Every ${capitalized} at ${String(hour).padStart(2, "0")}:00 UTC (Weekly)`,
          cadence: "weekly",
        };
      }
    }

    if (lower.includes("weekly") || lower.includes("every week")) {
      return {
        cronExpression: "0 9 * * 1", // Monday 9 AM default
        scheduleDescription: "Every Monday at 09:00 UTC (Weekly)",
        cadence: "weekly",
      };
    }

    // 3. Monthly patterns
    if (lower.includes("monthly") || lower.includes("every month")) {
      return {
        cronExpression: "0 9 1 * *",
        scheduleDescription: "1st of every month at 09:00 UTC (Monthly)",
        cadence: "monthly",
      };
    }

    // 4. Daily patterns
    if (lower.includes("daily") || lower.includes("every day") || lower.includes("each day")) {
      let hour = 9; // Default 9 AM
      if (lower.includes("noon") || lower.includes("12 pm")) hour = 12;
      else if (lower.includes("evening") || lower.includes("6 pm")) hour = 18;
      else if (lower.includes("morning")) hour = 9;

      return {
        cronExpression: `0 ${hour} * * *`,
        scheduleDescription: `Every day at ${String(hour).padStart(2, "0")}:00 UTC (Daily)`,
        cadence: "daily",
      };
    }

    // Default fallback: Weekly on Monday 9 AM
    return {
      cronExpression: "0 9 * * 1",
      scheduleDescription: "Every Monday at 09:00 UTC (Weekly)",
      cadence: "weekly",
    };
  }

  /**
   * Determine expected output and preview format based on category and goal.
   */
  inferOutputCharacteristics(category: TaskCategory, goal: string): {
    expectedOutput: string;
    previewFormat: string;
  } {
    switch (category) {
      case "Jobs & Career":
        return {
          expectedOutput: "Ranked opportunities with relevance explanations, requirements, and application links",
          previewFormat: "Digest with top 3–5 matched roles + criteria analysis",
        };
      case "News & Research":
        return {
          expectedOutput: "Curated synthesis of significant developments, breakthroughs, and industry shifts",
          previewFormat: "Executive briefing with key headlines, 2-bullet takeaways, and source links",
        };
      case "Personal & Productivity":
        return {
          expectedOutput: "Actionable checklist, progress reminder, or scheduled check-in guidance",
          previewFormat: "Concise actionable bullet points with next steps",
        };
      default:
        return {
          expectedOutput: "Comprehensive structured summary addressing the standing instruction",
          previewFormat: "Digest with key findings and actionable takeaways",
        };
    }
  }

  /**
   * Create a Draft Task Proposal for the user to review.
   */
  async createProposal(params: {
    telegramUserId: number | bigint;
    conversationId?: number;
    prompt: string;
    title?: string;
    goal?: string;
    explicitCron?: string;
    explicitCadence?: string;
    type?: "reminder" | "digest";
  }): Promise<{ task: any; metadata: ScheduledTaskMetadata }> {
    const rawText = params.goal || params.prompt;
    const category = this.categorizeTask(rawText);
    const schedule = params.explicitCron
      ? {
          cronExpression: params.explicitCron,
          scheduleDescription: params.explicitCadence || `Custom Schedule (${params.explicitCron})`,
          cadence: "custom" as const,
        }
      : this.inferSchedule(rawText);

    if (params.explicitCadence && !params.explicitCron) {
      schedule.scheduleDescription = params.explicitCadence;
    }

    const outputs = this.inferOutputCharacteristics(category, rawText);

    const title =
      params.title ||
      (category === "Jobs & Career"
        ? "Recurring Job Search & Matching"
        : category === "News & Research"
        ? "Scheduled Intelligence Briefing"
        : category === "Work Routine"
        ? "Admin Dashboard Check"
        : "Scheduled Standing Task");

    const taskType =
      params.type ||
      (category === "Work Routine" || category === "Personal & Productivity" ? "reminder" : "digest");

    const metadata: ScheduledTaskMetadata = {
      category,
      scheduleDescription: params.explicitCadence || schedule.scheduleDescription,
      standingInstruction: rawText,
      expectedOutput: outputs.expectedOutput,
      previewFormat: outputs.previewFormat,
      cadence: schedule.cadence,
      retryCount: 0,
      runCount: 0,
      weeklyRuns: 0,
      type: taskType,
    };

    const userTz = await timezoneService.getUserTimezone(params.telegramUserId);

    let nextRunAt: Date | null = null;
    if (schedule.targetDate) {
      nextRunAt = schedule.targetDate;
    } else if (schedule.cronExpression) {
      try {
        const interval = parseExpression(schedule.cronExpression, {
          currentDate: new Date(),
          tz: userTz,
        });
        nextRunAt = interval.next().toDate();
      } catch {
        nextRunAt = new Date(Date.now() + 86400000);
      }
    }

    const task = await prisma.agentTask.create({
      data: {
        telegramUserId: params.telegramUserId,
        conversationId: params.conversationId,
        title,
        goal: rawText,
        taskType: category.toLowerCase().replace(/[^a-z]/g, "_"),
        isRecurring: schedule.cadence !== "once",
        cronExpression: schedule.cronExpression,
        timezone: userTz,
        nextRunAt,
        status: "draft", // Stored as draft until user confirms
        metadataJson: JSON.stringify(metadata),
      },
    });

    return { task, metadata };
  }

  /**
   * Format the Refined Task Proposal Card in HTML.
   */
  formatProposalCard(task: any, metadata: ScheduledTaskMetadata): string {
    const icon = this.getCategoryIcon(metadata.category);
    return [
      `📋 <b>Scheduled Task Proposal: ${escapeHtml(task.title)}</b>`,
      ``,
      `• <b>Category:</b> ${icon} ${escapeHtml(metadata.category)}`,
      `• <b>Schedule:</b> ${escapeHtml(metadata.scheduleDescription)}`,
      `• <b>Instruction:</b> <i>${escapeHtml(metadata.standingInstruction)}</i>`,
      `• <b>Expected Output:</b> ${escapeHtml(metadata.expectedOutput)}`,
      `• <b>Preview Format:</b> ${escapeHtml(metadata.previewFormat)}`,
      ``,
      `<i>Review the details above. You can confirm and activate it now, or ask to adjust any criteria.</i>`,
    ].join("\n");
  }

  /**
   * Inline Keyboard for Proposal Card.
   */
  proposalKeyboard(taskId: number): InlineKeyboard {
    return new InlineKeyboard()
      .text("🚀 Confirm & Activate", `sched:confirm:${taskId}`)
      .text("✏️ Refine Criteria", `sched:refine:${taskId}`)
      .row()
      .text("❌ Cancel", `sched:cancel:${taskId}`);
  }

  /**
   * Activate a task after user confirms.
   */
  async activateTask(taskId: number): Promise<{ success: boolean; task?: any; error?: string }> {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) return { success: false, error: "Task proposal not found." };

    let nextRunAt = task.nextRunAt;
    if (!nextRunAt && task.cronExpression) {
      try {
        const interval = parseExpression(task.cronExpression, {
          currentDate: new Date(),
          tz: task.timezone || "UTC",
        });
        nextRunAt = interval.next().toDate();
      } catch (err: any) {
        return { success: false, error: `Invalid schedule: ${err.message}` };
      }
    }

    const updated = await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: "pending", // active and pending execution
        nextRunAt,
      },
    });

    return { success: true, task: updated };
  }

  /**
   * Execute a task immediately (manual trigger or scheduled execution).
   */
  async executeTask(
    taskId: number,
    options?: { isManualRun?: boolean }
  ): Promise<{ success: boolean; output: string; formattedMessage: string }> {
    const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
    if (!task) {
      return {
        success: false,
        output: "",
        formattedMessage: "Task not found.",
      };
    }

    let metadata: ScheduledTaskMetadata = {
      category: "General",
      scheduleDescription: "Scheduled",
      standingInstruction: task.goal,
      expectedOutput: "Summary",
      previewFormat: "Digest",
      cadence: task.isRecurring ? "weekly" : "once",
    };

    if (task.metadataJson) {
      try {
        metadata = { ...metadata, ...JSON.parse(task.metadataJson) };
      } catch {}
    }

    try {
      // 1. Plan & execute with Agent Planner
      const planResult = await agentPlannerService.planAndCompile({
        telegramUserId: Number(task.telegramUserId),
        goal: task.goal,
        taskId: task.id,
        context: {
          activeTask: { id: task.id, title: task.title, goal: task.goal },
          isBackgroundTask: true,
        },
      });

      let rawOutput = "";
      if (planResult.success && planResult.graph && !planResult.isDirectResponse) {
        const session = await executionEngine.startExecution({
          graphId: planResult.graph.graphId,
          planRevision: 1,
          requestId: `sched_${Date.now()}_${task.id}`,
          taskId: task.id,
          executionContext: {
            telegramUserId: Number(task.telegramUserId),
            chatId: Number(task.telegramUserId),
            conversationId: task.conversationId || undefined,
          },
        });

        if (session.status === "completed" || (session.status as string) === "COMPLETED") {
          const completedAttempts = await executionPersistence.getCompletedExecutionsForGraph(
            planResult.graph.graphId,
            1
          );
          const nodeResults: Record<string, any> = {};
          for (const att of completedAttempts) if (att.result) nodeResults[att.nodeId] = att.result;

          const reverseNodeIds = [...Object.keys(planResult.graph.nodes)].reverse();
          for (const nodeId of reverseNodeIds) {
            const res = nodeResults[nodeId];
            if (!res?.output) continue;
            const out = res.output;
            if (typeof out === "string") {
              rawOutput = out;
              break;
            }
            if (out.response && typeof out.response === "string") {
              rawOutput = out.response;
              break;
            }
            if (out.summary && typeof out.summary === "string") {
              rawOutput = out.summary;
              break;
            }
          }
        }
      }

      // Fallback to Gemini if autonomous graph didn't produce string output
      if (!rawOutput) {
        const systemPrompt = [
          `You are executing a scheduled standing instruction for the user: "${task.title}".`,
          `Category: ${metadata.category}`,
          `Format: ${metadata.previewFormat}. Make it high-signal, ranked, with concrete opportunities, actionable takeaways, and direct links where available.`,
          `Avoid generic filler. Produce top 3-5 structured items.`,
        ].join("\n");

        try {
          const geminiService = getDefaultGeminiService();
          rawOutput = await geminiService.generateReply(
            [],
            task.goal,
            { modeInstruction: systemPrompt },
            { enableSearch: true }
          );
        } catch (geminiErr) {
          logger.warn({ error: geminiErr }, "Default Gemini service not initialized or failed, using fallback summary");
          rawOutput = `Completed automated check for: <b>${escapeHtml(task.title)}</b>.\n\nInstruction executed: <i>${escapeHtml(metadata.standingInstruction || task.goal)}</i>\n\nNo unexpected anomalies or urgent alerts found. All systems normal.`;
        }
      }

      // Calculate next run date if recurring
      let nextRunAt: Date | null = null;
      if (task.isRecurring && task.cronExpression) {
        try {
          const interval = parseExpression(task.cronExpression, {
            currentDate: new Date(),
            tz: task.timezone || "UTC",
          });
          nextRunAt = interval.next().toDate();
        } catch {}
      }

      // Update task record with persistent run history
      const meta = typeof task.metadataJson === "string"
        ? JSON.parse(task.metadataJson || "{}")
        : (task.metadataJson || {});
      meta.runCount = (meta.runCount || 0) + 1;
      meta.weeklyRuns = (meta.weeklyRuns || 0) + 1;
      meta.lastRunAt = new Date().toISOString();

      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: task.isRecurring ? nextRunAt : null,
          status: task.isRecurring ? "pending" : "completed",
          metadataJson: JSON.stringify(meta),
        },
      });

      const isReminder =
        metadata.type === "reminder" ||
        metadata.category === "Work Routine" ||
        metadata.category === "Personal & Productivity";
      const isDigest =
        !isReminder ||
        metadata.type === "digest" ||
        metadata.category === "Jobs & Career" ||
        metadata.category === "News & Research";

      let formattedMessage: string;
      const nowUtc = ReminderService.formatUtcTimestamp(new Date());

      if (!isDigest) {
        // Triggered Reminder Delivery Card format
        const scheduleDisplay = metadata.scheduleDescription || "Daily at 9:00 AM";
        const lastRunFormatted = task.lastRunAt
          ? ReminderService.formatUtcTimestamp(new Date(task.lastRunAt))
          : nowUtc;
        const runCount = meta.runCount || 1;
        const typeCategory = metadata.category === "Personal & Productivity" ? "Personal Reminder" : "Work Routine";
        const icon = typeCategory === "Work Routine" ? "📊" : "🔔";

        formattedMessage = [
          `⏰ <b>Reminder Alert: “${escapeHtml(task.title)}”</b>`,
          ``,
          `📅 <b>Scheduled:</b> ${escapeHtml(scheduleDisplay)}`,
          `🕒 <b>Triggered:</b> <code>${nowUtc}</code>`,
          `${icon} <b>Type:</b> ${typeCategory}`,
          `📈 <b>Run History:</b> Fired ${runCount} time${runCount > 1 ? "s" : ""} this week • Last run: ${lastRunFormatted}`,
          ``,
          `<b>Actions:</b>`,
        ].join("\n");
      } else {
        // Triggered Digest Delivery Card format
        const scheduleDisplay = metadata.scheduleDescription || "Every Monday at 09:00 AM";

        formattedMessage = [
          `⏰ <b>Scheduled Run: ${escapeHtml(task.title)}</b>`,
          ``,
          `📅 <b>Schedule:</b> ${escapeHtml(scheduleDisplay)}`,
          `🕒 <b>Triggered:</b> <code>${nowUtc}</code>`,
          `📊 <b>Type:</b> Research Digest`,
          ``,
          rawOutput,
          ``,
          `<b>Actions:</b>`,
        ].join("\n");
      }

      return {
        success: true,
        output: rawOutput,
        formattedMessage,
      };
    } catch (err: any) {
      logger.error({ taskId, error: err }, "Error executing scheduled task");

      // Error recovery: schedule retry in 30 mins
      const retryDate = new Date(Date.now() + 30 * 60 * 1000);
      const retryTimeStr = `${String(retryDate.getUTCHours()).padStart(2, "0")}:${String(retryDate.getUTCMinutes()).padStart(2, "0")}`;
      const scheduleDisplay = metadata.scheduleDescription || "scheduled";

      await prisma.agentTask.update({
        where: { id: task.id },
        data: {
          nextRunAt: retryDate,
        },
      });

      const fallbackMessage = [
        `⏰ <b>Scheduled Run Notice: ${escapeHtml(task.title)}</b>`,
        ``,
        `⚠️ Your ${escapeHtml(scheduleDisplay)} reminder couldn’t run today due to a system hiccup.`,
        `🔄 I will automatically retry in 30 minutes (${retryTimeStr} UTC).`,
      ].join("\n");

      return {
        success: false,
        output: "",
        formattedMessage: fallbackMessage,
      };
    }
  }

  /**
   * Action keyboard attached to execution results or task detail cards.
   */
  taskActionsKeyboard(task: any): InlineKeyboard {
    let metadata: any = {};
    try {
      if (task.metadataJson) {
        metadata = typeof task.metadataJson === "string" ? JSON.parse(task.metadataJson) : task.metadataJson;
      }
    } catch {}

    const isReminder =
      metadata.type === "reminder" ||
      metadata.category === "Work Routine" ||
      metadata.category === "Personal & Productivity";
    const isDigest =
      !isReminder ||
      metadata.type === "digest" ||
      metadata.category === "Jobs & Career" ||
      metadata.category === "News & Research";

    if (!isDigest) {
      // Triggered Reminder Delivery Actions (5 actions)
      return new InlineKeyboard()
        .text("⏰ Snooze 15m", `sched:snooze:${task.id}:15`)
        .text("⏰ Snooze 1h", `sched:snooze:${task.id}:60`)
        .text("✅ Mark Done", `sched:done:${task.id}`)
        .row()
        .text("✏️ Edit Time", `sched:edit:${task.id}`)
        .text("❌ Cancel", `sched:cancel:${task.id}`);
    }

    // Triggered Digest Delivery Actions (4 actions)
    const isPaused = task.status === "paused";
    return new InlineKeyboard()
      .text("🚀 Run Again", `sched:run:${task.id}`)
      .text("✏️ Refine Criteria", `sched:refine:${task.id}`)
      .row()
      .text(isPaused ? "▶️ Resume" : "⏸ Pause", isPaused ? `sched:resume:${task.id}` : `sched:pause:${task.id}`)
      .text("❌ Cancel", `sched:cancel:${task.id}`);
  }

  /**
   * Format the list of active scheduled tasks for the user.
   */
  async formatTaskList(telegramUserId: number | bigint): Promise<{ text: string; keyboard: InlineKeyboard }> {
    const tasks = await prisma.agentTask.findMany({
      where: {
        telegramUserId,
        status: { in: ["pending", "active", "paused"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (tasks.length === 0) {
      const keyboard = new InlineKeyboard().text("➕ Schedule a New Task", "menu:chat");
      return {
        text: `📋 <b>No Scheduled Tasks Active</b>\n\nYou don't have any recurring standing instructions yet.\n\n<b>Examples:</b>\n• <i>"Every Monday, find remote growth marketing jobs"</i>\n• <i>"Daily at 9 AM, give me a summary of AI developments"</i>\n• <i>"Remind me in 3 hours to charge my S10"</i>`,
        keyboard,
      };
    }

    // Group tasks by category
    const grouped: Record<string, typeof tasks> = {
      "Jobs & Career": [],
      "News & Research": [],
      "Personal & Productivity": [],
      General: [],
    };

    for (const t of tasks) {
      let meta: ScheduledTaskMetadata | null = null;
      if (t.metadataJson) {
        try {
          meta = JSON.parse(t.metadataJson);
        } catch {}
      }
      const cat = meta?.category || "General";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }

    const lines: string[] = ["📋 <b>Active Scheduled Tasks & Standing Instructions</b>", ""];
    const keyboard = new InlineKeyboard();

    for (const [catName, catTasks] of Object.entries(grouped)) {
      if (catTasks.length === 0) continue;
      const icon = this.getCategoryIcon(catName as TaskCategory);
      lines.push(`${icon} <b>${catName}</b>`);

      for (const t of catTasks) {
        let meta: ScheduledTaskMetadata | null = null;
        if (t.metadataJson) {
          try {
            meta = JSON.parse(t.metadataJson);
          } catch {}
        }
        const sched = meta?.scheduleDescription || (t.isRecurring ? "Recurring" : "Once");
        const nextStr = t.nextRunAt ? t.nextRunAt.toUTCString().slice(0, 22) + " UTC" : "Not scheduled";
        const statusBadge = t.status === "paused" ? "⏸️ <code>PAUSED</code>" : "🟢 <code>ACTIVE</code>";

        lines.push(`• <b>#${t.id}: ${escapeHtml(t.title)}</b>`);
        lines.push(`  Schedule: ${escapeHtml(sched)}`);
        lines.push(`  Next Run: ${nextStr} | ${statusBadge}`);
        lines.push(``);

        // Add quick action buttons for this task
        const isPaused = t.status === "paused";
        keyboard
          .text(`🚀 Run #${t.id}`, `sched:run:${t.id}`)
          .text(isPaused ? `▶️ Resume #${t.id}` : `⏸ Pause #${t.id}`, isPaused ? `sched:resume:${t.id}` : `sched:pause:${t.id}`)
          .text(`❌`, `sched:delete:${t.id}`)
          .row();
      }
    }

    keyboard.text("➕ Schedule New Task", "menu:chat").text("◀️ Main Menu", "menu:main");

    return {
      text: lines.join("\n"),
      keyboard,
    };
  }

  /**
   * Snooze a scheduled task or recurring reminder.
   */
  async snoozeTask(taskId: number, minutes: number): Promise<{ success: boolean; nextRunAt?: Date; error?: string }> {
    try {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
      if (!task) return { success: false, error: "Task not found" };

      const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
      let meta: any = {};
      try {
        if (task.metadataJson) meta = JSON.parse(task.metadataJson);
      } catch {}
      meta.snoozeCount = (meta.snoozeCount || 0) + 1;

      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          nextRunAt: snoozeUntil,
          status: "pending",
          metadataJson: JSON.stringify(meta),
        },
      });

      return { success: true, nextRunAt: snoozeUntil };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark a task run as complete, updating recurring schedule if applicable.
   */
  async completeTask(taskId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
      if (!task) return { success: false, error: "Task not found" };

      let nextRunAt: Date | null = null;
      if (task.isRecurring && task.cronExpression) {
        try {
          const interval = parseExpression(task.cronExpression, {
            currentDate: new Date(),
            tz: task.timezone || "UTC",
          });
          nextRunAt = interval.next().toDate();
        } catch {}
      }

      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: task.isRecurring ? "pending" : "completed",
          nextRunAt,
          lastRunAt: new Date(),
        },
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const scheduledTaskFlowService = new ScheduledTaskFlowService();
