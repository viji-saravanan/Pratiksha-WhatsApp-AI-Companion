export interface ResourceSearchDocument {
  resourceId: string;
  registeredFileName: string;
  title: string;
  aliases?: readonly string[];
  description?: string | null;
  contentSummary?: string | null;
}

export interface RankedResourceCandidate extends ResourceSearchDocument {
  rank: number;
  score: number;
  matchedTerms: string[];
}

export type ResourceSelectionResolution =
  | {
      status: "resolved";
      candidate: RankedResourceCandidate;
      reason: "single_affirmative" | "list_number" | "text_similarity";
    }
  | {
      status: "ambiguous" | "no_match";
    };

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "can",
  "could",
  "file",
  "for",
  "have",
  "i",
  "me",
  "my",
  "of",
  "please",
  "send",
  "share",
  "the",
  "to",
  "you"
]);

const AFFIRMATIVE_WORDS = new Set([
  "correct",
  "confirm",
  "confirmed",
  "send it",
  "that one",
  "thats right",
  "that's right",
  "yes",
  "yes please",
  "yep"
]);

const ORDINAL_WORDS = new Map<string, number>([
  ["first", 1],
  ["one", 1],
  ["option one", 1],
  ["second", 2],
  ["two", 2],
  ["option two", 2],
  ["third", 3],
  ["three", 3],
  ["option three", 3],
  ["fourth", 4],
  ["four", 4],
  ["fifth", 5],
  ["five", 5]
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[_.,!?;/"\\()[\]{}:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token: string): string {
  const ordinal = token.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (ordinal) {
    return ordinal[1];
  }

  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map(normalizeToken)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function weightedText(document: ResourceSearchDocument): Array<{
  text: string;
  weight: number;
}> {
  return [
    { text: document.registeredFileName, weight: 6 },
    { text: document.title, weight: 5 },
    { text: (document.aliases ?? []).join(" "), weight: 5 },
    { text: document.description ?? "", weight: 3 },
    { text: document.contentSummary ?? "", weight: 2 }
  ];
}

function scoreDocument(document: ResourceSearchDocument, query: string): {
  score: number;
  matchedTerms: string[];
} {
  const queryTerms = unique(tokenize(query));
  if (queryTerms.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const matchedTerms = new Set<string>();
  let score = 0;

  for (const { text, weight } of weightedText(document)) {
    const terms = new Set(tokenize(text));
    const normalizedField = normalizeText(text);

    for (const queryTerm of queryTerms) {
      if (terms.has(queryTerm)) {
        score += weight;
        matchedTerms.add(queryTerm);
      } else if (queryTerm.length >= 4 && normalizedField.includes(queryTerm)) {
        score += Math.max(1, weight - 2);
        matchedTerms.add(queryTerm);
      }
    }
  }

  return {
    score,
    matchedTerms: Array.from(matchedTerms)
  };
}

export function rankResourceCandidates(
  documents: readonly ResourceSearchDocument[],
  query: string,
  options: { limit?: number; minScore?: number } = {}
): RankedResourceCandidate[] {
  const minScore = options.minScore ?? 3;
  const limit = options.limit ?? 5;

  return documents
    .map((document) => ({
      ...document,
      rank: 0,
      ...scoreDocument(document, query)
    }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.registeredFileName.localeCompare(right.registeredFileName);
    })
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    }));
}

export function formatResourceSuggestionText(
  candidates: readonly RankedResourceCandidate[]
): string {
  if (candidates.length === 0) {
    return "I could not find a registered file that matches that.";
  }

  if (candidates.length === 1) {
    return `Do you mean ${candidates[0].registeredFileName}?`;
  }

  return [
    "Do you mean:",
    ...candidates.map(
      (candidate) => `${candidate.rank}. ${candidate.registeredFileName}`
    )
  ].join("\n");
}

function numericSelectionIndex(message: string, maxRank: number): number | null {
  const normalized = normalizeText(message);
  const exactSelection = normalized.match(
    /^(?:(?:option|number|choice)\s+)?(\d+)(?:\s+(?:please|pls|send|that|one))?$/
  );

  if (exactSelection) {
    const rank = Number(exactSelection[1]);
    return rank >= 1 && rank <= maxRank ? rank : null;
  }

  const wordSelection = ORDINAL_WORDS.get(normalized);
  return wordSelection && wordSelection <= maxRank ? wordSelection : null;
}

function isAffirmative(message: string): boolean {
  return AFFIRMATIVE_WORDS.has(normalizeText(message).replace(/[.!?]+$/g, ""));
}

export function resolveResourceSelection(
  message: string | null,
  candidates: readonly RankedResourceCandidate[]
): ResourceSelectionResolution {
  const body = message?.trim() ?? "";
  if (!body || candidates.length === 0) {
    return { status: "no_match" };
  }

  if (candidates.length === 1 && isAffirmative(body)) {
    return {
      status: "resolved",
      candidate: candidates[0],
      reason: "single_affirmative"
    };
  }

  const selectedRank = numericSelectionIndex(body, candidates.length);
  if (selectedRank !== null) {
    const candidate = candidates.find((item) => item.rank === selectedRank);
    if (candidate) {
      return {
        status: "resolved",
        candidate,
        reason: "list_number"
      };
    }
  }

  if (candidates.length > 1 && isAffirmative(body)) {
    return { status: "ambiguous" };
  }

  const reranked = rankResourceCandidates(candidates, body, {
    limit: candidates.length,
    minScore: 3
  });
  const [first, second] = reranked;

  if (!first) {
    return { status: "no_match" };
  }

  if (second && first.score - second.score < 3) {
    return { status: "ambiguous" };
  }

  return {
    status: "resolved",
    candidate: first,
    reason: "text_similarity"
  };
}
