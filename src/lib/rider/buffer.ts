import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import type { LocationPoint } from "@/types/domain";

/**
 * Offline-first GPS buffer (SPEC section 2): EVERY captured point lands in
 * IndexedDB first, and is deleted only after the server confirms the batch.
 * Network loss mid-delivery therefore loses zero points — sync just resumes
 * on reconnect.
 */

export interface BufferedPoint extends LocationPoint {
  delivery_id: string | null;
}

interface RiderDB extends DBSchema {
  points: {
    key: number;
    value: BufferedPoint;
  };
}

let dbPromise: Promise<IDBPDatabase<RiderDB>> | null = null;

function db(): Promise<IDBPDatabase<RiderDB>> {
  dbPromise ??= openDB<RiderDB>("relaytrack-rider", 1, {
    upgrade(database) {
      database.createObjectStore("points", { autoIncrement: true });
    },
  });
  return dbPromise;
}

export async function bufferPoint(point: BufferedPoint): Promise<void> {
  await (await db()).add("points", point);
}

export async function peekBatch(
  limit: number,
): Promise<{ keys: number[]; points: BufferedPoint[] }> {
  const database = await db();
  const tx = database.transaction("points", "readonly");
  const keys: number[] = [];
  const points: BufferedPoint[] = [];
  let cursor = await tx.store.openCursor();
  while (cursor && points.length < limit) {
    keys.push(cursor.key);
    points.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return { keys, points };
}

export async function deleteBatch(keys: number[]): Promise<void> {
  const database = await db();
  const tx = database.transaction("points", "readwrite");
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
}

export async function pendingCount(): Promise<number> {
  return (await db()).count("points");
}
