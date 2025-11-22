import { GoogleGenAI, FunctionDeclaration, Type } from "@google/genai";

const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

// Tool definition to force the model to reveal its internal state AND provide coaching
export const mindsetToolDeclaration: FunctionDeclaration = {
  name: 'update_mindset',
  description: 'Updates the interviewer\'s internal state and generates coaching feedback. MUST be called before every verbal response.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mood: {
        type: Type.STRING,
        description: 'Current emotional state. Values: Neutral, Impressed, Skeptical, Strict, Encouraging, Disappointed.'
      },
      internal_thought: {
        type: Type.STRING,
        description: 'Internal monologue about the candidate\'s performance (not spoken). MUST BE IN SIMPLIFIED CHINESE.'
      },
      suggested_answer_tips: {
        type: Type.STRING,
        description: 'Short, actionable hints for the candidate on how to answer the question you are about to ask. MUST BE IN SIMPLIFIED CHINESE.'
      },
      reference_answer_for_question: {
        type: Type.STRING,
        description: 'A CONCRETE, VERBATIM, FIRST-PERSON sample answer that the candidate could have used. It should be a direct speech example, NOT advice or bullet points. e.g., "I led a team of 5..." instead of "You should say you led a team". MUST BE IN SIMPLIFIED CHINESE.'
      },
      last_answer_feedback: {
        type: Type.OBJECT,
        description: 'Evaluation of the candidate\'s IMMEDIATELY PRECEDING answer. If this is the start of the interview, leave empty. MUST BE IN SIMPLIFIED CHINESE.',
        properties: {
            score: { type: Type.STRING, description: 'A score like "8/10" or "一般"'},
            advice: { type: Type.STRING, description: 'Critique of what was missing or could be improved.'},
            refined_response: { type: Type.STRING, description: 'A polished, professional version based on what the candidate ACTUALLY said. (e.g. "Recommended revision of your answer").'}
        }
      }
    },
    required: ['mood', 'internal_thought']
  }
};

// Generate a strict persona based on the user's context using Gemini 3 Pro Thinking
export const generateInterviewerPersona = async (templateTitle: string, userContext: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Create a system instruction for an AI Interviewer.
      Role: ${templateTitle} Interviewer.
      Candidate Context: ${userContext}.
      
      BEHAVIOR RULES:
      1. Act as a professional interviewer. Be strict but fair.
      2. **PROACTIVE START**: You must speak FIRST. Do not wait for the user. Start with "你好，我是今天的面试官..." and then ask the first question.
      3. **LANGUAGE**: All your spoken words AND tool outputs (thoughts, feedback, reference answers) MUST BE IN SIMPLIFIED CHINESE.
      4. **TOOL USAGE**: You MUST call the 'update_mindset' tool BEFORE speaking every single time.
      5. **COACHING LOGIC**: 
         - 'reference_answer_for_question': Provide a FULL, CONCRETE, FIRST-PERSON example answer for the question you are asking. Do not give advice like "you should mention...", instead write the actual answer: "My experience with..."
         - 'last_answer_feedback': Analyze what the user JUST said. Give a score, advice, and a 'refined_response' (a better version of their specific answer).
      
      Return ONLY the system instruction text in Chinese.`,
      config: {
        thinkingConfig: { thinkingBudget: 1024 }, 
      }
    });
    return response.text || "You are a professional interviewer. Always use the update_mindset tool. Speak first. Use Chinese.";
  } catch (error) {
    console.error("Persona generation failed:", error);
    return `你是一位专业的面试官，正在进行${templateTitle}。
    必须主动开始对话（例如：“你好，我是今天的面试官...”）。
    每次回答前必须使用 update_mindset 工具。
    所有内心活动、评价、参考回答都必须使用中文。
    reference_answer_for_question 必须是第一人称的具体回答范例。
    last_answer_feedback 必须针对用户的上一轮回答给出评价和修正建议。`;
  }
};

// Generate an avatar image using Gemini 2.5 Flash Image
export const generateAvatarImage = async (description: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: `Generate a professional portrait of an interviewer. Style: Realistic, corporate headshot, high quality, soft lighting, light background, friendly but professional. Context: ${description}`,
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Avatar generation failed:", error);
    return null;
  }
};