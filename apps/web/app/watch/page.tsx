"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertTitle, AlertDescription } from "@workspace/ui/components/alert"
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldGroup,
} from "@workspace/ui/components/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@workspace/ui/components/card"
import { Waves, Search, Play, AlertCircle, ExternalLink } from "lucide-react"

const AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space"

export default function WatchPage() {
  const [blobId, setBlobId] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle")
  const [error, setError] = useState("")
  const [src, setSrc] = useState("")

  const handleLoad = () => {
    if (!blobId.trim()) return
    const trimmed = blobId.trim()
    const url = `${AGGREGATOR}/v1/blobs/${trimmed}`
    setSrc(url)
    setStatus("loaded")
    setError("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLoad()
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Waves className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">WalStream</span>
          </a>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="flex w-full max-w-2xl flex-col gap-8">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Watch on Walrus
            </h1>
            <p className="text-muted-foreground">
              Paste a blob ID to stream your video directly from the Walrus
              aggregator.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Search />
                Load Blob
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel>Blob ID</FieldLabel>
                  <FieldContent>
                    <Input
                      placeholder="Paste blob ID..."
                      value={blobId}
                      onChange={(e) => setBlobId(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
              <Button
                className="mt-3 w-full"
                onClick={handleLoad}
                disabled={!blobId.trim() || status === "loading"}
              >
                {status === "loading" ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Play data-icon="inline-start" />
                    Load Video
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {status === "error" && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Failed to load</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {status === "loaded" && src && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm truncate">
                    {blobId}
                  </CardTitle>
                  <a href={src} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="icon-sm" type="button">
                      <ExternalLink />
                    </Button>
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                <video
                  controls
                  autoPlay
                  className="w-full rounded-lg"
                  src={src}
                  onError={() => {
                    setStatus("error")
                    setError(
                      "Failed to load video. Make sure the blob ID is correct and the content is a valid video.",
                    )
                  }}
                  onLoadStart={() => setStatus("loading")}
                  onCanPlay={() => setStatus("loaded")}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="border-t py-4 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
        WalStream · Decentralized Video on Walrus
      </footer>
    </div>
  )
}
