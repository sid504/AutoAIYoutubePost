import { GoogleGenAI } from "@google/genai";

async function listModels() {
    const key = process.env.GEMINI_API_KEY || "";
    const client = new GoogleGenAI({ apiKey: key });
    try {
        const response = await client.models.list();
        const modelList = (response as any).pageInternal || (response as any).models || response;

        if (Array.isArray(modelList)) {
            console.log("Found " + modelList.length + " models.");
            modelList.forEach(m => {
                console.log(`- ${m.name}`);
            });
        } else {
            console.log("Unknown format:", JSON.stringify(response).substring(0, 500));
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();
