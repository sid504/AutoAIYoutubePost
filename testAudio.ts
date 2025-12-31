import { GoogleGenAI, Modality } from "@google/genai";

async function testAudio() {
    const key = "AIzaSyBXLzqOzDmB5ALb-6FlxHWSt6Iq5T66ejs";
    const client = new GoogleGenAI({ apiKey: key });
    // Try different potential models or configurations
    const modelsToTest = [
        'gemini-1.5-flash',
        'gemini-2.5-flash-preview-tts',
        'gemini-1.5-pro'
    ];

    for (const model of modelsToTest) {
        console.log(`Testing model: ${model}`);
        try {
            const response = await client.models.generateContent({
                model: model,
                contents: [{ parts: [{ text: "Hello, this is a test of the audio generation system." }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                },
            });
            console.log(`Success with ${model}!`);
            console.log("Response keys:", Object.keys(response));
            break;
        } catch (error: any) {
            console.error(`Failed with ${model}:`, error.status, error.message);
            if (error.response?.data) {
                console.error("Error data:", JSON.stringify(error.response.data));
            }
        }
    }
}

testAudio();
