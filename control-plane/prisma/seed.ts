/**
 * Prisma seed script — run with: npx ts-node prisma/seed.ts
 * Idempotent via upsert. Seeds game types, default org, roles, and admin user.
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ─── Password hashing (same as auth.service.ts) ───────────────────────────
function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(salt + password).digest('hex');
}

function makePasswordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

// ─── Seed data ─────────────────────────────────────────────────────────────

const GAME_TYPES = [
  {
    slug: '7dtd',
    name: '7 Days to Die',
    capabilities: [
      'start',
      'stop',
      'restart',
      'status',
      'send_command',
      'kick_player',
      'ban_player',
      'get_log_path',
    ],
  },
  {
    slug: 'minecraft',
    name: 'Minecraft',
    capabilities: [
      'start',
      'stop',
      'restart',
      'status',
      'send_command',
      'kick_player',
      'ban_player',
    ],
  },
];

const DEFAULT_ORG = { name: 'Default', slug: 'default' };

const ROLES = ['admin', 'operator', 'viewer'] as const;

const ADMIN_USER = {
  email: 'admin@mastermind.local',
  password: 'changeme',
  name: 'Admin',
};

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding game types...');
  for (const gt of GAME_TYPES) {
    await prisma.gameType.upsert({
      where: { slug: gt.slug },
      update: { name: gt.name, capabilities: gt.capabilities },
      create: { slug: gt.slug, name: gt.name, capabilities: gt.capabilities },
    });
    console.log(`  ✓ GameType: ${gt.slug}`);
  }

  console.log('Seeding default org...');
  const org = await prisma.org.upsert({
    where: { slug: DEFAULT_ORG.slug },
    update: { name: DEFAULT_ORG.name },
    create: { name: DEFAULT_ORG.name, slug: DEFAULT_ORG.slug },
  });
  console.log(`  ✓ Org: ${org.slug} (${org.id})`);

  console.log('Seeding roles...');
  const roleMap: Record<string, { id: string; name: string }> = {};
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    roleMap[roleName] = role;
    console.log(`  ✓ Role: ${roleName}`);
  }

  console.log('Seeding admin user...');
  const existingUser = await prisma.user.findUnique({ where: { email: ADMIN_USER.email } });

  let adminUser: { id: string };
  if (existingUser) {
    adminUser = existingUser;
    console.log(`  ~ User already exists: ${ADMIN_USER.email}`);
  } else {
    adminUser = await prisma.user.create({
      data: {
        email: ADMIN_USER.email,
        name: ADMIN_USER.name,
        passwordHash: makePasswordHash(ADMIN_USER.password),
      },
    });
    console.log(`  ✓ Created user: ${ADMIN_USER.email}`);
  }

  // Ensure admin user is in the default org as admin
  const membership = await prisma.userOrg.findUnique({
    where: { userId_orgId: { userId: adminUser.id, orgId: org.id } },
  });

  if (!membership) {
    await prisma.userOrg.create({
      data: {
        userId: adminUser.id,
        orgId: org.id,
        roleId: roleMap['admin'].id,
      },
    });
    console.log(`  ✓ Added admin user to default org as admin`);
  } else {
    console.log(`  ~ Admin user already in default org`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
