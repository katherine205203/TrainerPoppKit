import type { ScarfDomainCode } from "./scarf-assessment";

export const SCARF_INSIGHT_VERSION = "en-reflection-v1";

export const SCARF_INSIGHTS: Record<ScarfDomainCode, {
  title: string;
  definition: string;
  energizers: string[];
  challenges: string[];
  prompts: string[];
}> = {
  S: {
    title: "Recognition and contribution",
    definition: "Status concerns how people experience recognition, respect, and the value of their contribution.",
    energizers: ["Having expertise invited into a decision", "Receiving specific recognition for useful work", "Being trusted with meaningful responsibility"],
    challenges: ["Expertise being overlooked", "Feedback that feels dismissive", "Contributions going unacknowledged"],
    prompts: ["What kinds of recognition feel meaningful to you?", "How do you make space for others’ expertise?", "What contribution would you like to make more visible?"],
  },
  C: {
    title: "Clarity and predictability",
    definition: "Certainty concerns how much clarity people have about what is happening and what may happen next.",
    energizers: ["Knowing key milestones and next steps", "Receiving clear expectations early", "Being told when a decision will be made"],
    challenges: ["Plans left open-ended", "Changes without context", "Unclear priorities or timing"],
    prompts: ["What information helps you feel prepared?", "Where would clearer next steps help your team?", "How do you respond when a plan changes?"],
  },
  A: {
    title: "Choice and agency",
    definition: "Autonomy concerns the choices and discretion people have in how they approach their work and commitments.",
    energizers: ["Choosing an approach to reach a shared goal", "Shaping your own contribution", "Having input into decisions that affect you"],
    challenges: ["Detailed direction without room to adapt", "Decisions made without your input", "Little choice in how responsibilities are handled"],
    prompts: ["Where would more choice help you do your best work?", "How can a team agree on outcomes while allowing different approaches?", "Which decisions do you want to have a voice in?"],
  },
  R: {
    title: "Connection and belonging",
    definition: "Relatedness concerns the quality of connection, trust, and belonging people experience with others.",
    energizers: ["Working with people you trust", "Being welcomed into a conversation", "Sharing a sense of connection with a group"],
    challenges: ["Feeling left out of shared conversations", "Working in an isolated environment", "Unresolved tension in relationships"],
    prompts: ["What helps you feel connected to a group?", "How can you make it easier for someone new to join in?", "What kind of collaboration feels most supportive?"],
  },
  F: {
    title: "Consistency and fairness",
    definition: "Fairness concerns whether decisions, expectations, and opportunities feel consistent and understandable.",
    energizers: ["Clear criteria applied consistently", "Agreements made together", "Understanding how a decision was reached"],
    challenges: ["Rules applied differently without explanation", "Unclear access to opportunities", "Expectations that change without discussion"],
    prompts: ["What helps a decision feel fair to you?", "Where could your group make its criteria clearer?", "How do you raise a concern about an inconsistent process?"],
  },
};
