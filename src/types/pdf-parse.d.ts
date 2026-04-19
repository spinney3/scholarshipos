/**
 * Ambient declaration for the deep-path import of pdf-parse.
 *
 * @types/pdf-parse ships typings for the package root only — it doesn't
 * declare the inner file `lib/pdf-parse.js`. We import that file directly
 * (see src/app/api/scholarships/import/route.ts) to skip the package's
 * index.js self-test, which reads a bundled sample PDF at module-load
 * and breaks under Next.js's webpack trace.
 *
 * This stub mirrors the subset of pdf-parse's output we actually use.
 * If we ever need metadata/info fields, expand the return type here.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    /** Extracted plain text from every page, separated by \n. */
    text: string;
    /** Page count. Present in all versions we care about. */
    numpages?: number;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export default pdfParse;
}
