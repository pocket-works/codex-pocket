import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import { pdfCitation } from "../src/ui/file-citation.js";

const markdown = new Marked({ extensions: [pdfCitation] });

describe("PDF citations", () => {
  it("renders a clickable filename for a PDF citation in a list", () => {
    const html = markdown.parse('- 非遗修脚：:codex-file-citation{path="/Users/test/output/清华池-01-待审核.pdf" purpose="output"}');
    expect(html).toContain('class="file-citation" data-pdf-path="/Users/test/output/清华池-01-待审核.pdf"');
    expect(html).toContain("清华池-01-待审核.pdf</span>");
    expect(html).not.toContain(":codex-file-citation");
  });

  it("does not interpret citations inside code", () => {
    const citation = ':codex-file-citation{path="/tmp/test.pdf" purpose="output"}';
    expect(markdown.parse(`\`${citation}\`\n\n\`\`\`text\n${citation}\n\`\`\``)).not.toContain("file-citation\"");
  });

  it("escapes an untrusted path in HTML attributes and text", () => {
    const html = markdown.parse(':codex-file-citation{path="/tmp/<img onerror=alert(1)>&.pdf" purpose="output"}');
    expect(html).toContain("&lt;img onerror=alert(1)&gt;&amp;.pdf");
    expect(html).not.toContain("<img");
  });
});
