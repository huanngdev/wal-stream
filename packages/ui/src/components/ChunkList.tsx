"use client"

import type { ChunkInfo } from "@workspace/shared/types"
import {
  Clock,
  Cloud,
  ExternalLink,
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
import { Button } from "@workspace/ui/components/button"
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
  walrusAggregator?: string
}

export function ChunkList({
  chunks,
  totalSize,
  chunkDuration,
  totalChunks,
  sessionId,
  elapsedMs,
  walrusAggregator,
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

  const hasBlobs = chunks.some((c) => c.blob_id)

  const getViewUrl = (blobId: string) =>
    walrusAggregator
      ? `${walrusAggregator}/v1/blobs/${blobId}`
      : `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`

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

      {hasBlobs && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cloud />
              Walrus Blobs
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chunks.map((chunk) =>
              chunk.blob_id ? (
                <div
                  key={chunk.index}
                  className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
                >
                  <span className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-muted-foreground">
                      #{chunk.index}
                    </span>
                    <span className="truncate max-w-64">
                      {chunk.blob_id}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {formatSize(chunk.size_bytes)}
                    </Badge>
                    <a
                      href={getViewUrl(chunk.blob_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="ghost" size="icon-sm" type="button">
                        <ExternalLink />
                      </Button>
                    </a>
                  </div>
                </div>
              ) : null,
            )}
          </CardContent>
        </Card>
      )}

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
              <TableHead className="w-12" />
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
                <TableCell>
                  {chunk.blob_id && (
                    <a
                      href={getViewUrl(chunk.blob_id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="ghost" size="icon-sm" type="button">
                        <ExternalLink className="size-3" />
                      </Button>
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
