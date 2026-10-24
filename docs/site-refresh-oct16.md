# October 2026 site refresh

## MLS preview appearance source

Copied via the existing Screen Sharing session from Drew’s Mac mini on October 16, 2026:
`/Users/spherislivestitch/Documents/LED wall viewer/src/`. The working tree includes local changes; the hashes below identify the exact files read.

- `main.js`: SHA-256 `e1b356d3e8d78d8b4fb791939687f89de564f01989e06b1a93b41a8266100ebe`
- `vehicle-look.js`: SHA-256 `f2f8752484609d9788abb46cf548a967f415c258abd9afb5f6894a46f1b8470b`
- `vehicle-optics.js`: SHA-256 `cfcee836542b5c486468ed5015f077d7502ae6dcee329bdb68173aff0a849a2b`
- `environment-lighting.js`: SHA-256 `1068d11ef9db6dd459707e5f84a130341de0ad2ad309c12a6ad52d383a57b896`

The stage uses the MLS full-panorama environment (512-pixel linear cubemap, 2× radiance, PMREM filtering, 20 Hz capture limit), neutral fallback lights, clear-window reflection treatment, and default light dust/scratches. Missing lower-hemisphere pixels contribute no light. The fixed projection origin is independent of the inspection camera. Each vehicle retains its physical scale and is grounded from its own transformed bounds. These are preview alignment choices; the source has no surveyed capture-height calibration.

The supplied JPEG is shared by both site variants and the viewer/export branding. Replace that shared asset and its dimensions when the SVG is supplied.
