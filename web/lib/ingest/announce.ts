import { z } from "zod";

/** handoffId becomes a directory name in the inbox — path-safe tokens only. */
export const announceBodySchema = z.object({
  handoffId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  bytes: z.number().int().positive(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  clipCount: z.number().int().positive(),
});

/**
 * Burst-safe disk guard: free space minus bytes already promised to
 * in-flight transfers must cover 2.5x the new announcement.
 */
export function checkDiskGuard(freeBytes: number, reservedBytes: number, announcedBytes: number): boolean {
  return freeBytes - reservedBytes >= 2.5 * announcedBytes;
}
