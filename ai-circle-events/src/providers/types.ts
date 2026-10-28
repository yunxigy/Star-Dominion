export interface NormalizedPost {
  id: string;
  author: string;
  username: string;
  handle: string;
  text: string;
  url: string;
  publishedAt: string;
  replyingTo: { status: string; screenName: string } | null;
  isRetweet: boolean;
}

export interface ProviderScan {
  posts: NormalizedPost[];
  latestPostId: string | null;
  reachedAfterPostId: boolean;
  scanComplete: boolean;
}

export interface ProviderScanOptions {
  afterPostId?: string;
}

export interface TimelineProvider {
  fetchLatest(
    handle: string,
    options?: ProviderScanOptions,
  ): Promise<ProviderScan>;
}
