import assert from "node:assert/strict";
import test from "node:test";
import yazl from "yazl";
import { extractOfficeText } from "./officeText.js";

async function zip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    for (const [path, content] of Object.entries(entries)) {
      archive.addBuffer(Buffer.from(content), path);
    }
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.end();
  });
}

void test("extracts paragraphs and entities from DOCX", async () => {
  const bytes = await zip({
    "word/document.xml":
      '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>',
  });

  const text = await extractOfficeText(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes,
  );

  assert.equal(text, "Hello & welcome\nSecond line");
});

void test("extracts shared and inline strings from XLSX", async () => {
  const bytes = await zip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Processes" sheetId="1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>Process</t></si><si><t>Saving</t></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Accounting</t></is></c><c r="B2"><v>25</v></c></row></sheetData></worksheet>',
  });

  const text = await extractOfficeText(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  );

  assert.equal(text, "## Processes\nA1=Process | B1=Saving\nA2=Accounting | B2=25");
});

void test("extracts XLSM values without reading embedded macros", async () => {
  const bytes = await zip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Safe values"/></sheets></workbook>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Visible</t></is></c></row></sheetData></worksheet>',
    "xl/vbaProject.bin": "macro bytes are intentionally ignored",
  });

  const text = await extractOfficeText(
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    bytes,
  );

  assert.equal(text, "## Safe values\nA1=Visible");
});

void test("extracts slides in numeric order from PPTX", async () => {
  const bytes = await zip({
    "ppt/slides/slide10.xml": "<p:sld><a:t>Tenth</a:t></p:sld>",
    "ppt/slides/slide2.xml": "<p:sld><a:t>Second</a:t></p:sld>",
  });

  const text = await extractOfficeText(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes,
  );

  assert.equal(text, "## Slide 2\nSecond\n\n## Slide 10\nTenth");
});

void test("rejects malformed Office archives", async () => {
  await assert.rejects(
    extractOfficeText(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Buffer.from("not a zip"),
    ),
    /not a valid ZIP archive/,
  );
});
