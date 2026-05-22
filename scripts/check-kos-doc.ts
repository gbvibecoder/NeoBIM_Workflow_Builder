import { prisma } from '../src/lib/db';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

async function main() {
  // 1. Show all KOS documents
  const docs = await prisma.kosDocument.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('\n=== Recent KOS documents ===');
  if (docs.length === 0) {
    console.log('(none)');
    return;
  }
  for (const d of docs) {
    console.log({
      id: d.id,
      title: d.title,
      docType: d.docType,
      status: d.status,
      s3Key: d.s3Key,
      version: d.version,
      indexedAt: d.indexedAt,
      createdAt: d.createdAt,
    });
  }

  // 2. Check the latest doc against S3
  const latest = docs[0];
  console.log('\n=== Checking S3 for latest doc ===');
  console.log('Bucket: kalzen-kos-dev');
  console.log('Key:', latest.s3Key);

  const s3 = new S3Client({
    region: 'ap-south-1',
    credentials: {
      accessKeyId: process.env.KOS_S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.KOS_S3_SECRET_ACCESS_KEY!,
    },
  });
  try {
    const head = await s3.send(new HeadObjectCommand({
      Bucket: 'kalzen-kos-dev',
      Key: latest.s3Key,
    }));
    console.log('✅ Object EXISTS on S3');
    console.log('  ContentLength:', head.ContentLength, 'bytes');
    console.log('  ContentType:', head.ContentType);
    console.log('  LastModified:', head.LastModified);
  } catch (err: any) {
    console.log('❌ Object NOT FOUND on S3');
    console.log('  Error:', err.name, '-', err.message);
  }

  // 3. Check chunk count
  const chunks = await prisma.kosDocumentChunk.count({
    where: { documentId: latest.id },
  });
  console.log('\n=== Chunks for this doc ===');
  console.log('Chunk count:', chunks);
}

main().catch(console.error).finally(() => prisma.$disconnect());
