/**
 * Upload template preview recordings to R2.
 * Run: npx tsx scripts/upload-template-previews.ts
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import { resolve } from "path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY || "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "buildflow-files";
const PUBLIC_URL = process.env.R2_PUBLIC_URL ?? `https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev`;

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error("❌ Missing R2 credentials in .env.local");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED" as any,
  responseChecksumValidation: "WHEN_REQUIRED" as any,
} as any);

const VIDEOS = [
  {
    localPath: "Copy of Parameters → 3D Building 2026-03-21T05-43-10-989Z.mp4",
    r2Key: "workflow-demos/parameters-to-3d-building.mp4",
    label: "Parameters → 3D Building",
  },
  {
    localPath: "Copy of Text Prompt → Floor Plan 2026-03-21T07-50-00-380Z.mp4",
    r2Key: "workflow-demos/text-prompt-to-floor-plan.mp4",
    label: "Text Prompt → Floor Plan",
  },
];

async function upload() {
  for (const video of VIDEOS) {
    const filePath = resolve(__dirname, "..", video.localPath);
    console.log(`📦 Reading ${video.localPath}...`);

    let buffer: Buffer;
    try {
      buffer = readFileSync(filePath);
    } catch {
      console.error(`❌ File not found: ${filePath}`);
      continue;
    }

    console.log(`☁️  Uploading ${video.label} (${(buffer.length / 1024 / 1024).toFixed(1)}MB) → ${video.r2Key}...`);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: video.r2Key,
          Body: buffer,
          ContentType: "video/mp4",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );

      const url = `${PUBLIC_URL}/${video.r2Key}`;
      console.log(`✅ ${video.label} uploaded → ${url}`);
    } catch (e: any) {
      console.error(`❌ Upload failed for ${video.label}:`, e.message);
    }
  }
}

upload();
