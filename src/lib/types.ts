export type FinancialNeed = "low" | "medium" | "high";

export type ApplicationStatus =
  | "discovered"
  | "eligible"
  | "in_progress"
  | "submitted"
  | "won"
  | "lost";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "discovered",
  "eligible",
  "in_progress",
  "submitted",
  "won",
  "lost",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  eligible: "Eligible",
  in_progress: "In Progress",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

export interface Profile {
  id: string;
  full_name: string;
  gpa: number | null;
  zip_code: string | null;
  interests: string[];
  financial_need: FinancialNeed | null;
  // Social / outreach fields (migration 006). Both college/major are optional
  // free-text for now — eventually we may normalize intended_college against
  // a school list so the peers view can bucket cleanly.
  intended_college: string | null;
  intended_major: string | null;
  // Opt-in for product/marketing emails. Default TRUE on new onboarders so
  // Shawn can reach students for scholarship digests, upgrade news, etc.
  // Students can uncheck during onboarding or edit later from /onboarding.
  allow_marketing_emails: boolean;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
}

export type ScholarshipSource = "seed" | "local" | "api";

export const SCHOLARSHIP_SOURCE_LABELS: Record<ScholarshipSource, string> = {
  seed: "National",
  local: "Local",
  api: "API",
};

export interface Scholarship {
  id: string;
  title: string;
  provider: string;
  /**
   * USD, integer. 0 means "amount not listed" — community foundation catalog
   * pages frequently name scholarships without publishing an amount (the
   * amount varies by cycle or by donor). UI renders these as "Amount varies".
   */
  amount: number;
  /**
   * ISO date string, or null when the source's catalog page names the
   * scholarship but doesn't list a deadline on the index. Per-scholarship
   * detail pages would have it, but our scraper doesn't currently follow
   * them (that would double Haiku call volume). Null rows are sorted to the
   * end of the list and show "Deadline varies — see listing".
   */
  deadline: string | null;
  description: string;
  eligibility_summary: string;
  min_gpa: number | null;
  interests: string[];
  zip_scope: string; // 'national' | 'state:CA' | 'zip:94110'
  url: string;
  essay_prompt: string | null;
  source: ScholarshipSource;
  created_at: string;
}

// === Essay coaching ===
export type EssayStatus = "interviewing" | "drafting" | "refining" | "final";

// One turn in the Socratic interview transcript stored on essays.interview.
// `coach` turns are Claude's questions; `student` turns are the student's answers.
export interface InterviewTurn {
  role: "coach" | "student";
  content: string;
}

export interface Essay {
  id: string;
  application_id: string;
  user_id: string;
  prompt: string;
  interview: InterviewTurn[];
  status: EssayStatus;
  created_at: string;
  updated_at: string;
}

export type DraftSource = "claude" | "user";

export interface EssayDraft {
  id: string;
  essay_id: string;
  user_id: string;
  version: number;
  outline: string;
  content: string;
  source: DraftSource;
  created_at: string;
}

// Target number of Q&A pairs in the Socratic interview before drafting.
// The coach can wrap early if it has enough material.
export const INTERVIEW_TARGET_QUESTIONS = 5;
export const INTERVIEW_MIN_QUESTIONS = 3;

export interface Application {
  id: string;
  user_id: string;
  scholarship_id: string;
  status: ApplicationStatus;
  position: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

// Joined shape for Kanban board: application row + its scholarship
export interface ApplicationWithScholarship extends Application {
  scholarship: Scholarship;
}

// Catalog of known interest tags (used in onboarding + matching)
export const INTEREST_OPTIONS: { value: string; label: string }[] = [
  { value: "academics", label: "Academics" },
  { value: "leadership", label: "Leadership" },
  { value: "community service", label: "Community Service" },
  { value: "stem", label: "STEM" },
  { value: "engineering", label: "Engineering" },
  { value: "healthcare", label: "Healthcare" },
  { value: "research", label: "Research" },
  { value: "writing", label: "Writing" },
  { value: "grit", label: "Overcoming Adversity" },
  { value: "first-generation", label: "First-Generation College" },
];

// ===========================================================================
// Essay Vault
// ---------------------------------------------------------------------------
// Separate from the per-application `Essay` (coach interview) above. A
// VaultEssay is a standalone reusable essay in the student's personal
// library, tagged by prompt type so we can surface it when they start a
// new essay with a similar prompt.
// ===========================================================================

export type VaultPromptType =
  | "leadership"
  | "community_service"
  | "financial_need"
  | "stem"
  | "academic"
  | "personal_story"
  | "career_goals"
  | "diversity"
  | "overcoming_adversity"
  | "first_generation"
  | "creative"
  | "other";

export const VAULT_PROMPT_TYPE_OPTIONS: { value: VaultPromptType; label: string }[] = [
  { value: "leadership", label: "Leadership" },
  { value: "community_service", label: "Community Service" },
  { value: "financial_need", label: "Financial Need" },
  { value: "stem", label: "STEM" },
  { value: "academic", label: "Academic / Why This Major" },
  { value: "personal_story", label: "Personal Story" },
  { value: "career_goals", label: "Career Goals" },
  { value: "diversity", label: "Diversity" },
  { value: "overcoming_adversity", label: "Overcoming Adversity" },
  { value: "first_generation", label: "First-Generation" },
  { value: "creative", label: "Creative / Open-Ended" },
  { value: "other", label: "Other" },
];

export const VAULT_PROMPT_TYPE_LABELS: Record<VaultPromptType, string> =
  Object.fromEntries(
    VAULT_PROMPT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
  ) as Record<VaultPromptType, string>;

export interface VaultEssay {
  id: string;
  user_id: string;
  title: string;
  prompt_type: VaultPromptType;
  prompt_text: string;
  content: string;
  word_count: number;
  source_essay_id: string | null;
  created_at: string;
  updated_at: string;
}

// VaultEssay + the application IDs it's linked to (for editor UI).
export interface VaultEssayWithLinks extends VaultEssay {
  linked_application_ids: string[];
}

// Similarity score components returned when ranking past vault essays
// against a new prompt. All values are in [0, 1].
export interface VaultSimilarityScore {
  score: number;             // combined, 0..1
  tag_score: number;         // 1.0 if same prompt_type, 0.5 if related, 0 if unrelated
  keyword_score: number;     // TF-IDF cosine
  matched_keywords: string[]; // top overlapping terms, for UI explanation
}

export interface VaultEssayWithSimilarity {
  essay: VaultEssay;
  similarity: VaultSimilarityScore;
}

// Structured guidance returned by Claude when a student asks how to
// adapt a past essay to a new prompt. See src/lib/vaultAdaptPrompts.ts.
export interface AdaptationGuidance {
  summary: string;                // one-paragraph "here's how this essay relates to the new prompt"
  keep: string[];                 // specific passages/beats worth preserving
  rewrite: {
    what: string;                 // a passage or beat that needs to change
    why: string;                  // why it doesn't fit the new prompt
    how: string;                  // a Socratic nudge, NOT rewritten prose
  }[];
  new_angles: string[];           // Socratic questions to surface material the old essay didn't cover
}
