export interface InterviewTemplate {
  id: string;
  title: string;
  description: string;
  defaultPrompt: string;
}

export interface InterviewConfig {
  templateId: string;
  context: string; // User's job description or resume summary
  avatarUrl: string | null;
  voiceName: string;
  systemInstruction: string;
}

export interface ChatMessage {
  role: 'user' | 'model' | 'coach-hint' | 'coach-feedback' | 'coach-reference';
  text: string;
  timestamp: number;
  // Optional structured data for coach messages
  metadata?: {
    score?: string;
    refined_answer?: string;
  };
}

export enum AppState {
  SETUP,
  LIVE,
  SUMMARY
}

export interface VoiceOption {
  name: string;
  label: string; // e.g. "Kore (Male, Deep)"
}

export interface InterviewerMindset {
  mood: 'Neutral' | 'Impressed' | 'Skeptical' | 'Strict' | 'Encouraging' | 'Disappointed';
  internal_thought: string; // What the interviewer is thinking but not saying
  
  // Coaching Fields
  suggested_answer_tips?: string; // Brief hints (optional)
  
  reference_answer_for_question?: string; // NEW: The ideal standard answer for the question currently being asked
  
  last_answer_feedback?: {
    score: string; // e.g. "8/10" or "Weak"
    advice: string; // Specific advice on what was missing
    refined_response: string; // A better version of what the user ACTUALLY said
  };
}