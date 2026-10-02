import { describe, expect, it, vi, beforeEach } from "vitest";
import { cronTaskService } from "../src/services/cron-task.service";

describe("CronTaskService - Weekly Database Snapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts admin user IDs from environment variables", () => {
    const originalEnv = process.env.ADMIN_TELEGRAM_ID;
    const originalList = process.env.ADMIN_USER_IDS;

    process.env.ADMIN_TELEGRAM_ID = "987654321";
    process.env.ADMIN_USER_IDS = "111222333, 444555666";

    const adminIds = cronTaskService.getAdminUserIds();
    expect(adminIds).toContain(987654321);
    expect(adminIds).toContain(111222333);
    expect(adminIds).toContain(444555666);

    // Restore
    if (originalEnv !== undefined) process.env.ADMIN_TELEGRAM_ID = originalEnv;
    else delete process.env.ADMIN_TELEGRAM_ID;

    if (originalList !== undefined) process.env.ADMIN_USER_IDS = originalList;
    else delete process.env.ADMIN_USER_IDS;
  });

  it("executes weekly database snapshot and dispatches notification when bot is attached", async () => {
    const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 123 });
    const mockBot = {
      api: {
        sendMessage: mockSendMessage,
      },
    } as any;

    cronTaskService.attachBot(mockBot);

    const snapshot = await cronTaskService.triggerWeeklyDatabaseSnapshot(999888777);

    expect(snapshot.status).toBe("success");
    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.counts).toBeDefined();
    expect(typeof snapshot.counts.users).toBe("number");
    expect(typeof snapshot.counts.messages).toBe("number");
    expect(snapshot.notifiedAdminIds).toContain(999888777);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [targetChatId, messageText, options] = mockSendMessage.mock.calls[0];
    expect(targetChatId).toBe(999888777);
    expect(messageText).toContain("Weekly Database Snapshot Completed");
    expect(messageText).toContain("Live Entity Summary:");
    expect(options.parse_mode).toBe("HTML");

    cronTaskService.detachBot();
  });
});
