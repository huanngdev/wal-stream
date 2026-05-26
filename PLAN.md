# Walrus Video Streaming Layer — Implementation Plan

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [MVP & Phasing](#4-mvp--phasing)
5. [Phase 0: Prerequisites & Research](#5-phase-0-prerequisites--research)
6. [Phase 1: Transcoding & Chunking Pipeline](#6-phase-1-transcoding--chunking-pipeline)
7. [Phase 2: Encryption & Key Management](#7-phase-2-encryption--key-management)
8. [Phase 3: Upload to Walrus](#8-phase-3-upload-to-walrus)
9. [Phase 4: Manifest Format & Sui Pointer](#9-phase-4-manifest-format--sui-pointer)
10. [Phase 5: Player SDK](#10-phase-5-player-sdk)
11. [Phase 6: Aggregator Optimization](#11-phase-6-aggregator-optimization)
12. [Phase 7: CDN & Edge Caching](#12-phase-7-cdn--edge-caching)
13. [Phase 8: Access Control (Seal + Move)](#13-phase-8-access-control-seal--move)
14. [Phase 9: Production Hardening](#14-phase-9-production-hardening)
15. [Phase 10: Monitoring & Analytics](#15-phase-10-monitoring--analytics)
16. [Deployment Topology](#16-deployment-topology)
17. [Cost Model](#17-cost-model)
18. [Risk Register](#18-risk-register)

---

## 1. Overview & Goals

### What we are building

A video streaming layer on top of Walrus (decentralized blob storage) + Seal (decentralized encryption/access control) + Sui (blockchain coordination). Built as a **Turborepo monorepo** — Next.js/TypeScript for the web platform, Rust for performance-critical transcoding/upload, and Move for onchain contracts. Users upload a video file via the web platform, viewers stream it on-demand with adaptive bitrate, access-controlled via onchain policies.

### Constraints we design around

| Constraint | Implication |
|-----------|-------------|
| Walrus max blob size ~13.6 GiB | Must split video into segments |
| Walrus blobs are all-or-nothing reads | No byte-range streaming; must fetch full segment |
| Walrus encoding is 4.5x | Upload bandwidth is significant; use publisher service or dedicated node |
| Walrus decoding needs 1.5-2x RAM | Segment size must stay small enough for browser/mobile decode (~50 MB ceiling) |
| Walrus is public storage | Must encrypt before upload if content is private |
| Sui transactions cost gas | Minimize onchain operations (one pointer update per video) |
| Seal is per-decrypt call | Must use envelope encryption (one Seal call per session, not per segment) |

### Non-goals

- Real-time live streaming (same architecture works but needs streaming transcoder + sliding window manifest; out of scope for v1)
- DRM comparable to Widevine/FairPlay hardware-level protection
- Decentralized transcoding network
- Onchain video players (playback happens in browser/app)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         UPLOAD PATH                              │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │  Next.js App  │───▶│  Transcode       │───▶│  Encrypt &       │   │
│  │  (Upload UI)  │    │  Server (Rust)   │    │  Upload Service   │   │
│  └──────────────┘    └──────────────────┘    └────────┬─────────┘   │
│                                                    │              │
│               ┌────────────────────────────────────┼──────┐      │
│               │  Walrus Network                    │      │      │
│               │  ┌────┐ ┌────┐ ┌────┐             │      │      │
│               │  │Node│ │Node│ │Node│ ...          │      │      │
│               │  └────┘ └────┘ └────┘             │      │      │
│               │    Segment blobs (encrypted)       │      │      │
│               └────────────────────────────────────┼──────┘      │
│                                                    │              │
│  ┌──────────────────┐    ┌─────────────────────────┼──────┐      │
│  │  Sui Blockchain  │    │  Manifest Blob (Walrus)  │      │      │
│  │                  │    │  ┌──────────────────┐    │      │      │
│  │  VideoPointer    │◀───│  │ playlist +       │◀───┘      │      │
│  │  Object          │    │  │ encrypted VEK    │            │      │
│  │  - manifestBlobId│    │  │ per-segment IVs  │            │      │
│  │  - owner         │    │  │ access policy    │            │      │
│  │  - title         │    │  └──────────────────┘            │      │
│  │  - thumbnailId   │    └──────────────────────────────────┘      │
│  └──────────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        PLAYBACK PATH                              │
│                                                                   │
│  ┌──────────┐                                                    │
│  │  Viewer  │                                                    │
│  │  Browser │                                                    │
│  └────┬─────┘                                                    │
│       │                                                           │
│  ┌────▼─────────────┐     ┌──────────────────┐                  │
│  │  Player SDK      │────▶│  Seal Key Server │ (ONE call)      │
│  │  - fetch manifest│     │  decrypt VEK     │                  │
│  │  - get VEK       │     └──────────────────┘                  │
│  │  - decrypt segs  │                                            │
│  │  - ABR logic     │                                            │
│  │  - buffer mgmt   │                                            │
│  └────┬─────────────┘                                            │
│       │                                                           │
│       │  fetch segment blobs (sequential + prefetch)             │
│       ▼                                                           │
│  ┌──────────────────────┐     ┌──────────────────────┐          │
│  │  Aggregator / CDN    │────▶│  Walrus Storage      │          │
│  │  (caches hot segs)   │     │  Nodes               │          │
│  └──────────────────────┘     └──────────────────────┘          │
│                                                                   │
│  ┌──────────────────────┐                                        │
│  │  HTML <video> + MSE  │  ← decrypted segments fed here        │
│  └──────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow summary

```
Upload:   Next.js UI → API route → Rust transcoder → ffmpeg
          → N segments × M qualities
          → (v0.2) AES-256 encrypt each segment (1 VEK)
          → Upload segments to Walrus (parallel, Rust service)
          → Build manifest + (v0.2) encrypt VEK with Seal
          → Upload manifest to Walrus
          → Create Sui VideoPointer object

Playback: Next.js watch page → Sui pointer → manifest blob
          → (v0.2) Seal SDK (1 call) → VEK in memory
          → Loop: fetch segment blob → (v0.2) AES decrypt → MSE → play
          → (v0.3) ABR: adjust quality at segment boundaries
```

---

## 3. Tech Stack

### Monorepo structure

```
wal-stream/                          (Turborepo)
├── apps/
│   ├── web/                         # Next.js — upload & streaming platform
│   └── player-demo/                 # Standalone player test page
├── packages/
│   ├── transcoder/                  # Rust — ffmpeg orchestration, encryption, upload
│   ├── player-sdk/                  # TypeScript — @walrus/video-player
│   ├── upload-sdk/                  # TypeScript — browser upload + client-side helpers
│   ├── sui-contracts/               # Move — walrus_video package
│   └── shared/                      # TypeScript — types, constants, utilities
├── turbo.json
└── package.json
```

### Component stack

| Component | Language | Rationale |
|-----------|----------|-----------|
| Web platform (upload + watch) | Next.js + React + TypeScript | SSR, API routes, rich ecosystem |
| Transcoding service | Rust | Performance-critical: ffmpeg orchestration, parallel encryption, Walrus upload |
| Player SDK | TypeScript | Targets browser; lightweight and tree-shakeable |
| Upload SDK | TypeScript | Client-side helpers for browser upload flow |
| Move contracts | Sui Move | Onchain video pointer + access policies |
| Job queue | Redis + BullMQ | Persistent queue for transcode jobs |

### Target networks

| Environment | Network | Purpose |
|------------|---------|---------|
| Development | Sui Testnet + Walrus Testnet | Fast iteration, free tokens |
| Production | Sui Mainnet + Walrus Mainnet | Real users, real costs |

All code must be **mainnet-ready from day one**. We develop on testnet, but:
- Package IDs, object types, key server URLs are configurable per environment
- Gas budgeting assumes mainnet prices (use `dryRun` for estimation)
- Walrus epoch durations and pricing fetched from live network info
- No hardcoded testnet-only assumptions

---

## 4. MVP & Phasing

### v0.1 — Upload & Watch Platform (target: 6-8 weeks)

**Scope:**
- Web platform: upload a video → transcode → upload to Walrus → watch page
- Single quality (1080p), no ABR, no encryption, no access control (public content)
- All data on Walrus Testnet (mainnet-configurable)
- "Share link" that anyone can open and watch

**Non-scope for v0.1:**
- Encryption / Seal / access control
- Adaptive bitrate (ABR)
- Player SDK as separate package (player logic inline in web app)
- CDN / aggregator optimization
- Multi-region deployment
- Monitoring dashboards

**Exit criteria:**
- Upload 10-min 1080p video through web UI
- Segments appear on Walrus Testnet
- Watch page loads manifest, fetches segments to `<video>` via MSE
- Works in Chrome, Firefox, Safari
- Time-to-first-frame < 5s on 50 Mbps connection

### v0.2 — Encryption + Standalone SDK (target: +3-4 weeks)

- AES-256-GCM encryption + Seal envelope encryption
- Move access policies (public + token-gate)
- Wallet connect → Seal decrypt → playback
- Player logic extracted into `@walrus/video-player` package

### v0.3 — Full ABR + SDK Distribution (target: +3-4 weeks)

- Multi-quality transcoding (360p-2160p)
- ABR algorithm in player SDK
- `@walrus/video-player-react` and custom element build
- CDN + aggregator caching

---

## 5. Phase 0: Prerequisites & Research

### 3.1 E2E prototype on Testnet (week 1)

Before any architecture decisions are final, build a tiny working slice:
- Transcode a 2-minute video to HLS fMP4 via ffmpeg (single quality)
- Upload segments to Walrus Testnet
- Build a bare HTML page that fetches the manifest and plays via MSE
- This validates the full data flow: transcode → Walrus → browser playback

All Phase 0 research is done on **testnet first**. Every finding is validated against mainnet docs to ensure compatibility.

### 3.2 Understand Walrus deeply

- Run `walrus info` on testnet to confirm current:
  - Max blob size
  - Number of shards (affects encoding overhead)
  - Epoch duration
  - Price per encoded byte
- Cross-reference with mainnet docs: are testnet limits ~same as mainnet?
- Test upload/download of a ~50 MB blob to benchmark throughput and latency
- Test read from a public aggregator vs. direct from storage nodes
- Verify aggregator caching behavior (does it cache? TTL?)

### 3.3 Understand Seal deeply

- Deploy the example access policy packages (allowlist, subscription, token-gate)
- Test encrypt/decrypt roundtrip with Seal SDK
- Measure Seal decrypt latency (network call to key server + PTB evaluation)
- Confirm session key behavior (how long cached? what triggers re-auth?)
- Verify threshold encryption with 2-of-N key servers

### 3.4 Design decisions to lock in

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Segment container format | `.ts` (MPEG-TS) vs `.mp4` (fMP4) | **fMP4** — better for HLS, works with MSE natively |
| Streaming protocol | HLS vs DASH | **HLS** — wider browser support, simpler manifests |
| Encryption cipher | AES-128-CBC vs AES-256-GCM | **AES-256-GCM** — stronger, authenticated, Seal's recommended DEM |
| Key wrapping | Seal IBE directly on data vs envelope | **Envelope** (Seal for VEK only) — documented in Seal design guide |
| Transcoding engine | ffmpeg CLI vs custom C library | **ffmpeg CLI** — battle-tested, GPU support, all codecs |
| ABR library | HLS.js vs Shaka Player vs Video.js | **HLS.js** — lightest, best HLS fMP4 support, easy to extend |
| Move contract | Separate package vs integrated | **Separate `walrus_video` Move package** with upgrade capability |

### 3.5 Estimate scale requirements

```
Example: 4K movie, 2 hours, 50 Mbps average

Raw file:           ~45 GB
Qualities:          2160p, 1080p, 720p, 480p, 360p
Segments:           1,440 per quality (5s each)
Total segments:     7,200
Encoded on Walrus:  ~200 GB (45 GB × 4.5x encoding expansion)

One segment:        4K ~31 MB raw → ~140 MB encoded on Walrus
                    1080p ~8 MB raw → ~36 MB encoded
                    480p ~3 MB raw → ~13.5 MB encoded

RAM to decode:      4K segment ~50 MB (fine for browser)
                    1080p segment ~15 MB

Upload time:        With 100 Mbps upload, ~5 hours for all qualities
                    (200 GB of encoded data needs to reach storage nodes)

Storage cost:       Depends on epoch count. 12 epochs (~6 months):
                    ~200 GB × price_per_gb × epochs
```

### 3.6 Local development workflow

```
# Install dependencies and link packages
pnpm install

# Start Next.js dev server (apps/web) → http://localhost:3000
turbo dev

# Run the Rust transcoder binary (mock Walrus for fast iteration)
cargo run --bin transcoder -- --mock-walrus

# Build everything for production
turbo build

# Run tests across all packages
turbo test

# Lint & typecheck all packages
turbo lint
turbo typecheck
```

During early development, the transcoder should support a `--mock-walrus` flag that writes blobs to a local directory instead of uploading to Walrus. This enables fast iteration without burning testnet tokens or waiting for network roundtrips. Swap to real testnet for integration tests.

### 3.7 Addendum: Local dev scripts

Every package gets a `dev` script configured in `turbo.json` pipelines:
- `apps/web` → `next dev` (hot reload on port 3000)
- `packages/transcoder` → `cargo watch -x run` (auto-rebuild)
- `packages/player-sdk` → `tsup --watch` (bundle on change)
- `packages/sui-contracts` → `sui move test` (on change, via script)

---

## 6. Phase 1: Transcoding & Chunking Pipeline

### 4.1 Server setup

- Single VM with GPU (NVIDIA T4 or similar, or use Intel QSV for lower cost)
- OS: Ubuntu 22.04 LTS
- Install: ffmpeg (compiled with NVENC/QSV + libx264 + libx265 + libsvtav1)
- Filesystem: SSD/NVMe for temp working directory (2x largest video size)
- Option: Docker container with ffmpeg for reproducible builds

### 4.2 Transcoding profile (ABR ladder)

```
Quality    Resolution    Bitrate        Codec       Keyframe interval
────────   ──────────    ───────        ─────       ─────────────────
2160p      3840×2160     25-35 Mbps     H.265       5s (force keyframe at segment boundary)
1440p      2560×1440     12-18 Mbps     H.265       5s
1080p      1920×1080     6-10 Mbps      H.264       5s
720p       1280×720      3-5 Mbps       H.264       5s
480p       854×480       1.2-2 Mbps     H.264       5s
360p       640×360       600-900 Kbps   H.264       5s
```

Key ffmpeg flags:
- `-force_key_frames "expr:gte(t,n_forced*5)"` — keyframe at every 5s boundary
- `-seg_duration 5` — HLS segment duration
- `-hls_playlist_type vod` — static playlist (VOD, not live)
- `-hls_segment_type fmp4` — fragmented MP4 segments
- `-sc_threshold 0` — disable scene detection (keyframes only at forced positions)

### 4.3 Chunking output structure

```
working_dir/
├── 2160p/
│   ├── playlist.m3u8
│   ├── seg_00001.m4s        # fMP4 segment, ~19 MB
│   ├── seg_00002.m4s
│   └── ...
├── 1080p/
│   ├── playlist.m3u8
│   ├── seg_00001.m4s
│   └── ...
├── 720p/
├── 480p/
├── 360p/
├── init_2160p.mp4           # fMP4 init segment (codec headers)
├── init_1080p.mp4
├── ...
└── master.m3u8              # variants playlist
```

### 4.4 Processing pipeline design

```
┌──────────┐    ┌──────────────┐    ┌───────────────┐
│ Incoming │───▶│  Probe file  │───▶│  Transcode to │
│  video   │    │  (ffprobe)   │    │  all qualities │
└──────────┘    │  - duration  │    │  (ffmpeg)      │
                │  - codecs    │    └───────┬───────┘
                │  - bitrate   │            │
                └──────────────┘    ┌───────▼───────┐
                                    │  Verify output │
                                    │  - segment     │
                                    │    count       │
                                    │  - durations   │
                                    │  - bitrates    │
                                    └───────────────┘
```

Steps:
1. Validate input (codec, container, duration)
2. Probe for metadata (duration, resolution, existing codec)
3. Transcode to HLS fMP4 — all qualities in parallel
4. Verify output: check segment count consistency, spot-check file sizes
5. Package: zip/tar segments into upload batch per quality

### 4.5 Job queue design

```
┌──────────┐     ┌───────────────┐     ┌────────────┐
│  API     │────▶│  Redis Queue  │────▶│  Worker(s) │
│  Request │     │  (or in-mem)  │     │  (ffmpeg)  │
└──────────┘     └───────────────┘     └─────┬──────┘
                                             │
                              ┌──────────────┴──────────────┐
                              │  On complete:                │
                              │  → next pipeline step       │
                              │  → webhook / callback       │
                              └─────────────────────────────┘
```

- Use BullMQ (Redis-backed) or a simple FIFO queue
- Max concurrency: 2-3 parallel transcodes per GPU (depends on resolution)
- Job status: queued → transcoding → verifying → done / failed
- Progress reporting: ffmpeg parses stderr for time elapsed
- Dead letter queue: retry failed jobs up to 3x, then alert

### 4.6 Client-side transcoding fallback (for small videos only)

- Use ffmpeg.wasm in browser
- Limit: files under 1 GB, 1080p max, single quality
- Show clear warning above 500 MB
- This is a convenience path for quick uploads, not for 4K movies

---

## 7. Phase 2: Encryption & Key Management

### 5.1 Key hierarchy

```
┌────────────────────────┐
│  Video Encryption Key  │  AES-256, random, 32 bytes
│  (VEK)                 │  Generated once per video
│  Per-video, symmetric  │
└───────────┬────────────┘
            │ protected by
┌───────────▼────────────┐
│  Seal IBE Encryption   │  Boneh-Franklin IBE (BLS12-381)
│  (encrypted VEK)       │  Threshold: 2-of-3 key servers
│  Stored in manifest    │  Identity: [packageId][videoId]
└───────────┬────────────┘
            │ authorized by
┌───────────▼────────────┐
│  Move Access Policy    │  Deployed on Sui
│  seal_approve()        │  Can be: NFT-gated, allowlist,
│                        │  subscription, time-locked, public
└────────────────────────┘
```

### 5.2 Segment encryption

Each segment is encrypted independently with the same VEK:

```
For segment i:
  IV_i = random 12 bytes (AES-256-GCM standard)
  ciphertext_i = AES-256-GCM(plaintext_segment_i, VEK, IV_i)
  auth_tag_i = appended to ciphertext (GCM auto-handles this)
  
Store: { blobId: ..., iv: "base64(IV_i)" } in manifest
```

Why AES-256-GCM:
- Authenticated encryption (detects tampering) — complements Walrus's content-addressing
- GCM is streamable (no padding, fixed overhead of 16 bytes per segment)
- Fast in browsers via Web Crypto API (SubtleCrypto)
- Seal docs explicitly recommend it for DEM

### 5.3 VEK encryption with Seal

```
Encrypted VEK payload:
{
  sealEncrypted: {            // output of Seal.encrypt()
    ciphertext: "0x...",       // Boneh-Franklin ciphertext
    encryptedShares: [...],    // for each key server
    packageId: "0x...",        // Move package with access policy
    innerId: "0x...",          // video-specific identity
    threshold: 2,
    keyServerUrls: [...]       // key servers used
  },
  kekFingerprint: "sha256-VEK" // for debug/audit; NOT the key itself
}
```

### 5.4 Key lifecycle

```
CREATE:    Uploader SDK generates VEK (crypto.getRandomValues)
USE:       Encrypt all segments with VEK during upload
ENCRYPT:   VEK encrypted with Seal IBE → stored in manifest
DESTROY:   VEK wiped from uploader memory after manifest upload

AT REST:   Only encrypted VEK exists (in manifest blob)
           No VEK stored anywhere on disk or in database

PLAYBACK:  Viewer SDK calls Seal → gets VEK → holds in memory (JS closure)
           VEK used for per-segment AES decryption
           VEK destroyed on page unload / player.destroy()

ROTATION:  Not needed per-video. New video = new VEK.
```

### 5.5 Offline backup key (optional)

- Generate a "recovery key" = AES-256-WRAP(VEK, userPassword)
- Store recovery key encrypted in a separate Walrus blob (referenced from Sui object)
- Allows uploader to recover VEK without Seal (e.g., if key servers are down)
- Only the uploader can decrypt (password-derived key)

---

## 8. Phase 3: Upload to Walrus

### 6.1 Upload strategy

```
                    ┌─────────────────────────┐
                    │  Upload Service          │
                    │                          │
 Segments ─────────▶│  Parallel upload queue   │
 (encrypted)        │  (concurrency: 5-10)    │
                    │                          │
                    │  For each segment:       │
                    │  1. PUT to publisher     │
                    │  2. Get blobId back      │
                    │  3. Record in manifest   │
                    │  4. Retry 3x on failure  │
                    │                          │
                    │  After all segments:     │
                    │  → Upload manifest blob  │
                    │  → Create Sui pointer    │
                    └─────────────────────────┘
```

### 6.2 Upload concurrency & backpressure

- Start with 5 concurrent uploads
- Monitor for HTTP 429 (rate limiting) from publisher/storage nodes
- Implement exponential backoff: 1s, 2s, 4s, 8s, then fail
- If >5 consecutive 429s, reduce concurrency to 3, then 1
- Use a separate publisher endpoint per batch for throughput

### 6.3 Upload ordering & blobId collection

```
1. Upload init segments first (codec headers) — blocks playback start
2. Upload segment 00001 of each quality — enables instant start
3. Upload remaining segments in order, lowest quality first
   (so 360p completes before 2160p — instant playback at low quality)

For each segment uploaded:
  - Record: { quality, index, blobId, iv, size_original, size_walrus }
  - Append to in-memory manifest builder
  - Log to persistent store (for crash recovery)
```

### 6.4 Crash recovery

Uploading 7,200 segments can take hours. A crash must not lose progress.

```
Checkpoint file (written every 50 segments or 60s, whichever first):
{
  videoId: "...",
  status: "uploading-segments",
  lastSegmentUploaded: { quality: "720p", index: 147 },
  segments: [
    { quality: "1080p", index: 0, blobId: "...", iv: "...", uploaded: true },
    { quality: "1080p", index: 1, blobId: "...", iv: "...", uploaded: true },
    // ...
  ],
  createdAt: "...",
  updatedAt: "..."
}

On restart: read checkpoint → skip already-uploaded segments → resume
```

### 6.5 Upload verification

After all segments uploaded:
1. Download 5 random segments per quality from Walrus
2. Decrypt with VEK
3. Compare hash with original pre-upload hash
4. If mismatch → re-upload those segments
5. Verify all blobIds match the manifest

---

## 9. Phase 4: Manifest Format & Sui Pointer

### 7.1 Manifest schema

The manifest is a JSON blob stored on Walrus. It is the single source of truth for playback.

```
manifest.json:
{
  // Version for format evolution
  "version": 1,

  // Video metadata
  "title": "Dune Part Three",
  "duration": 7200.5,        // seconds
  "createdAt": "2026-05-26T...",

  // Encryption bundle
  "encryption": {
    "method": "aes-256-gcm",
    "kek": {
      "type": "seal-ibe",
      "encryptedKey": {       // Seal.encrypt() output
        "ciphertext": "0x...",
        "encryptedShares": [...],
        "packageId": "0x...",
        "innerId": "0x...",
        "threshold": 2,
        "keyServerUrls": [
          "https://seal-key-server-1.wal.app",
          "https://seal-key-server-2.wal.app",
          "https://seal-key-server-3.wal.app"
        ]
      }
    },
    "kekFingerprint": "sha256:abc123..."  // for integrity check
  },

  // Access policy metadata (for player to know what to show)
  "accessPolicy": {
    "type": "token-gate",
    "packageId": "0x...",
    "module": "nft_gate",
    "nftType": "0x...::collection::NFT",
    "description": "Must hold the Dune NFT to watch"
  },

  // Quality renditions
  "renditions": [
    {
      "name": "2160p",
      "width": 3840,
      "height": 2160,
      "bandwidth": 35000000,   // bits per second (peak)
      "codec": "hvc1.2.4.L150.B0",
      "initBlobId": "abc123...",  // fMP4 init segment
      "initIv": "base64..."
    },
    {
      "name": "1080p",
      "width": 1920,
      "height": 1080,
      "bandwidth": 10000000,
      "codec": "avc1.64002A",
      "initBlobId": "def456...",
      "initIv": "base64..."
    }
    // ... more renditions
  ],

  // Segment index (per rendition)
  "segments": {
    "2160p": [
      {
        "index": 0,
        "blobId": "ghi789...",
        "iv": "base64...",
        "duration": 5.0,       // seconds
        "byteSize": 19687500   // original (pre-encryption) size
      },
      // ... 1439 more segments
    ],
    "1080p": [
      {
        "index": 0,
        "blobId": "jkl012...",
        "iv": "base64...",
        "duration": 5.0,
        "byteSize": 6250000
      }
      // ...
    ]
  }
}
```

### 7.2 Manifest optimization

For videos with many segments, the manifest JSON becomes large (e.g., 7,200 entries × ~150 bytes = ~1 MB).

Solutions:
- **Option A (simple, good for <10K segments):** Gzip the manifest before uploading. Player decompresses on fetch.
- **Option B (scalable):** Store segment index as a binary blob (compact, parseable), separate from metadata
- **Option C (advanced):** Bin-index: store blobIds in fixed-size binary arrays, one per rendition. Seek = floor(time/5) × entry_size.

Recommendation: **Option A** for v1. Revisit at 50K+ segments.

### 7.3 Sui VideoPointer object

A Move object deployed under the `walrus_video` package:

```
VideoPointer {
    id: UID,                    // this is the "videoId" users share
    version: u64,               // incremented on update (e.g., new manifest)
    owner: address,             // uploader
    manifestBlobId: u256,       // Walrus blob ID of manifest.json
    title: String,              // human-readable
    thumbnailBlobId: u256,      // Walrus blob ID for cover image
    durationMs: u64,            // total duration in milliseconds
    accessPackageId: address,   // Seal policy package
    accessType: u8,             // enum: 0=public, 1=token-gate, 2=subscription, 3=allowlist
    createdAt: u64,             // epoch timestamp
    updatedAt: u64              // epoch timestamp
}
```

Operations on this object:
- `create_pointer(...)` — called once after upload
- `update_manifest(newManifestBlobId)` — update to new manifest (new encode, added captions, etc.)
- `update_thumbnail(newThumbnailBlobId)` — change cover image
- `transfer(to)` — transfer ownership
- `burn()` — delete pointer (data stays in Walrus until epoch expires)

### 7.4 Thumbnail upload

- Generate thumbnail at upload time (grab a frame at 10% duration via ffmpeg)
- Resize to 1280×720 JPEG
- Upload as separate Walrus blob
- Store blobId in Sui VideoPointer

---

## 10. Phase 5: Player SDK

> **Milestone:** Player logic lives inline in the web app for v0.1. It is extracted into `@walrus/video-player` as a standalone package in v0.2. Full ABR, multi-quality support, and React/web-component builds ship in v0.3.

### 8.1 Architecture

```
┌─────────────────────────────────────────────────┐
│  WalrusPlayer (public API)                       │
│  - constructor({ videoId, wallet, container })   │
│  - play(), pause(), seek(), setQuality()         │
│  - on('ready'), on('error'), on('qualityChange') │
│  - destroy()                                     │
└──────────┬──────────────────────────────────────┘
           │ delegates to
┌──────────▼──────────────────────────────────────┐
│  WalrusHLS (internal engine)                     │
│  - Bootstrap: fetch manifest, init decryption    │
│  - Segment fetcher: walrus → decrypt → queue     │
│  - ABR controller: bandwidth estimate → quality │
│  - Buffer manager: 30s target, prefetch 3 ahead │
│  - Seek handler: index lookup → new segment     │
│  - Muxer: feed segments to MSE SourceBuffer     │
└──────────┬──────────────────────────────────────┘
           │ feeds
┌──────────▼──────────────────────────────────────┐
│  Browser Media APIs                              │
│  - MediaSource + SourceBuffer                    │
│  - <video> element                               │
│  - Web Crypto API (AES-256-GCM decrypt)         │
└─────────────────────────────────────────────────┘
```

### 8.2 Bootstrap sequence

```
1.  Fetch Sui object by videoId → get manifestBlobId
2.  Fetch manifest blob from aggregator
3.  Decompress manifest (if gzipped)
4.  Extract encrypted VEK from manifest
5.  Call Seal SDK to decrypt VEK:
    a. Prompt user's wallet to sign (session key)
    b. PTB evaluates access policy onchain
    c. Key servers return decryption shares
    d. Reconstruct VEK
6.  Store VEK in memory (closure variable, not on window)
7.  Fetch init segments for all qualities (codec configuration)
8.  Initialize MSE: MediaSource + SourceBuffer per quality
9.  Start playback at lowest quality → upgrade as bandwidth allows
```

### 8.3 Segment fetch & decrypt loop

```
function fetchAndDecryptSegment(quality, index):
  1. Look up { blobId, iv } from manifest.segments[quality][index]
  2. Fetch blob from aggregator:
     GET /v1/blobs/{blobId}
     → raw encrypted bytes
  3. If fetch fails: retry from backup aggregator (max 3 attempts)
  4. If all fail: skip segment, log error, continue to next
  5. Decrypt with Web Crypto API:
     crypto.subtle.decrypt(
       { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
       VEK,
       encryptedBytes
     )
  6. Verify: hash(decrypted) should match blobId
     (implicitly checked by Walrus aggregator in strict mode)
  7. Append to SourceBuffer
  8. Return success
```

### 8.4 ABR (Adaptive Bitrate) algorithm

```
Every segment boundary:
  1. Measure download time for last segment
  2. bandwidth = segmentSize / downloadTime
  3. Smooth: bwEstimate = 0.7 × bwEstimate + 0.3 × bandwidth
  4. bufferHealth = buffered.end - currentTime  (seconds)

Selection:
  if bufferHealth < 5s:
    → switch to one quality below current (emergency)
  else if bwEstimate > nextHigherQuality.bandwidth × 1.3 AND bufferHealth > 15s:
    → switch up (opportunistic upgrade)
  else if bwEstimate < currentQuality.bandwidth × 0.8:
    → switch down (bandwidth degradation)
  else:
    → stay

Anti-flapping: require 2 consecutive "upgrade" decisions before switching up
```

### 8.5 Seek behavior

```
seek(targetTime):
  1. Flush SourceBuffer (remove existing buffered data)
  2. segmentIndex = floor(targetTime / segmentDuration)
  3. Cancel in-flight segment fetches
  4. Start fetching from segmentIndex of current quality
  5. Fetch init segment again (MSE requires re-init after flush)
  6. Append from segmentIndex → play
```

### 8.6 Player error handling

| Error | Handling |
|-------|----------|
| Manifest fetch fails | Retry 3x with backoff. Show "Video unavailable" if all fail |
| Seal decrypt fails | Show access denied screen (wrong wallet? expired subscription?) |
| Single segment fails | Skip, show brief glitch, continue to next segment |
| >3 consecutive segment failures | Pause, show buffering indicator, try lower quality |
| SourceBuffer full | Evict already-played data, wait for `updateend` before appending |
| Network offline | Pause, show "Connection lost", auto-retry when online |

### 8.7 Build targets

- **@walrus/video-player**: Core engine (no UI). Importable anywhere.
- **@walrus/video-player-react**: React wrapper with `<WalrusVideo>` component.
- **@walrus/video-player-web**: Standalone `<walrus-video>` custom element (Web Component).
- **walrus-video.js**: UMD/IIFE build for `<script>` tag usage (like YouTube embed).

### 8.8 Browser support matrix

```
Feature                     Chrome  Firefox  Safari   Edge
─────────────────────────   ──────  ───────  ──────   ──────
MediaSource                 ✅ 23    ✅ 42    ✅ 8     ✅ 12
fMP4 in MSE                 ✅       ✅       ✅       ✅
Web Crypto (AES-GCM)        ✅ 37    ✅ 34    ✅ 11    ✅ 79
Custom Elements v1          ✅ 54    ✅ 63    ✅ 10.3  ✅ 79
AbortController             ✅ 66    ✅ 57    ✅ 12.1  ✅ 16

Minimum target: latest 2 versions of each
```

---

## 11. Phase 6: Aggregator Optimization

### 9.1 Current Walrus aggregator behavior (research needed)

Need to investigate:
- Does it cache blobs? TTL? Cache eviction policy?
- Does it support `Range` headers for partial reads?
- Does it support conditional requests (`If-None-Match`, `ETag`)?
- Maximum concurrent connections?
- Does it compress responses (gzip/brotli)?

### 9.2 Enhancements for video

If the base aggregator is insufficient, add a caching proxy layer:

```
Browser ──▶ Nginx/Varnish/Caddy ──▶ Walrus Aggregator ──▶ Storage Nodes
              │
              │ Cache config:
              │ - Cache all /v1/blobs/* responses
              │ - Cache-Control: public, max-age=31536000, immutable
              │ - Slice-by-slice cache (for Range requests)
              │ - Cache key: blobId (content-addressed, no busting needed)
              │ - Cache size: 100-500 GB depending on catalog size
```

Since Walrus blobs are immutable, caching is trivial:
- Cache key = blobId (URL path)
- Never expires (content-addressed, same blobId = same content forever)
- Only limit is disk space

### 9.3 Prefetching aggregator (optional)

If you run your own aggregator, add logic to prefetch upcoming segments:

```
During playback:
  Client requests segment N
  Aggregator returns segment N
  Aggregator also pre-warms: segments N+1, N+2, N+3
  (fetches from Walrus nodes in background, adds to cache)

Benefit: next client request hits cache, not Walrus nodes
Cost: additional bandwidth if segments aren't requested (waste for seeks)
```

### 9.4 Multi-region deployment

```
                    ┌──────────────┐
                    │  DNS (GeoLB) │
                    └──────┬───────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │ Aggregator  │ │ Aggregator  │ │ Aggregator  │
    │ US-East     │ │ EU-West     │ │ AP-Southeast│
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           │
                    Walrus Nodes
                    (globally distributed)
```

Each aggregator:
- 4 vCPU, 8 GB RAM, 200 GB SSD cache
- Runs the Walrus aggregator binary
- Behind Nginx for caching + Rate limiting + TLS termination

---

## 12. Phase 7: CDN & Edge Caching

### 10.1 Using Cloudflare / Fastly as CDN

```
User ──▶ Cloudflare Edge ──▶ Your Aggregator ──▶ Walrus
          │
          ├─ Cache segments (blobs are immutable = perfect CDN candidates)
          ├─ Cache manifest (until video updated, then purge)
          ├─ WAF / DDoS protection (included)
          └─ TLS termination (included)
```

### 10.2 Cache rules

```
Path                          Cache TTL          Behavior
───────────────────────────── ────────────────   ───────────────────────
/v1/blobs/{segmentBlobId}     Forever (immutable) Cache, serve stale
/v1/blobs/{manifestBlobId}    1 hour             Cache, purge on update
/v1/blobs/{thumbnailBlobId}   Forever             Cache
/api/*                        0 (no cache)        API calls pass through
```

### 10.3 Cache warming

On upload complete, optionally warm CDN:
- Issue HEAD/GET requests for first 10 segments of lowest quality from each edge location
- Ensures instant-start for first viewers
- Trade bandwidth for latency (only worth it for "premiere" content)

### 10.4 Bandwidth alliance

If CDN bandwidth costs are a concern, consider:
- Cloudflare Bandwidth Alliance (free egress to Walrus aggregator if same provider)
- BunnyCDN (cheaper egress, built-in video player)
- Self-host CDN with VPS + Nginx (cheapest, most work)

---

## 13. Phase 8: Access Control (Seal + Move)

### 11.1 Policy types

**Public** (no access control):
```
seal_approve(id, _clock):
  // Always approve
  return
```
No Seal encryption needed for VEK. Plain VEK in manifest. Fastest path.

**Token-gate** (must hold an NFT):
```
seal_approve(id, nft_object):
  // id encodes the NFT type
  // Verify caller owns at least one NFT of this type
  // Kiosk / obligation check
```

**Subscription** (must have active subscription):
```
seal_approve(id, subscription_nft, clock):
  // Verify subscription NFT exists and is not expired
  let expiry = subscription_nft.expiry_epoch;
  assert!(clock.epoch() < expiry, EExpired);
```

**Allowlist** (specific addresses):
```
seal_approve(id, allowlist, ctx):
  // Verify tx sender is in allowlist
  let sender = ctx.sender();
  assert!(allowlist.contains(sender), ENotAllowed);
```

**Hybrid** (creator can toggle):
```
seal_approve(id, policy_object):
  // Check policy_object.mode
  // Delegate to sub-policy
```

### 11.2 Move package structure

```
walrus_video/
├── sources/
│   ├── video_pointer.move       // VideoPointer object, create/update/transfer
│   ├── access_public.move       // seal_approve: always return
│   ├── access_token_gate.move   // seal_approve: owns NFT → return
│   ├── access_subscription.move // seal_approve: active subscription → return
│   ├── access_allowlist.move    // seal_approve: in allowlist → return
│   └── utils.move               // shared helpers
├── tests/
│   ├── video_pointer_tests.move
│   └── access_tests.move
└── Move.toml
```

### 11.3 Seal decryption flow (viewer side)

```
1. Player loads manifest → sees accessPolicy.type = "token-gate"
2. Player calls WalrusVideo.getAccess(policy):
   a. Build PTB calling {packageId}::token_gate::seal_approve
   b. Request session key from wallet (user signs once)
   c. Send to Seal key servers (threshold 2 of 3)
   d. Key servers:
      - Evaluate PTB on Sui → check if signer owns NFT
      - If yes: return decryption share
      - If no:  return 403
   e. SDK collects 2 shares → reconstructs VEK
3. Session key cached → subsequent views skip wallet approval (until expiry)
```

### 11.4 Session key management

```
Session lifetime:
  - Created on first Seal approval for this package/domain
  - Expires: 24 hours (configurable)
  - Scoped to: { packageId, domain (origin) }
  - Stored in: browser's IndexedDB (wallet extension manages)

Refresh:
  - SDK checks session validity before requesting key
  - If expired or not found: re-prompt wallet
  - If valid: use silently (no UX interruption)
```

---

## 14. Phase 9: Production Hardening

### 12.1 Security checklist

- [ ] VEK never stored in localStorage, sessionStorage, or cookies
- [ ] VEK held in closure variable or WebCrypto CryptoKey (non-extractable)
- [ ] Manifest only contains encrypted VEK
- [ ] All segment fetches over HTTPS (aggregator TLS)
- [ ] Content-Security-Policy on player page restricts script sources
- [ ] Aggregator does not log blob contents (only access logs: blobId, time, client IP)
- [ ] Rate limiting on upload API (prevent abuse of transcoding resources)
- [ ] Input validation on upload: max file size, allowed codecs, scan for malware
- [ ] Sui private key never touches transcoding server (signing done by uploader client)
- [ ] CORS configured on aggregator: only allow your player origins
- [ ] Subresource Integrity (SRI) on player SDK script tags
- [ ] Dependency audit (npm audit, cargo audit) in CI

### 12.2 Reliability

- [ ] All upload steps are idempotent (re-running with same input = same result)
- [ ] Upload checkpoint file for crash recovery (every 50 segments)
- [ ] Dead letter queue for failed transcode jobs
- [ ] Graceful degradation: if 2160p failed → upload succeeds with 1080p+
- [ ] Aggregator health checks (`/health` endpoint)
- [ ] Multiple aggregator URLs in player config (fallback)
- [ ] Multiple Seal key servers (2-of-3 minimum)
- [ ] Sui RPC failover (primary + secondary endpoints)
- [ ] Walrus publisher failover

### 12.3 Scalability

- [ ] Transcode worker pool can scale horizontally (more VMs)
- [ ] Job queue is persistent (Redis with disk persistence)
- [ ] Aggregator is stateless + cache (can add more instances behind LB)
- [ ] CDN absorbs most segment traffic (immutable = perfect caching)
- [ ] Sui pointer is O(1) to read (no iteration)

### 12.4 Upgrade path

The manifest includes a `version` field. The player SDK checks this:

```
version 1 → current format (as documented)
version 2 → might add: captions, chapters, multiple audio tracks, DRM metadata
```

Player SDK must gracefully handle unknown future fields (ignore, don't error).

Sui VideoPointer can be upgraded to `version: 2` with new fields via the Move upgrade mechanism.

---

## 15. Phase 10: Monitoring & Analytics

### 13.1 Server-side metrics

```
Transcoding server:
  - Jobs completed/failed per hour
  - Average transcode time per minute of video
  - GPU utilization %
  - Disk usage on working directory
  - Queue depth

Aggregator:
  - Requests per second (by endpoint)
  - Cache hit ratio (%) — target >80%
  - P50, P95, P99 latency per request
  - Errors (4xx, 5xx rates)
  - Bandwidth served (GB/hour)
  - Active connections

Upload Service:
  - Blobs uploaded per hour
  - Upload failure rate (%)
  - Average upload time per segment
  - Publisher rate limit hits (429 count)
```

### 13.2 Client-side telemetry (privacy-respecting)

```
Player SDK reports (opt-in, anonymized):
  - Playback start success rate (%)
  - Time-to-first-frame (ms) — target <3s
  - Average bitrate played
  - Quality switches per session (count)
  - Rebuffering events (count + total duration)
  - Segment fetch failures (count)
  - Seal decrypt latency (ms)
  - Browser / OS / connection type

NOT collected:
  - IP addresses
  - Wallet addresses
  - Which specific videos are watched
```

### 13.3 Alerting

| Condition | Severity | Action |
|-----------|----------|--------|
| Transcode failure rate >5% | P1 | Investigate ffmpeg/disk/GPU |
| Aggregator error rate >1% | P2 | Check Walrus connectivity |
| Cache hit ratio <60% | P3 | Increase cache size or check eviction |
| Time-to-first-frame >5s (P50) | P2 | Check CDN/aggregator latency |
| Seal key server unreachable | P1 | Failover to backup servers |

### 13.4 Cost monitoring

- Wallet balance (SUI for gas) — alert at low threshold
- Walrus storage reservation epochs remaining
- CDN bandwidth usage vs. budget
- Compute cost per transcode minute

---

## 16. Deployment Topology

### 14.1 Production layout

```
                       ┌──────────────────┐
                       │  Cloud DNS       │
                       │  (upload.wal.app │
                       │   player.wal.app │
                       │   agg.wal.app)   │
                       └────────┬─────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
┌─────────▼─────────┐ ┌────────▼────────┐  ┌─────────▼─────────┐
│ CDN (Cloudflare)  │ │ CDN (Cloudflare)│  │ CDN (Cloudflare)  │
│ - Player SDK JS  │ │ - Segment cache │  │ - API proxy      │
│ - Static assets   │ │   (immutable)  │  │ - Upload endpoint │
│ - Player HTML     │ │                 │  │ - Rate limiting   │
└─────────┬─────────┘ └────────┬────────┘  └─────────┬─────────┘
          │                    │                      │
┌─────────▼────────────────────▼──────────────────────▼─────────┐
│                         Your VPC                               │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ Transcode Server │  │ Aggregator x2     │                    │
│  │ + Job Queue      │  │ (behind LB)       │                    │
│  │ + Upload Worker  │  │ + Nginx cache     │                    │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                 │
│  ┌──────────────────┐                                           │
│  │  Redis            │  ← job queue + cache state              │
│  └──────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS
                                ▼
┌──────────────────────────────────────────────────────────────┐
│  External (already exists)                                     │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │ Walrus Nodes     │  │ Sui RPC          │                  │
│  │ (Testnet/Mainnet)│  │ (public/fullnode) │                  │
│  └──────────────────┘  └──────────────────┘                  │
│  ┌──────────────────┐                                          │
│  │ Seal Key Servers │  (public, 2-of-3)                       │
│  └──────────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

### 14.2 Infrastructure as Code

Use Terraform or Pulumi for:
- VPC + subnets
- Compute instances (transcode, aggregator)
- Redis instance
- Cloudflare zone records + cache rules
- Monitoring dashboards (Grafana)

### 14.3 CI/CD pipeline

```
Git Push → GitHub Actions
  ├─ Lint (ESLint, clippy)
  ├─ Type check (tsc)
  ├─ Unit tests (vitest, cargo test)
  ├─ Build (rollup/wasm-pack)
  ├─ Integration tests (testnet Walrus)
  └─ Deploy
       ├─ Player SDK → npm publish
       ├─ Transcode server → Docker push → redeploy
       ├─ Aggregator → binary build → deploy
       └─ Move contracts → sui client publish
```

---

## 17. Cost Model

### 15.1 Infrastructure (monthly, approximate)

| Resource | Spec | Monthly Cost |
|----------|------|-------------|
| Transcode VM | 8 vCPU, 32 GB RAM, GPU (T4), 200 GB SSD | $200-400 |
| Aggregator VMs (×2) | 4 vCPU, 8 GB RAM, 200 GB SSD | $40-80 |
| Redis | 2 GB managed | $20-30 |
| Cloudflare | Pro plan | $20 |
| CDN bandwidth | Variable (100 TB = ~$500 on most) | $0-500+ |
| **Total infrastructure** | | **$280-1,030/month** |

### 15.2 Walrus costs (per video, approximate)

Depends entirely on Walrus pricing. Use https://costcalculator.wal.app/ for current rates.

```
Example: 2-hour 4K movie, 5 qualities, 12 epochs (~6 months)

Encoded data: ~200 GB
Storage cost: 200 GB × price_per_gb_per_epoch × 12 epochs
Write cost: one-time fee per blob × 7,200 segments + 1 manifest

These are paid in SUI and depend on network conditions.
```

### 15.3 Monetization considerations

- Per-view pricing (pay-per-stream)
- Subscription model (monthly pass for all videos)
- NFT-gated (revenue from NFT sales)
- Creator-owned (uploader pays, viewers watch free)
- Ad-supported (traditional video ad insertion)

---

## 18. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Walrus blob not available (nodes down) | Low | High | 4.5x redundancy in encoding; retry logic in player |
| Seal key server down | Low | High | Use 2-of-3 threshold; player has fallback server list |
| Sui RPC rate limited | Medium | Medium | Multiple RPC endpoints; cache pointer reads |
| Transcode server crashes mid-job | Medium | Low | Job queue with retry; checkpoint recovery; dead letter queue |
| 4K transcode takes too long | Medium | Medium | GPU acceleration; allow lower-quality-only upload; progress visible to user |
| Upload bandwidth exceeds time budget | Medium | Medium | Publisher service uploads on behalf of user; parallel uploads |
| Browser doesn't support AES-GCM | Low | Medium | Fallback to AES-CBC; polyfill; show unsupported browser warning |
| Segment decryption too slow in browser | Low | Low | Web Crypto is hardware-accelerated; 30 MB takes <50ms |
| Manifest too large for single blob | Low | Low | Gzip compression; max manifest is ~1 MB for 7K segments (fits easily) |
| CDN costs explode | Medium | Medium | Monitor; set spending caps; immutable blobs = high cache hit (low origin egress) |
| Walrus epoch ends, blob deleted | Low | High | Monitor epoch expiry; auto-renew storage for active videos; alert before expiry |
| Regulatory (content takedown) | Low | Medium | Sui pointer can be burned; blobs persist until epoch expires; Terms of Service |
| SDK dependency vulnerability | Medium | Medium | Automated dependency scanning (Dependabot, npm audit); lockfile |

---

## Appendix A: Development Phases Summary

### MVP milestones

```
v0.1 — Upload & Watch Platform       (6-8 weeks)
  ├─ Bootstrapping (turborepo + infra)    1 week
  ├─ Phase 0: Research + E2E prototype    1-2 weeks
  ├─ Phase 1: Transcoding (single quality) 2-3 weeks
  ├─ Phase 3: Upload to Walrus            1-2 weeks
  └─ Phase 4: Manifest + Sui pointer      1 week
     ─────────────────────────────────
     DEMOABLE: Upload → watch on testnet

v0.2 — Encryption + Standalone SDK   (+3-4 weeks)
  ├─ Phase 2: Encryption + key mgmt      1-2 weeks
  ├─ Phase 5: Player SDK extraction      1-2 weeks
  └─ Phase 8: Access control (Seal)      1-2 weeks

v0.3 — Full ABR + SDK Distribution    (+3-4 weeks)
  ├─ Phase 1 (multi-quality): ABR ladder 1 week
  ├─ Phase 5 (ABR + React wrapper)       1-2 weeks
  └─ Phase 6-7: Aggregator + CDN        1-2 weeks

Post-MVP:
  Phase 9:  Hardening                 (2-3 weeks)
  Phase 10: Monitoring                (1-2 weeks)
─────────────────────────────────
Total:   ~12-22 weeks (3-5 months)
```

## Appendix B: Key Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo | Turborepo (pnpm) | Parallel builds, shared config, TS + Rust in one repo |
| Web platform | Next.js + React + TypeScript | SSR, API routes, ecosystem |
| Transcoding service | Rust | Performance-critical; ffmpeg orchestration + Walrus upload |
| Player SDK | TypeScript (extracted from web app in v0.2) | Browser target, tree-shakeable |
| Segment format | fMP4 (CMAF) | MSE native, HLS + DASH compatible |
| Streaming protocol | HLS | Widest browser support, simple manifest |
| Encryption cipher | AES-256-GCM | Authenticated, fast, Seal-recommended |
| Encryption model | Envelope (Seal + AES) | 1 Seal call per session, not per segment |
| Key servers | 2-of-3 threshold | Tolerates 1 server failure |
| Manifest encoding | JSON + Gzip | Human-readable, simple, adequate for <10K segments |
| Transcode engine | ffmpeg CLI | Battle-tested, GPU support, all codecs |
| Player core | HLS.js (extended) | Lightweight, good fMP4 support, easy to extend |
| Move contracts | Separate package | Upgradeable, clean separation of concerns |
| Caching | Aggregator + CDN | Immutable blobs = perfect caching, zero invalidation |
| Job queue | Redis + BullMQ | Persistent, retry support, monitoring built-in |
