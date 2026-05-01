import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const id = process.argv[2];
const exec = await prisma.execution.findFirst({
  where: { id },
  select: { id: true, tileResults: true, status: true },
});
if (!exec) { console.log("NOT FOUND:", id); process.exit(0); }
console.log("execution:", exec.id, "status:", exec.status);
const tr = Array.isArray(exec.tileResults) ? exec.tileResults : [];
console.log("tileResults entries:", tr.length);
tr.forEach((r, i) => {
  console.log(`\n[${i}] node=${r.nodeLabel} type=${r.type}`);
  console.log("  keys in entry:", Object.keys(r));
  console.log("  metadata:", JSON.stringify(r.metadata)?.slice(0, 800));
});
await prisma.$disconnect();
