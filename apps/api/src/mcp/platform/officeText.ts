import yauzl from "yauzl";

const MAX_UNCOMPRESSED_XML_BYTES = 20_000_000;

type OfficeMimeType =
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "application/vnd.ms-excel.sheet.macroEnabled.12";

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXmlText(match[1] ?? ""))
    .filter(Boolean);
}

function naturalOfficePathCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

async function selectedZipEntries(
  bytes: Buffer,
  include: (path: string) => boolean,
): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    yauzl.fromBuffer(bytes, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        finishError(new Error("Office file is not a valid ZIP archive"));
        return;
      }

      const entries = new Map<string, string>();
      let uncompressedBytes = 0;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith("/") || !include(entry.fileName)) {
          zip.readEntry();
          return;
        }
        uncompressedBytes += entry.uncompressedSize;
        if (uncompressedBytes > MAX_UNCOMPRESSED_XML_BYTES) {
          zip.close();
          finishError(new Error("Office XML exceeds the safe extraction limit"));
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            finishError(streamError ?? new Error("Could not read Office XML entry"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", (error) => finishError(error));
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.on("error", (error: unknown) =>
        finishError(error instanceof Error ? error : new Error(String(error))),
      );
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(entries);
      });
      zip.readEntry();
    });
  });
}

function documentText(entries: Map<string, string>): string {
  const xml = entries.get("word/document.xml");
  if (!xml) throw new Error("DOCX is missing word/document.xml");
  const withBreaks = xml
    .replace(/<w:tab\s*\/>/g, "<t>\t</t>")
    .replace(/<w:(?:br|cr)\s*\/>/g, "<t>\n</t>")
    .replace(/<\/w:p>/g, "<t>\n</t>")
    .replace(/<\/w:tr>/g, "<t>\n</t>");
  return textNodes(withBreaks.replace(/<w:t/g, "<t").replace(/<\/w:t>/g, "</t>"))
    .join("")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function presentationText(entries: Map<string, string>): string {
  const slides = [...entries.entries()]
    .filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(([left], [right]) => naturalOfficePathCompare(left, right));
  if (slides.length === 0) throw new Error("PPTX contains no readable slides");
  return slides
    .map(([path, xml]) => {
      const number = /slide(\d+)\.xml$/.exec(path)?.[1] ?? "?";
      return `## Slide ${number}\n${textNodes(xml).join("\n")}`;
    })
    .join("\n\n")
    .trim();
}

function attributeValue(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return match?.[1] ? decodeXmlText(match[1]) : undefined;
}

function workbookSheetNames(entries: Map<string, string>): string[] {
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) return [];
  return [...workbook.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map(
    (match, index) => attributeValue(match[1] ?? "", "name") ?? `Sheet ${index + 1}`,
  );
}

function spreadsheetText(entries: Map<string, string>): string {
  const sharedStringsXml = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml
    ? [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
        textNodes(match[1] ?? "").join(""),
      )
    : [];
  const names = workbookSheetNames(entries);
  const sheets = [...entries.entries()]
    .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort(([left], [right]) => naturalOfficePathCompare(left, right));
  if (sheets.length === 0) throw new Error("XLSX contains no readable worksheets");

  return sheets
    .map(([path, xml], sheetIndex) => {
      const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
        .map((rowMatch) => {
          const cells = [
            ...(rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g),
          ].map((cellMatch) => {
            const attributes = cellMatch[1] ?? "";
            const body = cellMatch[2] ?? "";
            const reference = attributeValue(attributes, "r") ?? "?";
            const type = attributeValue(attributes, "t");
            const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
            const value =
              type === "s"
                ? (sharedStrings[Number.parseInt(raw, 10)] ?? raw)
                : type === "inlineStr"
                  ? textNodes(body).join("")
                  : decodeXmlText(raw);
            return `${reference}=${value}`;
          });
          return cells.join(" | ");
        })
        .filter(Boolean);
      const fallbackNumber = /sheet(\d+)\.xml$/.exec(path)?.[1] ?? `${sheetIndex + 1}`;
      return `## ${names[sheetIndex] ?? `Sheet ${fallbackNumber}`}\n${rows.join("\n")}`;
    })
    .join("\n\n")
    .trim();
}

export async function extractOfficeText(
  mimeType: OfficeMimeType,
  bytes: Buffer,
): Promise<string> {
  if (mimeType.endsWith("wordprocessingml.document")) {
    return documentText(
      await selectedZipEntries(bytes, (path) => path === "word/document.xml"),
    );
  }
  if (mimeType.endsWith("presentationml.presentation")) {
    return presentationText(
      await selectedZipEntries(bytes, (path) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(path),
      ),
    );
  }
  return spreadsheetText(
    await selectedZipEntries(
      bytes,
      (path) =>
        path === "xl/sharedStrings.xml" ||
        path === "xl/workbook.xml" ||
        /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
    ),
  );
}
