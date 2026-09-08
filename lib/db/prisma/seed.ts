import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resolveTargetUserId(): Promise<{ userId: bigint; chatId: bigint; shouldReset: boolean }> {
  const envUserId = process.env.SEED_USER_ID;
  const envAdminIds = process.env.ADMIN_USER_IDS?.split(",")[0]?.trim();
  const shouldReset = process.env.SEED_RESET === "true" || process.argv.includes("--reset");

  if (envUserId) {
    const uid = BigInt(envUserId.trim());
    return {
      userId: uid,
      chatId: process.env.SEED_CHAT_ID ? BigInt(process.env.SEED_CHAT_ID.trim()) : uid,
      shouldReset,
    };
  }

  // Dynamically adapt to an existing database user if one is already registered
  try {
    const existingUser = await prisma.user.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    if (existingUser) {
      return {
        userId: existingUser.telegramUserId,
        chatId: process.env.SEED_CHAT_ID ? BigInt(process.env.SEED_CHAT_ID.trim()) : existingUser.telegramUserId,
        shouldReset,
      };
    }
  } catch {}

  if (envAdminIds) {
    const adminUid = BigInt(envAdminIds);
    return {
      userId: adminUid,
      chatId: process.env.SEED_CHAT_ID ? BigInt(process.env.SEED_CHAT_ID.trim()) : adminUid,
      shouldReset,
    };
  }

  // Dynamic timestamp-based ID fallback
  const generatedId = BigInt(Math.floor(Date.now() / 1000));
  return {
    userId: generatedId,
    chatId: generatedId,
    shouldReset,
  };
}

const DEFAULT_MEMORIES = [
  {
    key: "preferred_name",
    content: "Alex",
    category: "preference",
  },
  {
    key: "preferred_programming_language",
    content: "TypeScript and Node.js with modern async paradigms",
    category: "preference",
  },
  {
    key: "time_zone",
    content: "UTC/PST dynamic localized offset",
    category: "context",
  },
  {
    key: "response_formatting",
    content: "Use clean Markdown/HTML formatting, bullet points, and high-contrast code snippets.",
    category: "instruction",
  },
  {
    key: "project_architecture",
    content: "Full-stack Telegram AI assistant powered by Gemini 2.5/Flash and PostgreSQL with Prisma & Drizzle ORM.",
    category: "fact",
  },
];

const DEFAULT_SAMPLE_CONVERSATION = [
  {
    role: "user",
    content: "Hello! What can you help me with today?",
  },
  {
    role: "model",
    content: "Hey there! 👋 I am your proactive AI assistant powered by Gemini. I can help you with coding, creative brainstorms, research analysis, scheduling reminders, and remembering your preferences!",
  },
  {
    role: "user",
    content: "Can you remind me about our team sync tomorrow at 10am?",
  },
  {
    role: "model",
    content: "Done! ⏰ I've scheduled a reminder for tomorrow at 10:00 AM: 'Team sync'. I'll proactively notify you right here!",
  },
];

async function seed() {
  const target = await resolveTargetUserId();
  console.log("🌱 Starting Database Seeding...");
  console.log(`👤 Target User ID: ${target.userId}`);
  console.log(`💬 Target Chat ID: ${target.chatId}`);

  if (target.shouldReset) {
    console.log("🧹 Resetting target user's existing records...");
    await prisma.user.deleteMany({
      where: { telegramUserId: target.userId },
    });
  }

  // 1. Seed or Upsert Target User Profile
  console.log("1️⃣ Seeding User Profile...");
  const user = await prisma.user.upsert({
    where: { telegramUserId: target.userId },
    update: {
      personality: process.env.SEED_PERSONALITY || "playful",
      mode: process.env.SEED_MODE || "general",
      username: process.env.SEED_USERNAME || "telegram_ai_user",
      firstName: process.env.SEED_FIRST_NAME || "Alex",
    },
    create: {
      telegramUserId: target.userId,
      username: process.env.SEED_USERNAME || "telegram_ai_user",
      firstName: process.env.SEED_FIRST_NAME || "Alex",
      personality: process.env.SEED_PERSONALITY || "playful",
      mode: process.env.SEED_MODE || "general",
    },
  });
  console.log(`✅ User profile established: ${user.firstName} (@${user.username || "n/a"})`);

  // 2. Seed Default Knowledge Base & Long-Term Memories
  console.log("2️⃣ Seeding Long-Term Memories...");
  for (const mem of DEFAULT_MEMORIES) {
    await prisma.userMemory.upsert({
      where: {
        telegramUserId_key: {
          telegramUserId: target.userId,
          key: mem.key,
        },
      },
      update: {
        content: mem.content,
        category: mem.category,
      },
      create: {
        telegramUserId: target.userId,
        key: mem.key,
        content: mem.content,
        category: mem.category,
      },
    });
    console.log(`   🧠 Memory seeded: [${mem.category}] ${mem.key}`);
  }

  // 3. Seed Sample Active Conversation & Message History
  console.log("3️⃣ Seeding Sample Multi-Turn Conversation...");
  const conversation = await prisma.conversation.upsert({
    where: {
      telegramUserId_chatId: {
        telegramUserId: target.userId,
        chatId: target.chatId,
      },
    },
    update: {
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      telegramUserId: target.userId,
      chatId: target.chatId,
      isActive: true,
    },
  });

  const existingMessageCount = await prisma.message.count({
    where: { conversationId: conversation.id },
  });

  if (existingMessageCount === 0) {
    for (const msg of DEFAULT_SAMPLE_CONVERSATION) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: msg.role,
          content: msg.content,
        },
      });
    }
    console.log(`   💬 Seeded ${DEFAULT_SAMPLE_CONVERSATION.length} sample messages in session #${conversation.id}`);
  } else {
    console.log(`   💬 Conversation session #${conversation.id} already has ${existingMessageCount} messages; preserved.`);
  }

  // 4. Seed Proactive Sample Reminders
  console.log("4️⃣ Seeding Proactive Reminders...");
  const sampleReminders = [
    {
      prompt: "Review quarterly project roadmap & milestones",
      dueAt: new Date(Date.now() + 60 * 60 * 1000), // In 1 hour
      isCompleted: false,
    },
    {
      prompt: "Daily proactive hydration & stretch break",
      dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // In 4 hours
      isCompleted: false,
    },
  ];

  for (const r of sampleReminders) {
    const existing = await prisma.reminder.findFirst({
      where: {
        telegramUserId: target.userId,
        prompt: r.prompt,
        isCompleted: false,
      },
    });

    if (!existing) {
      await prisma.reminder.create({
        data: {
          telegramUserId: target.userId,
          chatId: target.chatId,
          prompt: r.prompt,
          dueAt: r.dueAt,
          isCompleted: r.isCompleted,
        },
      });
      console.log(`   ⏰ Reminder created: "${r.prompt}" due at ${r.dueAt.toISOString()}`);
    } else {
      console.log(`   ⏰ Reminder already exists: "${r.prompt}"`);
    }
  }

  console.log("✨ Database seeding completed successfully!");
}

seed()
  .catch((err) => {
    console.error("❌ Seeding failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
