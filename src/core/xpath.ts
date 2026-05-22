export function normalizeXpath(xpath: string): string {
  return xpath
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\[\s*@name\s*=\s*(['"])(.*?)\1\s*\]/g, "[@name='$2']")
    .replace(/\[\s*@id\s*=\s*(['"])(.*?)\1\s*\]/g, "[@id='$2']")
    .replace(/\[\s*\d+\s*\]/g, "[]")
    .replace(/\/@[\w.-]+$/g, "")
    .toLowerCase();
}
