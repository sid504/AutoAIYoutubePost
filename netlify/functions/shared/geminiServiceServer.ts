import { GoogleGenAI, Type, Modality } from "@google/genai";

const TEXT_MODEL = 'gemini-2.0-flash-exp';
const IMAGE_MODEL = 'gemini-2.0-flash-exp';
const TTS_MODEL = 'gemini-2.0-flash-exp';

export const TOPIC_ROTATION = [
  "AI & Tech Updates",
  "Electronics & Gadgets",
  "Current Global Affairs",
  "Health & Fitness",
  "Global Politics",
  "Beauty & Skincare",
  "Space & Science",
  "Business & Finance",
  "Automotive Innovation",
  "Environment & Sustainability"
];

const CLEAR_AUDIO_PROMPT = "[DIRECTOR'S NOTE: This is a professional news broadcast. Speak at a SLOW, natural human pace. Include 1.5-second pauses between major sections and 0.5-second pauses between sentences. Ensure every word is perfectly articulated. Do not rush. Sounds authoritative, calm, and clear.]";

// Helper to get API key from environment (Netlify/Node.js)
const getApiKey = () => {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY (or VITE_GEMINI_API_KEY) not found in environment variables');
  }
  return key;
};

const handleApiError = (error: any, context: string) => {
  console.error(`Gemini API Error [${context}]:`, error);
  throw error;
};

export const fetchDailyAINews = async () => {
  try {
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: "Search for and summarize the top 5 most important artificial intelligence news stories from the last 24 hours. Focus on major releases and breakthroughs. Provide a concise summary suitable for a news script.",
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    return {
      summary: response.text || "AI is evolving rapidly with multi-modal capabilities.",
      sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    };
  } catch (error) {
    console.warn("Search grounding fallback triggered.");
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: "Summarize current trends in AI for a news broadcast.",
    });
    return {
      summary: response.text || "AI technology continues to advance across all sectors.",
      sources: []
    };
  }
};

export const generateStructuredContent = async (topic: string, newsContext?: string) => {
  try {
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `
      Topic: "${topic}". 
      Context: "${newsContext || "General industry update"}".
      
      TASK: Generate a professional, high-engagement news broadcast script for a "LIVE DAILY NEWS" show.
      DURATION: The show should last between 1 to 2 minutes.
      DYNAMIC LENGTH: Generate exactly 3 to 5 sequential segments to fill the duration.
      
      Each segment MUST have:
      - NARRATION: Engaging script text (2-4 professional sentences).
      - VISUAL PROMPT: Cinematic description for the background image (for Nano Banana).
      - LAYOUT: One of 'CENTER', 'SIDEBAR', or 'FULL_IMAGE'.
      - HIGHLIGHTS: 2-3 short key bullet points.
      
      Total length should be ~1500-2500 words.
      Ensure high impact and authoritative tone throughout.
    `;

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: "Engaging news script text" },
              visualPrompt: { type: Type.STRING, description: "Cinematic visual description for Nano Banana" },
              layout: { type: Type.STRING, enum: ["CENTER", "SIDEBAR", "FULL_IMAGE"], description: "Visual layout for the segment" },
              highlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 short key highlights for on-screen display"
              }
            },
            required: ["text", "visualPrompt", "layout", "highlights"]
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (error) {
    return handleApiError(error, "generateStructuredContent");
  }
};

export const generateImage = async (prompt: string): Promise<string> => {
  try {
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: { imageConfig: { aspectRatio: "16:9" } }
    });

    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData || (p as any).blob);
    if (part?.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    if ((part as any)?.blob) return `data:image/png;base64,${(part as any).blob.data}`;

    throw new Error("No image data returned from Nano Banana");
  } catch (error) {
    // Fallback to a high-quality placeholder based on the prompt
    return `https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1920&q=80&q=${encodeURIComponent(prompt)}`;
  }
};

export const generateSEOMetadata = async (script: string, topic: string) => {
  try {
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [{
        parts: [{
          text: `Based on this broadcast script: "${script}" and topic: "${topic}", generate:
          1. A click-worthy, viral YouTube Title (max 60 chars).
          2. A comprehensive YouTube Description including a summary, time-stamps (conceptual), and 5-10 relevant hashtags.
          3. A list of 5 SEO-optimized tags.
          Return ONLY as JSON: { "title": "...", "description": "...", "tags": ["tag1", "tag2"] }`
        }]
      }],
      config: { responseMimeType: "application/json" }
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("SEO generation failed, using defaults.");
    return {
      title: `AI Daily Update: ${topic || "Tech News"}`,
      description: `Exploring the latest in ${topic || "AI and technology"}. Generated by Broadcast Agent.\n\n#AI #TechNews #Innovation`,
      tags: ["AI", "Tech", "News"]
    };
  }
};

export const generateYouTubeThumbnail = async (topic: string, title: string): Promise<string> => {
  try {
    const prompt = `Premium, 4K YouTube Thumbnail for "${title}". Topic: ${topic}. 
    Style: Viral cinematic news aesthetic, vibrant high-contrast colors, professional studio lighting.
    Content: Futuristic technology and media elements, digital energy, sharp focus.
    Ensure a clean areas for text overlay. Avoid generating garbled text in the image.`;

    return await generateImage(prompt);
  } catch (error) {
    return "https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=1280&q=80";
  }
};

export const generateAudio = async (text: string): Promise<string> => {
  try {
    const key = getApiKey();
    const ai = new GoogleGenAI({ apiKey: key });
    const fullPrompt = `${CLEAR_AUDIO_PROMPT}\n\n${text}`;
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text: fullPrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    });

    const base64Pcm = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Pcm) throw new Error("TTS failed");

    const binaryString = atob(base64Pcm);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

    const buffer = new ArrayBuffer(44 + len);
    const view = new DataView(buffer);
    const writeString = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 24000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, len, true);
    for (let i = 0; i < len; i++) view.setUint8(44 + i, bytes[i]);

    // In serverless environment, return base64 data URL instead of Blob URL
    const base64Wav = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:audio/wav;base64,${base64Wav}`;
  } catch (error) {
    // Base64 for 1 second of 24kHz mono silence (WAV) to bypass CORS and keep the loop alive
    return "data:audio/wav;base64,UklGRmYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  }
};

