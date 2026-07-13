# Video phase 3 technical evaluation

Recovery branch starting `main` SHA: `2cba8324333655d526ff864d273c33c9baee365e`.

## Options considered

### `gpmf-extract` plus `gopro-telemetry`

`gpmf-extract` locates the GoPro GPMF track in MP4/MOV files and returns raw GPMF plus timing data for `gopro-telemetry`. The maintained source documents a `File` input and includes a known large-file memory item in its own TODO list. `gopro-telemetry` then converts the extracted track into higher-level streams and supports substantially more telemetry and timing policy than V1 needs. Both repositories are MIT licensed. This path has the best semantic coverage, but couples the server bundle to two broad parser packages and does not provide the repository's required Supabase range-reader boundary without an additional adapter and memory audit.

### Minimal bounded parser

A minimal parser can keep V1 narrowly focused on clock alignment: bounded range reads, top-level MP4 box traversal, `gpmd` track/sample-table lookup (`stco`/`co64`, `stsc`, and `stsz`), MP4 duration, and the GPMF GPS UTC (`GPSU`) KLV entry. It avoids turning camera GPS into a boat track, keeps parser details behind a normalized interface, and adds no runtime dependency. The tradeoff is narrower camera/model coverage; unsupported or missing telemetry intentionally falls back to manual UTC alignment.

## Runtime, memory, and hosting constraints

Vercel documents function duration and memory as explicit deployment constraints, and documents a small request-body limit that makes direct browser-to-storage uploads the correct pattern for large videos. Supabase Storage supports private objects and signed URLs; Phase 3 processing uses short-lived server-created signed URLs with HTTP range requests so the function reads bounded chunks and never accepts a video body from the client.

The selected implementation does not write temp files. It jumps across top-level boxes without reading `mdat`, caps `moov` metadata at 8 MiB, performs individual reads in chunks of at most 256 KiB, and reads at most 16 advertised telemetry samples totaling at most 2 MiB. It therefore never buffers the whole video. It fails closed with sanitized errors when metadata cannot be extracted within those bounds.

## Licensing and maintenance

The selected bounded parser adds no runtime dependency or third-party license to the server bundle. `gpmf-extract` and `gopro-telemetry` are maintained source projects with MIT licenses and remain viable future candidates if broader camera coverage is required, but adoption should follow a separate range-I/O integration and memory audit.

## Selected Phase 3 approach

Use a server-only minimal bounded parser for V1, with a pure normalized result:

- `startUtcMs`
- `durationMs`
- `provenance: "telemetry" | "manual"`
- parser identifier

Persist only sanitized timing summaries and sanitized failure codes/messages. Keep videos private, keep reads server-mediated, and keep manual alignment as the supported fallback when telemetry is absent or unsupported.

## Primary sources reviewed

- Issue #9 phase requirements: https://github.com/jcarterwil/Sailing/issues/9
- `gpmf-extract` maintained package source: https://github.com/JuanIrache/gpmf-extract
- `gopro-telemetry` package page: https://www.npmjs.com/package/gopro-telemetry
- `gopro-telemetry` maintained source/license: https://github.com/JuanIrache/gopro-telemetry
- GoPro GPMF parser source, KLV format, and license: https://github.com/gopro/gpmf-parser
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Supabase private Storage downloads and signed URLs: https://supabase.com/docs/guides/storage/serving/downloads
