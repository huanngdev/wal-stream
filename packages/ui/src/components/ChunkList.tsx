"use client"

import type { ChunkInfo } from "@workspace/shared/types"
import {
  Clock,
  Film,
  File,
  Gauge,
  HardDrive,
  Layers,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

interface ChunkListProps {
  chunks: ChunkInfo[]
  totalSize: number
  chunkDuration: number
  totalChunks: number
  sessionId: string
  elapsedMs: number
}

export function ChunkList({
  chunks,
  totalSize,
  chunkDuration,
  totalChunks,
  sessionId,
  elapsedMs,
}: ChunkListProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = (ms / 1000).toFixed(1)
    return `${s}s`
  }

  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers />
              Chunks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {totalChunks}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <HardDrive />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatSize(totalSize)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge />
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {chunkDuration}s
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Film />
              Avg Size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatSize(Math.round(totalSize / Math.max(totalChunks, 1)))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock />
              Elapsed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatTime(elapsedMs)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Chunk Details</h3>
          <Badge variant="secondary">
            {sessionId.slice(0, 8)}...
          </Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Filename</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chunks.map((chunk) => (
              <TableRow key={chunk.index}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {chunk.index}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <File className="size-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{chunk.filename}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatSize(chunk.size_bytes)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  ~{Math.round(chunk.duration_approx)}s
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
