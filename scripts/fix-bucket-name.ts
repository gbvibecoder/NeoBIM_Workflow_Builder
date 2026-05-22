import { prisma } from '../src/lib/db';

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'kalzen' } });
  if (!tenant) {
    console.log('Tenant not found');
    return;
  }
  console.log('Before:', tenant.s3Config);
  
  const newConfig = {
    ...(tenant.s3Config as object),
    bucket: 'kalzen-kos-dev',
  };
  
  await prisma.tenant.update({
    where: { slug: 'kalzen' },
    data: { s3Config: newConfig as never },
  });
  
  const updated = await prisma.tenant.findUnique({ where: { slug: 'kalzen' } });
  console.log('After:', updated?.s3Config);
}

main().catch(console.error).finally(() => prisma.$disconnect());
