import type { OutputAsset } from './types';

function splitFilename(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { stem: filename, extension: '' };
  }
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

export function buildOutputName(
  sourceName: string,
  suffix: string,
  extension: string,
): string {
  const { stem } = splitFilename(sourceName);
  const normalizedExtension = extension.replace(/^\.+/, '');
  return `${stem}${suffix}${normalizedExtension ? `.${normalizedExtension}` : ''}`;
}

export function dedupeOutputNames(
  outputs: readonly OutputAsset[],
): Array<OutputAsset & { downloadName: string }> {
  const usedNames = new Set<string>();

  return outputs.map((output) => {
    const { stem, extension } = splitFilename(output.name);
    let downloadName = output.name;
    let suffix = 2;

    while (usedNames.has(downloadName.toLowerCase())) {
      downloadName = `${stem}-${suffix}${extension}`;
      suffix += 1;
    }

    usedNames.add(downloadName.toLowerCase());
    return { ...output, downloadName };
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function downloadOutput(output: OutputAsset): void {
  downloadBlob(output.blob, output.name);
}

export async function buildZipBlob(outputs: readonly OutputAsset[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const canReadBlobDirectly = typeof FileReader !== 'undefined';

  for (const output of dedupeOutputNames(outputs)) {
    // JSZip uses FileReader for Blob input in browsers. Node/Vitest has Blob but
    // no FileReader, so that compatibility path converts each input exactly once.
    const content = canReadBlobDirectly
      ? output.blob
      : await output.blob.arrayBuffer();
    zip.file(output.downloadName, content);
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

export async function downloadOutputsAsZip(
  outputs: readonly OutputAsset[],
  filename: string,
): Promise<void> {
  const zipBlob = await buildZipBlob(outputs);
  downloadBlob(zipBlob, filename);
}
