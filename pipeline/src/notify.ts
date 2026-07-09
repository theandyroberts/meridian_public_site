import type { TransferRecord } from "@platelab/shared/server";
export async function notifyHandoffComplete(_rec: TransferRecord): Promise<void> {}
export async function notifyHandoffFailed(_rec: TransferRecord, _message: string): Promise<void> {}
