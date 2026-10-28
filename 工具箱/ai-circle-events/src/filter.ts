import type { NormalizedPost } from "./providers/types";

const urlPattern = /https?:\/\/\S+/giu;
const promotionPattern =
  /\b(sponsored|advertisement|promo(?:tion)?|use code|discount|sign up today|subscribe now|affiliate)\b|赞助|优惠码|折扣|限时优惠/iu;
const industrySignalPattern =
  /\b(announce(?:s|d|ment)?|launch(?:es|ed)?|release[ds]?|open[- ]source|benchmark|research|model|inference|training|fund(?:ing)?|safety|paper|agent|api|chip)\b|发布|开源|模型|推理|训练|基准|研究|安全|融资/iu;
const courtesyPattern =
  /^(?:thanks?(?: a lot)?|thank you|great|nice|agreed|i agree|well said|good point|love this|\+1|谢谢|感谢|同意|确实|说得好)[.!?。！？，, ]*$/iu;

function hasReadableContent(text: string): boolean {
  const withoutLinks = text.replace(urlPattern, " ").replace(/www\.\S+/giu, " ");
  return /[\p{L}\p{N}]/u.test(withoutLinks);
}

function isLowValueReply(post: NormalizedPost): boolean {
  if (!post.replyingTo) {
    return false;
  }
  const normalized = post.text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
  return (
    !hasReadableContent(normalized) ||
    (normalized.length <= 80 && courtesyPattern.test(normalized))
  );
}

export function shouldKeepPost(post: NormalizedPost): boolean {
  const text = post.text.normalize("NFKC").trim();
  if (!hasReadableContent(text) || isLowValueReply({ ...post, text })) {
    return false;
  }
  if (promotionPattern.test(text) && !industrySignalPattern.test(text)) {
    return false;
  }
  if (post.isRetweet && text.length < 45 && !industrySignalPattern.test(text)) {
    return false;
  }
  return true;
}

export function filterPosts(posts: readonly NormalizedPost[]): NormalizedPost[] {
  return posts.filter(shouldKeepPost);
}
