// =====================================================
// MQ Assignment Maker - Types
// =====================================================
// These types define the shape of an MQ (Multiple-Question) assignment
// spec. The exported file is consumed by GradeBridge-MQ-Student-Submission
// and the GradeBridge-MQ-Autograder.
//
// Schema mirrors the SQLite question bank fields where reasonable.
// =====================================================

export type QuestionType = 'multiple_choice' | 'true_false' | 'numeric';
export type QuestionStatus = 'draft' | 'approved' | 'failed';

// One question, sourced from the question bank, embedded in the assignment pool.
export interface MQQuestion {
  id: number;                       // bank id (stable across assignments)
  type: QuestionType;
  title: string;
  question_text: string;
  choices: string[];                // length 4 today; future-proofed as variable
  correct_answer_index: number;     // 0-based
  points: number;
  tolerance: number;
  feedback_correct: string;
  feedback_incorrect: string;
  bloom_level: string;
  difficulty: number;               // 1-4
  katex_present: boolean;
  module_number: number;
  chapter_number: string;
  chapter_title: string;
  topic_title: string;
  subtopic: string;
}

// The full assignment spec exported (and gb1-encrypted) by the Maker.
export interface MQAssignmentSpec {
  schema_version: 1;
  id: string;                       // uuid - SAME across standard + accommodation variants
  courseCode: string;
  title: string;
  dueDate: string;                  // YYYY-MM-DD
  dueTime: string;                  // HH:MM (local)
  timeLimitMinutes: number;
  questionsPerStudent: number;      // N drawn from pool per session
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  preamble: string;                 // shown to student before quiz starts
  questionPool: MQQuestion[];
  createdAt: number;                // unix ms
  updatedAt: number;                // unix ms
  // Accommodation variants (optional, present only on non-standard files)
  variant_label?: string;           // e.g., "1.5x SDC accommodation"
  variant_multiplier?: number;      // e.g., 1.5 (informational only; timeLimitMinutes is authoritative)
}

// Metadata loaded from the SQLite DB to populate filter UI.
export interface DbModule {
  id: number;
  number: number;
  title: string;
  course: string;
}

export interface DbChapter {
  id: number;
  module_id: number;
  number: string;
  title: string;
}

// A row joined with topic info, returned from queries.
export interface DbQuestionRow extends MQQuestion {
  status: QuestionStatus;
}
