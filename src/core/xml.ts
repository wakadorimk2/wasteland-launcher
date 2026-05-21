import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

export async function parseXmlFile(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  return parser.parse(text);
}

export function readXmlAttribute(tagText: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(tagText);
  return match?.[2] ?? match?.[3];
}
