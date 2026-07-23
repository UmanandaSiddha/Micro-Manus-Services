import { marked } from 'marked';
import puppeteer from 'puppeteer';

/**
 * Markdown → typeset A4 PDF.
 *
 * The browser is launched per render and closed in `finally` — deliberately
 * NOT kept alive. Puppeteer 25's `headless: true` (new headless) spawns a
 * VISIBLE empty window on Windows, and a persistent instance leaves it
 * lingering on the desktop. `headless: 'shell'` uses chrome-headless-shell,
 * which never opens a window. In Docker we point at the apt `chromium`
 * (Linux, no display) and use plain headless.
 */
function launchArgs() {
  const systemChromium = process.env.PUPPETEER_EXECUTABLE_PATH;
  return {
    headless: (systemChromium ? true : 'shell') as boolean | 'shell',
    executablePath: systemChromium || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
}

/** Kept for the OnModuleDestroy hook — nothing persistent to close now. */
export async function closeBrowser(): Promise<void> {}

// Typeset report stylesheet. Fonts degrade gracefully in the Docker image
// (fonts-liberation): Georgia→Liberation Serif, Segoe UI→Liberation Sans.
const SANS = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
const CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; }
  body {
    font-family: Georgia, 'Times New Roman', serif; color: #1f2430;
    margin: 0; font-size: 10.5pt; line-height: 1.7;
    orphans: 3; widows: 3; hyphens: auto;
  }

  /* ── cover block ─────────────────────────────── */
  .cover { margin: 0 0 30px; padding: 26px 0 22px; border-bottom: 2.5px solid #4f46e5; }
  .cover .brand {
    font-family: ${SANS}; font-size: 8pt; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: #4f46e5; margin: 0 0 14px;
  }
  .cover h1 {
    font-family: ${SANS}; font-size: 25pt; font-weight: 650; letter-spacing: -.015em;
    line-height: 1.18; margin: 0 0 12px; color: #14161f;
  }
  .cover .meta { font-family: ${SANS}; font-size: 8.5pt; color: #7b8194; margin: 0; }

  /* ── headings ────────────────────────────────── */
  h1, h2, h3, h4 { font-family: ${SANS}; color: #14161f; line-height: 1.3; break-after: avoid; }
  h1 { font-size: 15pt; font-weight: 650; letter-spacing: -.01em; margin: 30px 0 10px; }
  h2 {
    font-size: 12.5pt; font-weight: 650; margin: 26px 0 9px; padding-bottom: 5px;
    border-bottom: 1px solid #e3e5ec;
  }
  h2::before { content: ''; display: inline-block; width: 9px; height: 9px; border-radius: 2px;
    background: linear-gradient(135deg, #6366f1, #22d3ee); margin-right: 8px; }
  h3 { font-size: 11pt; font-weight: 650; margin: 20px 0 6px; }
  h4 { font-size: 10pt; font-weight: 650; margin: 16px 0 4px; color: #3c4152; }

  /* ── text ────────────────────────────────────── */
  p { margin: 8px 0; }
  strong { color: #14161f; }
  a { color: #4338ca; text-decoration: none; }
  sup { font-family: ${SANS}; font-size: 7pt; color: #4f46e5; }
  ul, ol { margin: 8px 0; padding-left: 20px; }
  li { margin: 4.5px 0; padding-left: 2px; }
  li::marker { color: #6366f1; }

  blockquote {
    break-inside: avoid; border-left: 3px solid #818cf8; background: #f6f7ff;
    margin: 14px 0; padding: 9px 14px; border-radius: 0 6px 6px 0; color: #3d4254;
  }
  blockquote p { margin: 4px 0; }

  code { font-family: Consolas, 'Liberation Mono', monospace; font-size: 8.6pt;
    background: #f1f2f7; padding: 1px 5px; border-radius: 3px; color: #3730a3; }
  pre { break-inside: avoid; background: #f7f8fb; border: 1px solid #e3e5ec; border-left: 3px solid #c7d2fe;
    border-radius: 6px; padding: 11px 13px; overflow-x: hidden; white-space: pre-wrap; }
  pre code { background: none; padding: 0; color: #1f2430; }

  /* ── tables ──────────────────────────────────── */
  table { break-inside: avoid; border-collapse: collapse; width: 100%; margin: 14px 0;
    font-size: 9pt; font-family: ${SANS}; }
  th { background: #eef0ff; color: #2b2f6e; font-weight: 650; text-align: left;
    padding: 7px 10px; border-bottom: 2px solid #c7d2fe; }
  td { padding: 6.5px 10px; border-bottom: 1px solid #e9eaf1; vertical-align: top; }
  tr:nth-child(even) td { background: #fafbff; }

  hr { border: none; border-top: 1px solid #e3e5ec; margin: 24px 0; }
  img { max-width: 100%; }

  /* Sources: long URLs must wrap, keep the list compact */
  li a { word-break: break-all; }
`;

export async function renderPdf(
  title: string,
  contentMd: string,
): Promise<Buffer> {
  const bodyHtml = await marked.parse(contentMd, { async: true });
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="cover">
    <p class="brand">MicroManus · Deep Research</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">${date}</p>
  </div>
  ${bodyHtml}
</body></html>`;

  const browser = await puppeteer.launch(launchArgs());
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '18mm', left: '17mm', right: '17mm' },
      displayHeaderFooter: true,
      // Running document title on every page after the cover-bearing first.
      headerTemplate: `<div style="width:100%;font-size:7px;color:#9ca3af;font-family:Arial,sans-serif;
          padding:0 17mm;display:flex;justify-content:space-between;">
        <span style="max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title)}</span>
        <span style="color:#c7d2fe;">●</span></div>`,
      footerTemplate: `<div style="width:100%;font-size:7.5px;color:#9ca3af;font-family:Arial,sans-serif;
          padding:0 17mm;display:flex;justify-content:space-between;">
        <span>MicroManus deep research</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close(); // no lingering Chromium window
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
