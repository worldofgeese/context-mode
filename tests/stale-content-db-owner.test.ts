/**
 * cleanupStaleContentDBs must not delete a content DB that a live process
 * still has open. A non-empty WAL that has been idle for over an hour is not
 * proof that its owner is dead: an idle session keeps its WAL until the next
 * checkpoint. Deleting the files under a live connection makes every later
 * write in that session fail with SQLITE_IOERR ("disk I/O error").
 */
import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, utimesSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentStore, cleanupStaleContentDBs } from "../src/store.js";

function staleWalFixture(dir: string, name: string): string {
  const db = join(dir, name);
  writeFileSync(db, "db");
  writeFileSync(db + "-wal", "non-empty wal");
  writeFileSync(db + "-shm", "shm");
  const twoHoursAgo = (Date.now() - 2 * 3600_000) / 1000;
  for (const s of ["", "-wal", "-shm"]) utimesSync(db + s, twoHoursAgo, twoHoursAgo);
  return db;
}

describe("cleanupStaleContentDBs and live owners", () => {
  test("keeps a DB with an idle WAL while its owner process is alive", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-owner-"));
    const db = staleWalFixture(dir, "live.db");
    mkdirSync(db + ".owners");
    writeFileSync(join(db + ".owners", String(process.pid)), "");

    expect(cleanupStaleContentDBs(dir, 14)).toBe(0);
    for (const s of ["", "-wal", "-shm"]) expect(existsSync(db + s)).toBe(true);
  });

  test("still removes a DB with an idle WAL when its owners are dead", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-owner-"));
    const db = staleWalFixture(dir, "dead.db");
    mkdirSync(db + ".owners");
    writeFileSync(join(db + ".owners", "2147483646"), ""); // no such pid

    expect(cleanupStaleContentDBs(dir, 14)).toBe(1);
    for (const s of ["", "-wal", "-shm"]) expect(existsSync(db + s)).toBe(false);
    expect(existsSync(db + ".owners")).toBe(false);
  });

  test("still removes a DB with an idle WAL and no owner record (legacy)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-owner-"));
    const db = staleWalFixture(dir, "legacy.db");
    expect(cleanupStaleContentDBs(dir, 14)).toBe(1);
    expect(existsSync(db)).toBe(false);
  });

  test("a ContentStore registers itself as owner and unregisters on close", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-owner-"));
    const dbPath = join(dir, "store.db");
    const store = new ContentStore(dbPath);
    expect(existsSync(join(dbPath + ".owners", String(process.pid)))).toBe(true);
    store.close();
    expect(existsSync(join(dbPath + ".owners", String(process.pid)))).toBe(false);
  });
});

describe("owner records for in-memory DBs", () => {
  test("an in-memory ContentStore writes no owner record", () => {
    const store = new ContentStore(":memory:");
    store.close();
    expect(existsSync(":memory:.owners")).toBe(false);
  });
});
