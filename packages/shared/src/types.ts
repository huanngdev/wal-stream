export interface ChunkInfo {
  index: number
  filename: string
  size_bytes: number
  duration_approx: number
}

export interface TranscodeResult {
  session_id: string
  total_chunks: number
  total_size_bytes: number
  chunk_duration_secs: number
  chunks: ChunkInfo[]
  elapsed_ms: number
}
