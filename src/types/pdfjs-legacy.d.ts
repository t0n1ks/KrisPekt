// The legacy build has the same API as the main entry; only its typings path is missing.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
