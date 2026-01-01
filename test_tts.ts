
async function testFallback() {
    const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=Hello%20World&tl=en&client=tw-ob";
    console.log("Fetching fallback:", url);
    try {
        const res = await fetch(url);
        if (res.ok) {
            const buf = await res.arrayBuffer();
            console.log("Success! Got bytes:", buf.byteLength);
        } else {
            console.log("Failed:", res.status, res.statusText);
        }
    } catch (e) {
        console.error("Fetch error:", e);
    }
}
testFallback();
