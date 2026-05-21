import { buildSampleModel, buildUiModel } from "./model";
import type { ContextPack, UiModel } from "./types";

export async function loadInitialModel(): Promise<UiModel> {
  try {
    const response = await fetch("/context.json", { cache: "no-store" });
    if (response.ok) {
      return buildUiModel((await response.json()) as ContextPack, "context");
    }
  } catch {
    // Fall through to bundled sample data.
  }
  return buildSampleModel();
}

export function readContextFile(file: File): Promise<UiModel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        resolve(buildUiModel(JSON.parse(String(reader.result)) as ContextPack, "context"));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
  });
}
