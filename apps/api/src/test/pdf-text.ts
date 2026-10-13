import zlib from 'node:zlib'

/**
 * Read a rendered PDF buffer well enough to assert on what the patient sees.
 *
 * Added for #541, whose done criterion is "exactly ONE document containing all
 * nine descriptions": asserting the data that goes INTO the renderer cannot
 * tell one document from nine, so the assertion has to be made on the bytes.
 *
 * Measured against @react-pdf/renderer's output (2026-10-13):
 *  - every content stream is `/Filter /FlateDecode`, so it must be inflated;
 *  - text is emitted as `[<hex> kern <hex> ...] TJ` inside `BT ... ET`, never
 *    as a literal `(string) Tj`, which is why a plain `buffer.includes('...')`
 *    always fails and is not evidence of a missing string;
 *  - the hex is the font's glyph encoding, which for the embedded Helvetica
 *    subset coincides with latin1 (`f3` -> `ó`), so a latin1 decode of the hex
 *    reproduces the source string, accents included.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  let out = ''
  const streamStart = /stream\r?\n/g
  let match: RegExpExecArray | null
  while ((match = streamStart.exec(raw))) {
    const start = match.index + match[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    const slice = raw.slice(start, end)
    let content: string
    try {
      content = zlib.inflateSync(Buffer.from(slice, 'latin1')).toString('latin1')
    } catch {
      content = slice // not deflated: read it as-is
    }
    for (const run of content.match(/\[[^\]]*\]\s*TJ/g) ?? []) {
      // A single Text child is one run, split only by kerning offsets, so
      // concatenating its hex chunks rebuilds the string.
      for (const hex of run.match(/<([0-9a-fA-F]*)>/g) ?? []) {
        out += Buffer.from(hex.slice(1, -1), 'hex').toString('latin1')
      }
      out += '\n'
    }
  }
  return out
}

/**
 * The same text with every whitespace run collapsed to one space.
 *
 * Needed because each JSX child is its own run: `{tenant.currency} {amount}`
 * reaches the PDF as three runs, so `pdfText` renders it as "UYU\n \n7800" and
 * a `toContain('UYU 7800')` on the raw extraction fails even though the page
 * reads exactly that.
 */
export function pdfTextFlat(pdf: Buffer): string {
  return pdfText(pdf).replace(/\s+/g, ' ')
}

/**
 * How many pages the buffer contains. `/Type /Pages` is the page TREE, not a
 * page, hence the `[^s]`: counting `/Type /Page` alone over-counts by one.
 */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}
