export type Mode = "learn" | "assignment" | "check" | "writing" | "study" | "explain" | "custom";
export type Role = "owner" | "user";

export interface Profile {
  id: string;
  display_name: string;
  role: Role;
  academic_level: string | null;
  explanation_level: string | null;
  answer_style: string | null;
  formatting_pref: string | null;
  learning_prefs: Record<string, unknown>;
  accessibility_prefs: Record<string, unknown>;
  preferred_language: string | null;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  token: string;
  status: "pending" | "accepted" | "revoked";
  invited_by: string;
  created_at: string;
  accepted_at: string | null;
}

export interface Teacher {
  id: string;
  user_id: string;
  name: string;
  notes: string;
  created_at: string;
}

export interface TeacherProfile {
  id: string;
  user_id: string;
  teacher_id: string;
  required_methods: string;
  required_steps: string;
  preferred_notation: string;
  units_sig_figs: string;
  formatting_requirements: string;
  citation_requirements: string;
  essay_structure: string;
  lab_report_requirements: string;
  preferred_terminology: string;
  show_work_rules: string;
  calculator_rules: string;
  allowed_tools: string;
  prohibited_tools: string;
  rubrics: TeacherDoc[];
  official_instructions: TeacherDoc[];
  examples: TeacherDoc[];
  corrections: TeacherDoc[];
  ai_notes: { note: string; proposed: string; status: string }[];
  version?: number;
  change_summary?: string;
  created_at: string;
  updated_at: string;
}

export interface TeacherDoc {
  title: string;
  content: string;
  source?: string;
  source_date?: string;
  archived?: boolean;
}

export interface Course {
  id: string;
  user_id: string;
  name: string;
  subject: string | null;
  academic_level: string | null;
  institution: string | null;
  term: string | null;
  teacher_id: string | null;
  instructions: string;
  created_at: string;
}

export interface WritingSample {
  id: string;
  user_id: string;
  title: string;
  genre: string | null;
  course_id: string | null;
  academic_level: string | null;
  sample_date: string | null;
  representativeness: "preferred" | "neutral" | "not_representative";
  content: string;
  created_at: string;
}

export interface WritingProfile {
  id: string;
  user_id: string;
  summary: Record<string, unknown>;
  guidance: string;
  status: "draft" | "approved";
  version: number;
  change_summary?: string;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  user_id: string;
  title: string;
  course_id: string | null;
  teacher_id: string | null;
  mode: Mode;
  subject: string | null;
  academic_level: string | null;
  task_type: string | null;
  output_type: string | null;
  instructions_text: string;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface AssignmentFile {
  id: string;
  user_id: string;
  assignment_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  extracted_text: string;
  extraction_confidence: "unprocessed" | "high" | "medium" | "low" | "failed";
  extraction_notes: string;
  created_at: string;
}

export interface WorkSession {
  id: string;
  user_id: string;
  assignment_id: string | null;
  mode: Mode;
  messages: { role: "user" | "assistant"; content: string; meta?: Record<string, unknown> }[];
  created_at: string;
  updated_at: string;
}

export interface Verification {
  status: "verified" | "needs_verification" | "unverified";
  /** How the response was verified: "computational" (independent tool), "self_check" (AI self-review), or "none". */
  verification_method?: "computational" | "self_check" | "none";
  checks: { name: string; passed: boolean; detail: string; method?: "computational" | "self_check" }[];
  warnings: string[];
}

export interface AiResponse {
  id: string;
  user_id: string;
  assignment_id: string | null;
  session_id: string | null;
  content: string;
  mode: Mode | null;
  verification: Verification;
  model_used: string | null;
  created_at: string;
}

export interface Feedback {
  id: string;
  user_id: string;
  response_id: string | null;
  assignment_id: string | null;
  course_id: string | null;
  teacher_id: string | null;
  kind: "approve" | "error" | "correction" | "teacher_wanted" | "writing_pref" | "note";
  comment: string;
  content: string;
  created_at: string;
}

export interface ProfileUpdateProposal {
  id: string;
  user_id: string;
  target_type: "teacher" | "writing";
  target_id: string | null;
  change_summary: string;
  proposed_changes: Record<string, string>;
  context: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
}

export interface StudyMaterial {
  id: string;
  user_id: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  assignment_id: string | null;
  created_at: string;
}
