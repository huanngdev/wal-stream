"use client"

import { useCallback, useRef, useState } from "react"
import { Upload, FileVideo, X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldGroup,
} from "@workspace/ui/components/field"

interface FileUploadProps {
  onUpload: (file: File, chunkSeconds: number, mode: "encode" | "copy") => void
  disabled?: boolean
  uploading?: boolean
}

export function FileUpload({
  onUpload,
  disabled = false,
  uploading = false,
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [chunkSeconds, setChunkSeconds] = useState(300)
  const [mode, setMode] = useState<"encode" | "copy">("encode")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped?.type.startsWith("video/")) {
      setFile(dropped)
    }
  }, [])

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) setFile(selected)
    },
    [],
  )

  const handleSubmit = useCallback(() => {
    if (file && !uploading) {
      onUpload(file, chunkSeconds, mode)
    }
  }, [file, chunkSeconds, mode, uploading, onUpload])

  const clearFile = useCallback(() => {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  return (
    <div className="w-full max-w-xl space-y-4">
      <div
        onDragEnter={handleDragIn}
        onDragLeave={handleDragOut}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-xl border-2 border-dashed p-12 text-center transition-all duration-200",
          dragOver
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          onChange={handleSelect}
          className="absolute inset-0 cursor-pointer opacity-0"
        />

        {file ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <FileVideo className="size-7 text-primary" />
            </div>
            <div>
              <p className="max-w-xs truncate font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatSize(file.size)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={(e) => {
                e.stopPropagation()
                clearFile()
              }}
            >
              <X data-icon="inline-start" />
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <Upload className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">
                Drop your video here, or click to browse
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                MP4, MOV, WebM — up to 10 GB
              </p>
            </div>
          </div>
        )}
      </div>

      {file && (
        <div className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Chunk duration (seconds)</FieldLabel>
              <FieldContent>
                <Input
                  type="number"
                  value={chunkSeconds}
                  onChange={(e) => setChunkSeconds(Number(e.target.value))}
                  min={60}
                  max={1800}
                  step={60}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Mode</FieldLabel>
              <FieldContent>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(val) => val && setMode(val as "encode" | "copy")}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="encode">
                    Encode (slow, smaller)
                  </ToggleGroupItem>
                  <ToggleGroupItem value="copy">
                    Copy (fast, original)
                  </ToggleGroupItem>
                </ToggleGroup>
              </FieldContent>
            </Field>
          </FieldGroup>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={uploading || disabled}
            className="w-full"
          >
            {uploading ? (
              <>
                <Spinner data-icon="inline-start" />
                Transcoding...
              </>
            ) : (
              <>Start Transcoding</>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
