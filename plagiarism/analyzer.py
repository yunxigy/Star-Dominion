"""查重算法核心 — TF-IDF + 余弦相似度 + 句子级 N-gram 匹配"""

import re
from dataclasses import dataclass, field

import jieba
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


@dataclass
class SimilarSegment:
    """一对相似片段"""
    text_a: str
    text_b: str
    similarity: float


@dataclass
class CompareResult:
    """查重结果"""
    overall_similarity: float          # 0-100
    total_sentences_a: int
    total_sentences_b: int
    similar_sentence_count: int
    level: str                         # 低 / 中 / 高
    segments: list[SimilarSegment] = field(default_factory=list)


# 中文停用词（精简版）
_STOP_WORDS = set("的了是在我他她它们这那个有不人也大为上中到说时要出会可能和与及对从把被让给等")


def _tokenize(text: str) -> list[str]:
    """中文分词 + 去停用词"""
    words = jieba.lcut(text)
    return [w.strip() for w in words if w.strip() and w.strip() not in _STOP_WORDS and len(w.strip()) > 0]


def _split_sentences(text: str) -> list[str]:
    """按中英文标点分句"""
    raw = re.split(r'[。！？!?\n;；]+', text)
    return [s.strip() for s in raw if len(s.strip()) >= 4]


def _ngram_set(text: str, n: int = 3) -> set[str]:
    """生成字符级 N-gram 集合"""
    tokens = _tokenize(text)
    if len(tokens) < n:
        return {" ".join(tokens)} if tokens else set()
    return {" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def compare_texts(text_a: str, text_b: str) -> CompareResult:
    """比较两段文本的相似度"""
    sentences_a = _split_sentences(text_a)
    sentences_b = _split_sentences(text_b)

    if not sentences_a or not sentences_b:
        return CompareResult(
            overall_similarity=0,
            total_sentences_a=len(sentences_a),
            total_sentences_b=len(sentences_b),
            similar_sentence_count=0,
            level="低",
        )

    # --- 整体 TF-IDF 余弦相似度 ---
    tokenized_a = " ".join(_tokenize(text_a))
    tokenized_b = " ".join(_tokenize(text_b))

    vectorizer = TfidfVectorizer()
    tfidf_matrix = vectorizer.fit_transform([tokenized_a, tokenized_b])
    overall_sim = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0] * 100

    # --- 句子级 N-gram 匹配 ---
    similar_segments: list[SimilarSegment] = []
    similar_count = 0
    threshold = 0.3  # N-gram Jaccard 相似度阈值

    for sa in sentences_a:
        ngrams_a = _ngram_set(sa)
        if not ngrams_a:
            continue
        best_score = 0.0
        best_sb = ""
        for sb in sentences_b:
            ngrams_b = _ngram_set(sb)
            if not ngrams_b:
                continue
            intersection = ngrams_a & ngrams_b
            union = ngrams_a | ngrams_b
            if not union:
                continue
            jaccard = len(intersection) / len(union)
            if jaccard > best_score:
                best_score = jaccard
                best_sb = sb

        if best_score >= threshold:
            similar_count += 1
            if len(similar_segments) < 50:  # 最多返回 50 对
                similar_segments.append(SimilarSegment(
                    text_a=sa[:200],
                    text_b=best_sb[:200],
                    similarity=round(best_score * 100, 1),
                ))

    # 相似度等级
    if overall_sim >= 60:
        level = "高"
    elif overall_sim >= 30:
        level = "中"
    else:
        level = "低"

    return CompareResult(
        overall_similarity=round(overall_sim, 1),
        total_sentences_a=len(sentences_a),
        total_sentences_b=len(sentences_b),
        similar_sentence_count=similar_count,
        level=level,
        segments=sorted(similar_segments, key=lambda s: s.similarity, reverse=True),
    )
