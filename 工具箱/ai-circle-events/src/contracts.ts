import type { NormalizedPost } from "./providers/types";

export interface SummarizedPost extends Pick<
  NormalizedPost,
  "id" | "author" | "username" | "text" | "url" | "publishedAt"
> {
  importance: number;
}

export interface EventSummary {
  title: string;
  summary: string;
  importance: number;
  postIds: string[];
}

export interface GeneratedSummary {
  title: string;
  summary: string;
  events: EventSummary[];
  risks: string[];
}

export interface GeneratedReport {
  posts: SummarizedPost[];
  summary: GeneratedSummary;
}

export interface SiteIngestBatch extends GeneratedReport {
  provider: "fxtwitter";
  modelProvider: "google";
  modelName: string;
}

export interface SitePushResult {
  accepted?: number;
  duplicates?: number;
  reportId?: string;
  [key: string]: unknown;
}
