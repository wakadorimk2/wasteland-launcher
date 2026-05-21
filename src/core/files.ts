import { createHash } from "node:crypto";
import { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(root: string, predicate: (filePath: string, dirent: Dirent) => boolean): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && predicate(fullPath, entry)) {
        out.push(fullPath);
      }
    }
  }

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function fileSizeAndMtime(filePath: string): Promise<{ size: number; mtime: string }> {
  const info = await stat(filePath);
  return {
    size: info.size,
    mtime: info.mtime.toISOString()
  };
}
