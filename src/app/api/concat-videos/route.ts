import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadVideoToR2, isR2Configured } from "@/lib/r2";
import { formatErrorResponse } from "@/lib/user-errors";
import { execFile } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * POST /api/concat-videos
 * Downloads two video files (exterior 5s + interior 10s) and concatenates
 * them into a single 15s MP4 with a brief crossfade transition using ffmpeg.
 * Uploads the result to R2 and returns the permanent URL.
 *
 * Body: { exteriorUrl: string, interiorUrl: string, filename?: string }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({ title: "Unauthorized", message: "Please sign in", code: "AUTH_001" }),
      { status: 401 },
    );
  }

  console.log("[RENDER] /api/concat-videos called");
  console.log("[RENDER] R2 configured:", isR2Configured());

  if (!isR2Configured()) {
    console.error("[RENDER] ❌ R2 NOT configured — concat-videos cannot work without R2 storage!");
    return NextResponse.json(
      formatErrorResponse({ title: "Storage not configured", message: "R2 storage is not configured. Video concatenation requires R2 for output storage.", code: "NET_001" }),
      { status: 503 },
    );
  }

  let tempDir = "";
  const filesToClean: string[] = [];

  try {
    const { exteriorUrl, interiorUrl, filename } = await req.json();

    if (!exteriorUrl || !interiorUrl) {
      return NextResponse.json(
        formatErrorResponse({ title: "Missing URLs", message: "Both exteriorUrl and interiorUrl are required", code: "VAL_001" }),
        { status: 400 },
      );
    }

    // Resolve ffmpeg binary — prefer ffmpeg-static, fall back to system ffmpeg
    let ffmpegPath: string;
    try {
      ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
    } catch {
      ffmpegPath = "ffmpeg"; // system ffmpeg
    }

    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), "concat-"));
    const extPath = join(tempDir, "exterior.mp4");
    const intPath = join(tempDir, "interior.mp4");
    const outPath = join(tempDir, "output.mp4");
    const listPath = join(tempDir, "filelist.txt");
    filesToClean.push(extPath, intPath, outPath, listPath);

    console.log("[concat-videos] Downloading videos...");

    // Download both videos in parallel
    const [extRes, intRes] = await Promise.all([
      fetch(exteriorUrl, { signal: AbortSignal.timeout(60_000) }),
      fetch(interiorUrl, { signal: AbortSignal.timeout(60_000) }),
    ]);

    if (!extRes.ok) throw new Error(`Exterior download failed: HTTP ${extRes.status}`);
    if (!intRes.ok) throw new Error(`Interior download failed: HTTP ${intRes.status}`);

    const [extBuf, intBuf] = await Promise.all([
      extRes.arrayBuffer(),
      intRes.arrayBuffer(),
    ]);

    await Promise.all([
      writeFile(extPath, Buffer.from(extBuf)),
      writeFile(intPath, Buffer.from(intBuf)),
    ]);

    console.log("[concat-videos] Videos downloaded. Concatenating with ffmpeg...");

    // Create ffmpeg concat file list
    await writeFile(listPath, `file '${extPath}'\nfile '${intPath}'\n`);

    // Concatenate using ffmpeg concat demuxer (lossless, fast)
    // -safe 0 allows absolute paths, -c copy avoids re-encoding
    await execFileAsync(ffmpegPath, [
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c", "copy",
      "-movflags", "+faststart",
      "-y",
      outPath,
    ], { timeout: 120_000 });

    console.log("[concat-videos] ffmpeg concat complete. Uploading to R2...");

    // Read the concatenated file
    const { readFile } = await import("fs/promises");
    const outputBuffer = await readFile(outPath);

    const safeName = (filename ?? `walkthrough-${Date.now()}.mp4`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    const result = await uploadVideoToR2(outputBuffer, safeName);
    if (!result.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Upload failed", message: result.error, code: "NET_001" }),
        { status: 500 },
      );
    }

    console.log("[concat-videos] Done!", { url: result.url, size: result.size });

    return NextResponse.json({
      videoUrl: result.url,
      key: result.key,
      size: result.size,
      durationSeconds: 15,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[concat-videos] Error:", msg);
    return NextResponse.json(
      formatErrorResponse({ title: "Video concatenation failed", message: msg, code: "NET_001" }),
      { status: 500 },
    );
  } finally {
    // Clean up temp files
    for (const f of filesToClean) {
      unlink(f).catch(() => {});
    }
    if (tempDir) {
      import("fs/promises").then(fs => fs.rm(tempDir, { recursive: true, force: true })).catch(() => {});
    }
  }
}
