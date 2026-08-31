import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface UserFileReadRequest {
  fileId: string;
  path: string;
  filename?: string;
  mimeType?: string;
  maxChars?: number;
}

export interface UserFileReadResult {
  fileId: string;
  filename: string;
  mimeType: string;
  content: string;
}

export class UserFileProvider {
  readonly name = "user-file";

  async readFile(req: UserFileReadRequest): Promise<UserFileReadResult> {
    const content = (await readFile(req.path, "utf8")).slice(0, req.maxChars ?? 120000);
    return {
      fileId: req.fileId,
      filename: req.filename ?? basename(req.path),
      mimeType: req.mimeType ?? "text/plain",
      content,
    };
  }
}
