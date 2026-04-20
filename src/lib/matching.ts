import type { Profile, Scholarship } from "./types";

export interface MatchResult {
  scholarship: Scholarship;
  score: number; // 0-100
  reasons: string[];
  disqualified: boolean;
  disqualifiers: string[];
}

/**
 * Rule-based matcher (Phase 1). Later phases can replace this with an
 * AI-ranked version. Hard filters first, then a simple score for ordering.
 */
export function matchScholarships(
  profile: Profile,
  scholarships: Scholarship[],
): MatchResult[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return scholarships
    .map((s) => evaluate(profile, s, today))
    .sort((a, b) => {
      if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
      return b.score - a.score;
    });
}

function evaluate(
  profile: Profile,
  s: Scholarship,
  today: Date,
): MatchResult {
  const reasons: string[] = [];
  const disqualifiers: string[] = [];

  // 1. Deadline must not be in the past — unless it's unlisted (null),
  //    which is common for scraped community foundation catalog pages that
  //    name scholarships without publishing per-award dates. We still surface
  //    these rows (not a disqualifier) but skip urgency scoring below.
  const deadline = s.deadline ? new Date(s.deadline) : null;
  if (deadline && deadline < today) {
    disqualifiers.push("Deadline has passed");
  }

  // 2. GPA floor
  if (s.min_gpa !== null && profile.gpa !== null && profile.gpa < s.min_gpa) {
    disqualifiers.push(
      `Requires GPA ≥ ${s.min_gpa.toFixed(1)} (you: ${profile.gpa.toFixed(2)})`,
    );
  }

  // 3. ZIP scope: national always OK. Otherwise, zip-scoped scholarships
  //    require a matching 3-digit prefix. The `val` portion of a zip scope
  //    may carry a single ZIP ("94301") or a comma-separated list of ZIPs
  //    or prefixes ("94110,94301,94501") — the latter is how Phase 3.5
  //    scraper sources express their full multi-metro coverage area.
  if (s.zip_scope !== "national") {
    const [kind, val] = s.zip_scope.split(":");
    if (kind === "zip" && profile.zip_code) {
      const studentPrefix = profile.zip_code.slice(0, 3);
      const scholarshipPrefixes = val
        .split(",")
        .map((z) => z.trim().slice(0, 3))
        .filter(Boolean);
      const matched = scholarshipPrefixes.includes(studentPrefix);
      if (!matched) {
        disqualifiers.push(`Restricted to ${val} area`);
      } else {
        reasons.push("Local scholarship in your area");
      }
    } else if (kind === "zip" && !profile.zip_code) {
      disqualifiers.push("Requires ZIP code on your profile");
    }
  }

  // 4. High-school restriction. Many CCCF funds are tied to a specific
  //    high school, sometimes one far outside the foundation's region
  //    (Halliday Clark → Scarsdale HS, Scarsdale NY). If
  //    high_school_restriction is non-empty, the student's high school
  //    must match one of the entries. If the student hasn't set their
  //    high school yet, we disqualify with a "fix your profile" message
  //    rather than silently showing restricted rows.
  const restriction = s.high_school_restriction ?? [];
  if (restriction.length > 0) {
    if (!profile.high_school) {
      disqualifiers.push(
        `Restricted to ${restriction[0]}${restriction.length > 1 ? ` (+${restriction.length - 1} more)` : ""} — add your high school to your profile`,
      );
    } else {
      const studentSchool = normalizeSchool(profile.high_school);
      const allowed = restriction.map(normalizeSchool);
      if (!allowed.includes(studentSchool)) {
        disqualifiers.push(
          `Only for students at ${restriction.join(" / ")}`,
        );
      } else {
        reasons.push(`For students at ${profile.high_school}`);
      }
    }
  }

  // Score (only meaningful for non-disqualified rows)
  let score = 50;

  // Interest overlap: +10 per matched tag, max +40
  const overlap = s.interests.filter((i) => profile.interests.includes(i));
  if (overlap.length > 0) {
    score += Math.min(40, overlap.length * 10);
    reasons.push(
      `Matches your interest${overlap.length > 1 ? "s" : ""}: ${overlap.join(", ")}`,
    );
  }

  // GPA headroom: if profile GPA comfortably exceeds min_gpa, small boost
  if (s.min_gpa !== null && profile.gpa !== null) {
    const headroom = profile.gpa - s.min_gpa;
    if (headroom >= 0.5) score += 5;
  }

  // Upcoming deadline within 60 days: urgency bump. Skip for null-deadline
  // rows (scraped catalog entries without a listed date).
  if (deadline) {
    const daysUntil = Math.round(
      (deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysUntil >= 0 && daysUntil <= 60) {
      reasons.push(`Deadline in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`);
    }
  }

  // Dollar value: small bonus for large awards
  if (s.amount >= 20000) score += 5;

  score = Math.max(0, Math.min(100, score));

  return {
    scholarship: s,
    score,
    reasons,
    disqualifiers,
    disqualified: disqualifiers.length > 0,
  };
}

/**
 * Normalize a high school name for comparison: lowercase, strip
 * trailing "High School" / "HS" suffixes, collapse whitespace,
 * drop common filler words. Lets "Spring-Ford High School",
 * "Spring-Ford HS", and "spring-ford high school" all compare equal.
 */
function normalizeSchool(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(high school|high|h\.?s\.?)\b/g, "")
    .replace(/[^a-z0-9\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
