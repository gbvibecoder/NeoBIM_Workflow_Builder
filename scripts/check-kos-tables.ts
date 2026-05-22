import { prisma } from '../src/lib/db';

async function main() {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name LIKE 'Kos%' 
    ORDER BY table_name
  `;
  console.log('KOS tables found:', tables.length);
  tables.forEach(t => console.log(' -', t.table_name));
  
  const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations 
    WHERE migration_name LIKE '%kos%' 
    ORDER BY started_at
  `;
  console.log('\nKOS migrations applied:', migrations.length);
  migrations.forEach(m => console.log(' -', m.migration_name));
}
main().finally(() => prisma.$disconnect());
