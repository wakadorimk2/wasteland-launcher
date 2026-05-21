import { buildSampleModel, buildUiModel } from "./model";
import type { ContextPack, UiModel } from "./types";

const storedContextKey = "wasteland-launcher.contextPack";

export async function loadInitialModel(): Promise<UiModel> {
  try {
    const response = await fetch("/context.json", { cache: "no-store" });
    if (response.ok) {
      return buildUiModel((await response.json()) as ContextPack, "context");
    }
  } catch {
    // Fall through to bundled sample data.
  }

  const stored = loadStoredContext();
  if (stored) return stored;

  return buildSampleModel();
}

export function readContextFile(file: File): Promise<UiModel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const pack = JSON.parse(text) as ContextPack;
        storeContext(text);
        resolve(buildUiModel(pack, "context"));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
  });
}

function loadStoredContext(): UiModel | null {
  try {
    const text = window.localStorage.getItem(storedContextKey);
    if (!text) return null;
    return buildUiModel(JSON.parse(text) as ContextPack, "context");
  } catch {
    window.localStorage.removeItem(storedContextKey);
    return null;
  }
}

function storeContext(text: string): void {
  try {
    window.localStorage.setItem(storedContextKey, text);
  } catch {
    // Ignore storage quota or privacy-mode failures; the loaded file still opens.
  }
}
