import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  console.log("🌱 Database check starting...");
  const userCount = await prisma.user.count();
  console.log(`📊 Current registered users in PostgreSQL: ${userCount}`);
}

seed()
  .catch((err) => {
    console.error("❌ Seed check failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
