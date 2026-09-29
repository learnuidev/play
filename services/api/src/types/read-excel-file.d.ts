/**
 * `read-excel-file/node` has no types this project can see.
 *
 * Not for want of them — the package ships a `.d.ts` per entry point — but
 * because `services/api` resolves modules the Node 10 way (`moduleResolution:
 * "node"`), and that predates `exports` maps: the subpath is invisible to
 * TypeScript while esbuild, which is what actually bundles these handlers,
 * resolves it correctly through the map. Declaring the one function this service
 * calls is smaller than changing how the whole backend resolves modules.
 *
 * The signature is the package's own: `readSheet` answers with the cells of one
 * worksheet, as rows of cells, where the empty cells of a sparse sheet arrive as
 * `null`. `sheet` is 1-based, or the sheet's name.
 */
declare module 'read-excel-file/node' {
  export type CellValue = string | number | boolean | Date;
  export type Row = (CellValue | null)[];
  export type SheetData = Row[];

  export function readSheet(
    input: Buffer,
    sheet?: number | string,
  ): Promise<SheetData>;
}
