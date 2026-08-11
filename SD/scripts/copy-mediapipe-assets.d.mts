export const EXPECTED_WASM_FILES: readonly string[];

export function copyMediaPipeAssets(options: {
  sourceDir: string;
  destinationDir: string;
}): Promise<void>;
