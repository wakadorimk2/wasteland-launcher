import path from "node:path";

export const defaultMo2Path = "C:\\Modding\\MO2";
export const defaultProfile = "Default";

export function profilePath(mo2Path: string, profile: string): string {
  return path.join(mo2Path, "profiles", profile);
}

export function modlistPath(mo2Path: string, profile: string): string {
  return path.join(profilePath(mo2Path, profile), "modlist.txt");
}

export function modsPath(mo2Path: string): string {
  return path.join(mo2Path, "mods");
}

export function appDataLogsPath(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    return "";
  }
  return path.join(appData, "7DaysToDie", "logs");
}

export function toPosixRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}
