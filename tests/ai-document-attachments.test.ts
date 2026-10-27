// @vitest-environment node
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { prepareAiAttachment } from '@/lib/ai-attachments';

function pdfFixture(text: string): ArrayBuffer {
  const stream = 'BT /F1 12 Tf 72 720 Td (' + text + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += i + 1 + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = pdf.length;
  pdf +=
    'xref\n0 ' +
    (objects.length + 1) +
    '\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
      .join('');
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(pdf).buffer;
}
async function docxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Research DOCX fixture</w:t></w:r></w:p><w:p><w:r><w:t>样本编号：A-42</w:t></w:r></w:p></w:body></w:document>',
  );
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
describe('真实文档附件提取', () => {
  it('从有效PDF字节中提取正文，不使用伪造提取结果', async () => {
    const attachment = await prepareAiAttachment(
      new File([pdfFixture('Research PDF attachment 42')], 'paper.pdf', { type: 'application/pdf' }),
      { id: 'pdf-42' },
    );
    expect(attachment.kind).toBe('text');
    expect(attachment.text).toContain('Research PDF attachment 42');
  });
  it('从实际DOCX压缩包中提取中英文段落', async () => {
    const attachment = await prepareAiAttachment(
      new File([await docxFixture()], 'notes.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    expect(attachment.kind).toBe('text');
    expect(attachment.text).toContain('Research DOCX fixture');
    expect(attachment.text).toContain('样本编号：A-42');
  });
  it('损坏的PDF与假DOCX不冒充已读正文', async () => {
    await expect(
      prepareAiAttachment(new File(['%PDF-1.4 broken'], 'broken.pdf', { type: 'application/pdf' })),
    ).rejects.toThrow('无法提取');
    await expect(prepareAiAttachment(new File(['not a zip'], 'broken.docx'))).rejects.toThrow('有效的 DOCX');
  });
});
