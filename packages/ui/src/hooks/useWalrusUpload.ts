"use client"

import { useMutation } from "@tanstack/react-query"
import type { TranscodeResult } from "@workspace/shared/types"

async function transcodeVideo(
  baseUrl: string,
  args: { file: File; chunkSeconds: number; mode: "encode" | "copy" },
): Promise<TranscodeResult> {
  const start = performance.now()
  const formData = new FormData()
  formData.append("file", args.file)

  const res = await fetch(
    `${baseUrl}/transcode?chunk_seconds=${args.chunkSeconds}&mode=${args.mode}`,
    { method: "POST", body: formData },
  )

  const elapsed = Math.round(performance.now() - start)

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(data.error ?? `Transcode failed: ${res.status}`)
  }

  const serverData = await res.json()
  return { ...serverData, elapsed_ms: elapsed }
}

export function useWalrusUpload(baseUrl: string) {
  return useMutation({
    mutationFn: (
      args: { file: File; chunkSeconds: number; mode: "encode" | "copy" },
    ) => transcodeVideo(baseUrl, args),
  })
}
