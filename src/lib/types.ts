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
  onboarded: boolean;
  created_at: string;
  updated_at: string;
}

export interface Scholarship {
  id: string;
  title: string;
  provider: string;
  amount: number;
  deadline: string; // ISO date
  description: string;
  eligibility_summary: string;
  min_gpa: number | null;
  interests: string[];
  zip_scope: string; // 'national' | 'state:CA' | 'zip:94110'
  url: string;
  created_at: string;
}

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
