// pdf-parse ships no types for its deep entry point. Declaring it here keeps the
// import STATIC (no webpack "critical dependency" warning) in both tsconfigs.
declare module "pdf-parse/lib/pdf-parse.js" {
  const parse: (data: Buffer) => Promise<{ text?: string }>;
  export default parse;
}
