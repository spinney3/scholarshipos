import type {
  VaultEssay,
  VaultEssayWithSimilarity,
  VaultPromptType,
  VaultSimilarityScore,
} from "./types";

/**
 * Vault similarity engine.
 *
 * Given a *new* essay prompt (text + prompt type), rank the student's past
 * vault essays by how adaptable they are. This is intentionally a small,
 * explainable, pure function — we'd rather a student see "matched keywords:
 * leadership, tutoring, after-school" than an opaque score.
 *
 * Score = 0.6 * tag_score + 0.4 * keyword_score
 *
 *   tag_score:
 *     1.0  same prompt_type
 *     0.5  prompt_type is in the same "family" (see RELATED_TYPES below)
 *     0.0  unrelated
 *
 *   keyword_score:
 *     TF-IDF cosine similarity between prompt+essay-content bag of tokens.
 *     TF uses raw counts (normalized by vector magnitude); IDF is computed
 *     across the candidate corpus (the student's own past essays + the new
 *     prompt). For a small vault this is cheap and works well.
 *
 * The 60/40 weighting favors tag over keyword: a same-topic essay is almost
 * always more adaptable than a different-topic essay with lexical overlap.
 */

// -----------------------------------------------------------------------
// Prompt-type "families". Prompts in the same family are thematically close
// enough that a student can usually adapt material across them.
// -----------------------------------------------------------------------
const RELATED_TYPES: Record<VaultPromptType, VaultPromptType[]> = {
  leadership: ["community_service", "personal_story"],
  community_service: ["leadership", "personal_story"],
  financial_need: ["first_generation", "overcoming_adversity"],
  stem: ["academic", "career_goals"],
  academic: ["stem", "career_goals"],
  personal_story: ["leadership", "overcoming_adversity", "diversity"],
  career_goals: ["academic", "stem"],
  diversity: ["personal_story", "first_generation"],
  overcoming_adversity: ["personal_story", "financial_need", "first_generation"],
  first_generation: ["financial_need", "diversity", "overcoming_adversity"],
  creative: ["personal_story"],
  other: [],
};

export function tagScore(
  a: VaultPromptType,
  b: VaultPromptType,
): number {
  if (a === b) return 1;
  if (RELATED_TYPES[a]?.includes(b)) return 0.5;
  return 0;
}

// -----------------------------------------------------------------------
// Tokenization
// -----------------------------------------------------------------------
// Minimal English stopword list — tuned for essay content. Intentionally
// not exhaustive; over-filtering removes useful signal in short prompts.
const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "as", "at",
  "by", "for", "in", "into", "of", "off", "on", "onto", "to", "from",
  "with", "without", "about", "over", "under", "is", "am", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "should", "could", "can", "may", "might",
  "must", "this", "that", "these", "those", "it", "its", "he", "she",
  "they", "them", "his", "her", "their", "i", "me", "my", "we", "us",
  "our", "you", "your", "yours", "who", "whom", "which", "what",
  "when", "where", "why", "how", "not", "no", "yes", "all", "any",
  "some", "each", "every", "other", "another", "there", "here", "than",
  "because", "also", "just", "very", "really", "one", "two", "three",
  "first", "second", "last", "new", "old", "own", "same", "such",
  "tell", "describe", "share", "explain", "write",
]);

export function tokenize(text: string): string[] {
  // Lowercase → drop punctuation → split on whitespace → filter stopwords
  // and anything shorter than 3 chars (noise).
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// -----------------------------------------------------------------------
// TF-IDF
// -----------------------------------------------------------------------

type TermCounts = Map<string, number>;

function termCounts(tokens: string[]): TermCounts {
  const m: TermCounts = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Build IDF across a corpus of token lists. */
function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set(d);
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    // Smoothed IDF: log((N + 1) / (df + 1)) + 1 — always positive, doesn't
    // explode on single-doc terms, and is standard for short corpora.
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  return idf;
}

/** Build a TF-IDF vector for a single doc given an IDF lookup. */
function tfidfVector(
  counts: TermCounts,
  idf: Map<string, number>,
): Map<string, number> {
  const v = new Map<string, number>();
  for (const [term, tf] of counts) {
    const w = idf.get(term);
    if (w === undefined) continue;
    v.set(term, tf * w);
  }
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let amag = 0;
  let bmag = 0;
  for (const v of a.values()) amag += v * v;
  for (const v of b.values()) bmag += v * v;
  if (amag === 0 || bmag === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, va] of small) {
    const vb = big.get(term);
    if (vb !== undefined) dot += va * vb;
  }
  return dot / (Math.sqrt(amag) * Math.sqrt(bmag));
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export interface NewPrompt {
  prompt_type: VaultPromptType;
  prompt_text: string;
}

/**
 * Rank a student's past vault essays by similarity to a new prompt.
 * Returns the input essays annotated with similarity scores, sorted
 * highest-first. Essays with score === 0 are still returned (caller
 * can filter) so the UI can show "nothing obviously related yet".
 */
export function rankVaultEssays(
  newPrompt: NewPrompt,
  pastEssays: VaultEssay[],
  opts: { minScore?: number; topKeywords?: number } = {},
): VaultEssayWithSimilarity[] {
  const topKeywords = opts.topKeywords ?? 5;

  // Tokenize everything once.
  const newTokens = tokenize(newPrompt.prompt_text);
  const essayTokens: string[][] = pastEssays.map((e) =>
    // Index on prompt_text + content so keyword match reflects both what
    // the essay was *about* and what it actually *says*.
    tokenize(`${e.prompt_text} ${e.content}`),
  );

  const corpus = [newTokens, ...essayTokens];
  const idf = buildIdf(corpus);

  const newCounts = termCounts(newTokens);
  const newVec = tfidfVector(newCounts, idf);

  const results: VaultEssayWithSimilarity[] = pastEssays.map((essay, i) => {
    const counts = termCounts(essayTokens[i]);
    const vec = tfidfVector(counts, idf);
    const keyword = cosine(newVec, vec);
    const tag = tagScore(newPrompt.prompt_type, essay.prompt_type);
    const combined = 0.6 * tag + 0.4 * keyword;

    // Top overlapping terms, ranked by min(tfidf_new, tfidf_essay).
    const overlap: { term: string; w: number }[] = [];
    for (const [term, wNew] of newVec) {
      const wEssay = vec.get(term);
      if (wEssay === undefined) continue;
      overlap.push({ term, w: Math.min(wNew, wEssay) });
    }
    overlap.sort((a, b) => b.w - a.w);
    const matched_keywords = overlap.slice(0, topKeywords).map((o) => o.term);

    const similarity: VaultSimilarityScore = {
      score: round3(combined),
      tag_score: round3(tag),
      keyword_score: round3(keyword),
      matched_keywords,
    };

    return { essay, similarity };
  });

  results.sort((a, b) => b.similarity.score - a.similarity.score);

  const min = opts.minScore ?? 0;
  return results.filter((r) => r.similarity.score >= min);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
