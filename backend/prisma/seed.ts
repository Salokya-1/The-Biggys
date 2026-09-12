/**
 * Seed skeleton — idempotent (safe to run repeatedly).
 * The realistic demo dataset lands in Phase 3; this creates the minimum needed
 * to log in and to prove the pipeline works: a default grading scheme and the
 * four demo accounts.
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const DEMO_PASSWORD = 'Demo1234!';

const demoUsers: { email: string; name: string; role: Role }[] = [
  { email: 'admin@demo', name: 'Anita Shrestha (RTE Admin)', role: 'ADMIN' },
  { email: 'leader@demo', name: 'Bikash Rai (Module Leader)', role: 'MODULE_LEADER' },
  { email: 'lecturer@demo', name: 'Chetna Gurung (Lecturer)', role: 'LECTURER' },
  { email: 'student1@demo', name: 'Dipesh Karki', role: 'STUDENT' },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Default grading scheme — ASSUMPTION until the RTE mentor confirms the real rules.
  await prisma.gradingScheme.upsert({
    where: { name: 'Default (assumed)' },
    update: {},
    create: {
      name: 'Default (assumed)',
      passMark: 40,
      resitCap: 40,
      isDefault: true,
      bands: [
        { grade: 'A', min: 70 },
        { grade: 'B', min: 60 },
        { grade: 'C', min: 50 },
        { grade: 'D', min: 40 },
        { grade: 'F', min: 0 },
      ],
    },
  });

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, isActive: true },
      create: { ...u, passwordHash },
    });
  }

  console.log(`seeded ${demoUsers.length} demo users (password: ${DEMO_PASSWORD}) and default grading scheme`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
