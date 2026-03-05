import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL
});

const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const result = await prisma.user.update({
      where: { email: 'erolerutik9@gmail.com' },
      data: { role: 'PRO' }
    });
    console.log('✅ User upgraded to PRO:', result.email, result.role);
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
