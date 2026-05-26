"use client"

import { useWalrusUpload } from "@workspace/ui/hooks/useWalrusUpload"
import { useSuiWallet } from "@workspace/ui/hooks/useSuiWallet"
import { WalletConnect } from "@workspace/ui/components/WalletConnect"
import { FileUpload } from "@workspace/ui/components/FileUpload"
import { ChunkList } from "@workspace/ui/components/ChunkList"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Waves, AlertCircle, RefreshCw, CheckCircle2 } from "lucide-react"

export default function Page() {
  const {
    mutate: upload,
    isPending,
    isError,
    isSuccess,
    data: result,
    error,
    reset,
  } = useWalrusUpload("http://localhost:3001")
  const { connected } = useSuiWallet()

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Waves className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">WalStream</span>
          </div>
          <WalletConnect />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="flex w-full max-w-5xl flex-col items-center gap-8 px-4">
          {!isPending && !isError && !isSuccess && (
            <>
              <div className="space-y-2 text-center">
                <h1 className="text-3xl font-semibold tracking-tight">
                  Transcoder
                </h1>
                <p className="text-muted-foreground">
                  Split your video into chunks optimized for Walrus storage.
                  {!connected &&
                    " Connect your Sui wallet to upload chunks to Walrus."}
                </p>
              </div>

              <FileUpload
                onUpload={(file, chunkSeconds, mode) =>
                  upload({ file, chunkSeconds, mode })
                }
                disabled={!connected}
                uploading={isPending}
              />
            </>
          )}

          {isPending && (
            <div className="flex flex-col items-center gap-6 py-12">
              <Spinner className="size-12 text-primary" />
              <div className="space-y-1 text-center">
                <p className="font-medium">Transcoding in progress...</p>
                <p className="text-sm text-muted-foreground">
                  This may take a few minutes for large files.
                </p>
              </div>
            </div>
          )}

          {isError && (
            <div className="flex w-full max-w-md flex-col items-center gap-4 py-12">
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Transcoding failed</AlertTitle>
                <AlertDescription>{error?.message}</AlertDescription>
              </Alert>
              <Button variant="outline" onClick={() => reset()}>
                <RefreshCw data-icon="inline-start" />
                Try Again
              </Button>
            </div>
          )}

          {isSuccess && result && (
            <div className="flex w-full flex-col items-center gap-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-6 text-emerald-500" />
                <Badge variant="default" className="text-sm">
                  Chunks ready
                </Badge>
              </div>

              <ChunkList
                chunks={result.chunks}
                totalSize={result.total_size_bytes}
                chunkDuration={result.chunk_duration_secs}
                totalChunks={result.total_chunks}
                sessionId={result.session_id}
                elapsedMs={result.elapsed_ms}
              />

              <Button variant="outline" onClick={() => reset()}>
                <RefreshCw data-icon="inline-start" />
                Transcode Another
              </Button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t py-4 text-center font-mono text-[10px] tracking-wide text-muted-foreground/60 uppercase">
        WalStream · Decentralized Video on Walrus
      </footer>
    </div>
  )
}
