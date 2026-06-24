// pdfjs-dist/webpack.mjs is the bundler entry point — it sets up the module worker
// automatically. It has no separate .d.ts; re-export the main package's types.
declare module 'pdfjs-dist/webpack.mjs' {
  export * from 'pdfjs-dist';
}
