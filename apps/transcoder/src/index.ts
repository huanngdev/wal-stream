import { Hono } from "hono"
import { logger } from "hono/logger"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

interface ChunkInfo {
  index: number
  filename: string
  size_bytes: number
  duration_approx: number
}

const app = new Hono()

app.use("*", async (c, next) => {
  c.res.headers.set("Access-Control-Allow-Origin", "*")
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  c.res.headers.set("Access-Control-Max-Age", "86400")

  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: c.res.headers })
  }

  await next()
})
app.use("*", logger())

async function checkFfmpeg(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"])
    const out = await new Response(proc.stdout).text()
    return out.split("\n")[0] ?? null
  } catch {
    return null
  }
}

app.get("/health", async (c) => {
  const ffmpegVersion = await checkFfmpeg()
  return c.json({
    status: "ok",
    ffmpeg: ffmpegVersion ?? "not found",
  })
})

app.post("/transcode", async (c) => {
  const chunkSeconds = parseInt(c.req.query("chunk_seconds") ?? "300", 10)
  const mode = c.req.query("mode") ?? "encode"
  const formData = await c.req.formData()
  const file = formData.get("file")

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No video file provided" }, 400)
  }

  const sessionId = crypto.randomUUID()
  const tmpDir = join(tmpdir(), sessionId)
  const inputPath = join(tmpDir, "input.mp4")

  try {
    await mkdir(tmpDir, { recursive: true })
    await writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))

    const chunkPattern = join(tmpDir, "chunk_%03d.mp4")

    const args = ["ffmpeg", "-y", "-i", inputPath]

    if (mode === "copy") {
      args.push(
        "-c", "copy",
        "-f", "segment",
        "-segment_time", String(chunkSeconds),
        "-segment_format", "mp4",
        "-reset_timestamps", "1",
        chunkPattern,
      )
    } else {
      args.push(
        "-c:v", "libx264",
        "-c:a", "aac",
        "-preset", "ultrafast",
        "-force_key_frames", `expr:gte(t,n_forced*${chunkSeconds})`,
        "-f", "segment",
        "-segment_time", String(chunkSeconds),
        "-segment_format", "mp4",
        "-reset_timestamps", "1",
        chunkPattern,
      )
    }

    const proc = Bun.spawn(args)

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

    if (exitCode !== 0) {
      return c.json({ error: `ffmpeg failed: ${stderr}` }, 500)
    }

    const entries = await readdir(tmpDir)
    const chunks: ChunkInfo[] = []
    let totalSize = 0

    for (const name of entries) {
      if (name.startsWith("chunk_") && name.endsWith(".mp4")) {
        const idxStr = name.replace(/^chunk_/, "").replace(/\.mp4$/, "")
        const idx = parseInt(idxStr, 10)
        if (!isNaN(idx)) {
          const path = join(tmpDir, name)
          const s = await stat(path)
          chunks.push({
            index: idx,
            filename: name,
            size_bytes: s.size,
            duration_approx: chunkSeconds,
          })
          totalSize += s.size
        }
      }
    }

    chunks.sort((a, b) => a.index - b.index)

    return c.json({
      session_id: sessionId,
      total_chunks: chunks.length,
      total_size_bytes: totalSize,
      chunk_duration_secs: chunkSeconds,
      chunks,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcoding failed"
    console.error("Transcoding error:", message)

    if (message.includes("Executable not found")) {
      return c.json(
        {
          error: "ffmpeg is not installed. Install it: sudo apt install ffmpeg",
        },
        500
      )
    }

    return c.json({ error: message }, 500)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

export default {
  port: 3001,
  fetch: app.fetch,
  maxRequestBodySize: 10 * 1024 * 1024 * 1024, // 10 GB
  idleTimeout: 255,
}
