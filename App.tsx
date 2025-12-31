import React, { useState, useRef, useEffect } from 'react';
import { AppStep, GeneratedContent, ScriptSegment, YouTubeChannel } from './types';
import { generateStructuredContent, generateImage, generateAudio, fetchDailyAINews, uploadToYouTube, generateSEOMetadata, generateYouTubeThumbnail, TOPIC_ROTATION } from './services/geminiService';

const CLIENT_ID = "461089785128-58o1771s4086p7q8le71cvk2a77ipar5.apps.googleusercontent.com"; // Netlify Production Client ID

// --- DEBUG CONSOLE COMPONENT ---
const useDebugLogs = () => {
    const [logs, setLogs] = useState<string[]>([]);
    useEffect(() => {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        const addLog = (type: string, args: any[]) => {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            setLogs(prev => [`[${type}] ${msg}`, ...prev].slice(0, 50));
        };

        console.log = (...args) => { addLog('LOG', args); originalLog(...args); };
        console.error = (...args) => { addLog('ERR', args); originalError(...args); };
        console.warn = (...args) => { addLog('WRN', args); originalWarn(...args); };

        return () => {
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
        };
    }, []);
    return logs;
};

const DebugOverlay = ({ logs, state }: { logs: string[], state: any }) => {
    const [isOpen, setIsOpen] = useState(false); // Hidden by default (production)
    if (!isOpen) return null; // Completely hidden

    return (
        <div className="fixed bottom-4 left-4 z-[9999] w-96 h-96 bg-black/90 border border-white/20 rounded-xl overflow-hidden flex flex-col font-mono text-[10px] text-zinc-400 shadow-2xl pointer-events-auto">
            <div className="bg-zinc-800 p-2 flex justify-between items-center border-b border-white/10">
                <span className="font-bold text-white">SYSTEM MONITOR</span>
                <button onClick={() => setIsOpen(false)} className="text-zinc-500 hover:text-white">_</button>
            </div>
            <div className="p-2 border-b border-white/10 bg-zinc-900/50">
                <div>CHANNEL: {state.channel ? 'LINKED' : 'MISSING'}</div>
                <div>TOKEN: {state.channel?.accessToken ? (state.channel.accessToken.substring(0, 5) + '...') : 'NONE'}</div>
                <div>AUTO: {state.auto ? 'ON' : 'OFF'}</div>
                <div>STEP: {state.step}</div>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
                {logs.map((log, i) => (
                    <div key={i} className={`${log.includes('ERR') ? 'text-red-400' : log.includes('WRN') ? 'text-yellow-400' : 'text-zinc-300'} break-all border-b border-white/5 pb-0.5`}>
                        {log}
                    </div>
                ))}
            </div>
        </div>
    );
};
// -------------------------------

const DAILY_UPLOAD_LIMIT = 10;

const checkDailyQuota = () => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const stats = JSON.parse(localStorage.getItem('upload_stats') || '{}');

    if (stats.date !== today) {
        return { count: 0, date: today };
    }
    return stats;
};

const incrementUploadCount = () => {
    const stats = checkDailyQuota();
    stats.count += 1;
    localStorage.setItem('upload_stats', JSON.stringify(stats));
    return stats.count;
};

const getNextTopic = () => {
    const lastIndex = parseInt(localStorage.getItem('last_topic_index') || '-1');
    const nextIndex = (lastIndex + 1) % TOPIC_ROTATION.length;
    localStorage.setItem('last_topic_index', nextIndex.toString());
    return TOPIC_ROTATION[nextIndex];
};


const App: React.FC = () => {
    const [step, setStep] = useState<AppStep>(AppStep.DASHBOARD);
    const [content, setContent] = useState<GeneratedContent | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploadErrorDetail, setUploadErrorDetail] = useState<string | null>(null); // NEW: Dedicated debug state
    const [loadingMsg, setLoadingMsg] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [activeSegment, setActiveSegment] = useState(0);
    const activeSegmentRef = useRef(0); // Ref for recording draw loop
    const [faceImage, setFaceImage] = useState<string | null>(() => localStorage.getItem('user_face'));
    const [topic, setTopic] = useState('');

    // YouTube & Automation State
    const [youtubeChannel, setYoutubeChannel] = useState<YouTubeChannel | null>(() => {
        const saved = localStorage.getItem('youtube_channel');
        return saved ? JSON.parse(saved) : null;
    });

    const youtubeChannelRef = useRef<YouTubeChannel | null>(null); // Stale closure fix

    // Update ref whenever state changes to avoid stale closures in callbacks
    useEffect(() => {
        youtubeChannelRef.current = youtubeChannel;
    }, [youtubeChannel]);

    const [isAutoEnabled, setIsAutoEnabled] = useState(false);
    const isAutoEnabledRef = useRef(false); // Ref for loop control
    const [lastUploadedUrl, setLastUploadedUrl] = useState<string | null>(null);

    const toggleAutoMode = (enabled: boolean) => {
        setIsAutoEnabled(enabled);
        isAutoEnabledRef.current = enabled;
    };

    const [nextBroadcastTime, setNextBroadcastTime] = useState<number | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [seoMetadata, setSeoMetadata] = useState<{ title: string; description: string } | null>(null);
    const [tickerMsg, setTickerMsg] = useState('FETCHING LATEST MARKET DATA... CRYPTO: BTC +2.4% | ETH -1.1% | AI-INDEX: +5.7% | BREAKING: NANOBANANA ENGINE UPDATED TO V4.0...');

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const broadcastContainerRef = useRef<HTMLDivElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const tokenClientRef = useRef<any>(null);

    // [Step 1] Character-Weighted Sync Calculation
    // [Step 1] Character-Weighted Sync Calculation
    const segmentWeights = React.useMemo(() => {
        if (!content) return [];
        const totalChars = content.segments.reduce((acc, s) => acc + (s.text?.length || 0), 0) || 1;
        let cumulative = 0;
        return content.segments.map(s => {
            cumulative += (s.text?.length || 0);
            return cumulative / totalChars;
        });
    }, [content]);

    useEffect(() => {
        // Initialize Google Identity Services
        const initGIS = () => {
            if ((window as any).google) {
                tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
                    callback: async (response: any) => {
                        console.log("[OAUTH] Response Received:", response);
                        if (response.error) {
                            console.error("[OAUTH] Error:", response.error, response.error_description);
                            setError(`YouTube link failed: ${response.error}. Check browser console for details.`);
                            return;
                        }
                        await fetchChannelInfo(response.access_token);
                    },
                    // For localhost development, no redirect_uri needed for popup flow
                    ux_mode: 'popup',
                });
            } else {
                setTimeout(initGIS, 500); // Retry if script not loaded yet
            }
        };
        initGIS();
    }, []);

    const fetchChannelInfo = async (accessToken: string) => {
        try {
            const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                const channel = data.items[0];
                const channelData = {
                    name: channel.snippet.title,
                    id: channel.id,
                    thumbnail: channel.snippet.thumbnails.default.url,
                    linkedAt: new Date().toISOString(),
                    accessToken: accessToken
                };
                setYoutubeChannel(channelData);
                youtubeChannelRef.current = channelData; // Update ref
                localStorage.setItem('youtube_channel', JSON.stringify(channelData));
            }
        } catch (err) {
            console.error("Failed to fetch channel info", err);
        }
    };

    // Auto-generation timer
    useEffect(() => {
        let interval: any;
        if (isAutoEnabled) {
            const now = Date.now();
            const intervalTime = 144000000 / 10; // 2.4 hours in ms
            setNextBroadcastTime(now + intervalTime);

            interval = setInterval(() => {
                console.log("Scheduling Next Broadcast...");
                const stats = checkDailyQuota();
                if (stats.count < DAILY_UPLOAD_LIMIT) {
                    startBroadcast(true);
                } else {
                    console.log("Daily Quota Reached. Waiting for tomorrow.");
                    setLoadingMsg("🏠 DAILY QUOTA (10) REACHED. Resting until tomorrow...");
                }
            }, intervalTime);
        } else {
            setNextBroadcastTime(null);
        }
        return () => clearInterval(interval);
    }, [isAutoEnabled]);

    // OAuth logic
    const handleLinkYouTube = () => {
        if (tokenClientRef.current) {
            tokenClientRef.current.requestAccessToken({ prompt: 'consent' });
        } else {
            setError("Google Login not ready. Please refresh.");
        }
    };

    const handleFaceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                setFaceImage(base64String);
                localStorage.setItem('user_face', base64String);
            };
            reader.readAsDataURL(file);
        }
    };

    const startBroadcast = async (useDailyNews: boolean) => {
        if (!useDailyNews && !topic.trim()) {
            setError("Please enter a topic.");
            return;
        }

        setError(null);
        setRecordedBlob(null);
        try {
            let newsContext = "";
            let groundingSources: any[] = [];
            setActiveSegment(0); // Reset for new broadcast
            setLastUploadedUrl(null); // Clear previous link

            const stats = checkDailyQuota();
            if (isAutoEnabledRef.current && stats.count >= DAILY_UPLOAD_LIMIT) {
                console.log("Auto-broadcast blocked by quota.");
                return;
            }

            const activeTopic = useDailyNews ? getNextTopic() : topic;
            console.log(`=== BROADCAST STARTING: ${activeTopic} ===`);

            if (useDailyNews) {
                setStep(AppStep.FETCHING_NEWS);
                setLoadingMsg(`Polling Experts on ${activeTopic}...`);
                const news = await fetchDailyAINews(); // Placeholder mostly now, we can refine this per topic if needed
                newsContext = news.summary;
                groundingSources = news.sources;
            }

            setStep(AppStep.GENERATING_SCRIPT);
            setLoadingMsg(`Writing 20-Min Special: ${activeTopic}...`);
            const segments = await generateStructuredContent(activeTopic, newsContext);
            const fullScript = segments.map((s: ScriptSegment) => s.text).join(" ");

            setStep(AppStep.GENERATING_VISUALS);
            setLoadingMsg("Nano Banana: Generating Scene Backgrounds...");
            const backgroundImages = [];
            for (const s of segments) {
                // Sequential generation to avoid hitting API Rate Limits on Free Tier
                const img = await generateImage(`Cinematic wide shot: ${s.visualPrompt}`);
                backgroundImages.push(img);
                // Artificial delay to be safe
                await new Promise(r => setTimeout(r, 1000));
            }

            // Avatar generation skipped as removed from UI
            let finalAvatar = faceImage || "https://placeholder"; // Placeholder to satisfy type/logic if needed, but won't be drawn

            setStep(AppStep.GENERATING_AUDIO);
            setLoadingMsg("Synthesizing Broadcast Audio...");
            const audioBlobUrl = await generateAudio(fullScript);

            setLoadingMsg("Optimizing SEO for YouTube...");
            const seo = await generateSEOMetadata(fullScript, topic);
            setSeoMetadata(seo);

            setLoadingMsg("Designing High-Impact Thumbnail...");
            const footerThumbnail = await generateYouTubeThumbnail(topic, seo.title);

            if (newsContext) {
                setTickerMsg(`BREAKING: ${newsContext.substring(0, 500).toUpperCase()}... CONTENT OPTIMIZED BY NANO BANANA ENGINE...`);
            }

            const generatedContent = {
                hostVideoUrl: finalAvatar,
                segments,
                backgroundImages,
                audioBlobUrl,
                fullScript,
                thumbnailUrl: footerThumbnail,
                seoTags: seo.tags,
                newsSources: groundingSources as any
            };

            setContent(generatedContent);
            setStep(AppStep.RESULT);

            // Auto-start recording & upload session - pass content directly to avoid stale closure
            setTimeout(() => {
                startRecordingSession(true, generatedContent);
            }, 1500);

        } catch (err: any) {
            console.error("Broadcast generation failed", err);

            // Check if this is a fatal error (don't retry these)
            const errMsg = err?.message || String(err);
            const isFatalError = errMsg.includes("403") || errMsg.includes("401") ||
                errMsg.includes("429") || errMsg.includes("500") || errMsg.includes("502") ||
                errMsg.includes("leaked") || errMsg.includes("PERMISSION_DENIED") ||
                errMsg.includes("Unauthorized") || errMsg.includes("Bad Gateway") ||
                errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota");

            if (isFatalError) {
                // If it is a Quota error (429), we SHOULD retry after a delay
                if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
                    console.warn("Quota exceeded. Initiating 60s cooldown...");
                    setLoadingMsg("⏳ Quota Limit Hit. Cooling down for 60s...");

                    // Wait 60 seconds then retry
                    setTimeout(() => {
                        console.log("Cooldown complete. Retrying...");
                        startBroadcast(useDailyNews);
                    }, 60000);
                    return;
                }

                console.error("FATAL: Server or API Error. Stopping retries.", errMsg);
                setError("Server error. Check Netlify function logs or API key configuration.");
                setStep(AppStep.DASHBOARD);
                return; // Do NOT retry other fatal errors
            }

            setError("Broadcast failed. Retrying in 10s...");
            // Retry automatically for loop reliability (only for transient errors)
            if (useDailyNews) {
                setTimeout(() => startBroadcast(true), 10000);
            } else {
                setStep(AppStep.DASHBOARD);
            }
        }
    };

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const requestRef = useRef<number>();
    const audioCtxRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

    const isUploadingRef = useRef(false); // IDEMPOTENCY GUARD
    const finalizeUploadRef = useRef<(blob: Blob) => Promise<void>>(async () => { }); // Exposed handler

    // --- SHARED UPLOAD LOGIC ---
    useEffect(() => {
        finalizeUploadRef.current = async (finalBlob: Blob) => {
            if (isUploadingRef.current) {
                console.log("[GUARD] Upload already in progress, skipping.");
                return;
            }
            isUploadingRef.current = true;

            console.log("[LOG] PROCESSING RECORDING... Blob Size:", finalBlob.size);
            if (finalBlob.size === 0) {
                console.error("[ERR] Recording is empty (0 bytes). Check streams.");
                setLoadingMsg("⚠️ RECORDING FAILED: 0 BYTES. REFRESH & RETRY.");
                return;
            }

            setRecordedBlob(finalBlob);
            setIsRecording(false);
            setIsPlaying(false);

            const currentChannel = youtubeChannelRef.current;
            const autoEnabled = isAutoEnabledRef.current;

            if (currentChannel?.accessToken) {
                console.log("=== YOUTUBE UPLOAD STARTING ===");
                setLoadingMsg("🚀 PUBLISHING TO YOUTUBE...");
                try {
                    const finalTitle = seoMetadata?.title || `AI Daily News: ${new Date().toLocaleDateString()}`;
                    const finalDesc = seoMetadata?.description || "Automated broadcast generated by Gemini & Nano Banana.";
                    const finalTags = content?.seoTags || [];
                    const finalThumbnail = content?.thumbnailUrl;

                    const videoData = await uploadToYouTube(finalBlob, finalTitle, finalDesc, currentChannel.accessToken, finalTags, finalThumbnail);

                    setLastUploadedUrl(`https://youtu.be/${videoData.id}`);
                    setLoadingMsg("✅ UPLOAD COMPLETE! Scaling next show...");

                    incrementUploadCount();

                    // ALWAYS loop automatically after successful upload
                    const intervalTime = 144000000 / 10; // 2.4 hours
                    setTimeout(() => startBroadcast(true), intervalTime);
                } catch (uploadError: any) {
                    console.error("=== YOUTUBE UPLOAD FAILED ===", uploadError);
                    const detailedErr = uploadError.message || JSON.stringify(uploadError);
                    setUploadErrorDetail(detailedErr);

                    if (uploadError.message?.includes("401") || uploadError.message?.includes("Unauthorized")) {
                        setLoadingMsg("⚠️ YOUTUBE LOGIN EXPIRED. Retrying in 30s...");
                        setTimeout(() => startBroadcast(true), 30000); // Retry even on auth errors
                    } else {
                        setLoadingMsg("⚠️ Upload failed. Retrying in 20s...");
                        setTimeout(() => startBroadcast(true), 20000);
                    }
                }
            } else {
                console.warn(`=== UPLOAD SKIPPED === Channel Linked: ${!!currentChannel}`);
                setLoadingMsg("⚠️ No YouTube channel. Starting next broadcast anyway...");
                setTimeout(() => startBroadcast(true), 15000);
            }
        };
    }, [content, seoMetadata]);

    const startRecordingSession = async (autoUpload = false, passedContent?: GeneratedContent) => {
        console.log("=== STARTING RECORDING SESSION ===");

        // Use passed content to avoid stale closure, fall back to state
        const contentToUse = passedContent || content;

        if (!contentToUse || !audioRef.current) {
            console.error("ABORT: content or audioRef missing", { content: !!contentToUse, audioRef: !!audioRef.current });
            return;
        }
        console.log("[OK] Content available:", contentToUse.segments?.length, "segments");

        // Reset state
        setRecordedBlob(null);
        setIsRecording(true);
        isUploadingRef.current = false;
        activeSegmentRef.current = 0; // Reset segment for new recording
        console.log("[1] State reset complete");

        // Setup Canvas
        let canvas = canvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = 3840;
            canvas.height = 2160;
            canvas.style.position = 'fixed';
            canvas.style.top = '-9999px'; // Hidden off-screen (production)
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);
            canvasRef.current = canvas;
            console.log("[2] Canvas created and attached to DOM");
        } else {
            console.log("[2] Canvas already exists");
        }

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
            console.error("ABORT: Could not get canvas context");
            return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        console.log("[3] Canvas context obtained (High Quality)");

        try {
            // 1. Audio Setup - MUST ensure all refs are ready
            console.log("[4] Setting up AudioContext...");

            if (!audioCtxRef.current) {
                audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                console.log("[4a] Created new AudioContext");
            }

            if (!audioSourceRef.current && audioRef.current) {
                audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current);
                console.log("[4b] Created MediaElementSource");
            }

            // Check if destination tracks are still alive
            let needsNewDestination = !destinationRef.current;
            if (destinationRef.current) {
                const tracks = destinationRef.current.stream.getAudioTracks();
                if (tracks.length === 0 || tracks.some(t => t.readyState === 'ended')) {
                    console.warn("[4c] Audio tracks ended or missing, recreating destination...");
                    needsNewDestination = true;
                }
            }

            if (needsNewDestination) {
                // If we have an old source, disconnect it first to be safe
                if (audioSourceRef.current) {
                    try { audioSourceRef.current.disconnect(); } catch (e) { }
                }
                destinationRef.current = audioCtxRef.current.createMediaStreamDestination();
                if (audioSourceRef.current) {
                    audioSourceRef.current.connect(destinationRef.current);
                    audioSourceRef.current.connect(audioCtxRef.current.destination);
                }
                console.log("[4d] Recreated and reconnected destination");
            }

            if (audioCtxRef.current.state === 'suspended') {
                await audioCtxRef.current.resume();
                console.log("[4e] Resumed suspended AudioContext");
            }

            // 4. Pre-load images & Wait for Fonts [Step 1 Hardening]
            const bgImages = contentToUse.backgroundImages.map(url => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = url;
                return img;
            });
            const hostImg = new Image();
            hostImg.crossOrigin = "anonymous";
            hostImg.src = contentToUse.hostVideoUrl;

            await document.fonts.ready;
            console.log("[4] Fonts and images loading initiated");

            // [Step 1] Calculate character-weighted segment timing
            const totalChars = contentToUse.segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
            let charAcc = 0;
            const segmentWeights = contentToUse.segments.map(s => {
                charAcc += (s.text?.length || 0);
                return charAcc / (totalChars || 1);
            });
            console.log("[4a] Segment weights calculated:", segmentWeights);

            // 5. Define draw function
            let lastSegIdx = 0;
            let animationTime = 0;
            const FPS = 60;

            // [Step 2] Cinematic Particle System Initialization
            const particles = Array.from({ length: 80 }, () => ({
                x: Math.random() * 3840,
                y: Math.random() * 2160,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                size: Math.random() * 15 + 2,
                opacity: Math.random() * 0.3 + 0.05
            }));

            const drawFrame = () => {
                const segIdx = activeSegmentRef.current;
                const segment = contentToUse.segments[segIdx];
                const layout = segment?.layout || 'CENTER';
                const highlights = segment?.highlights || [];
                const glyphs = "0123456789ABCDEF<>[]/\\|+=*&%$#@!";

                const audio = audioRef.current;
                const duration = audio?.duration || 1;
                const currentTime = audio?.currentTime || 0;
                const totalProgress = currentTime / duration;

                // [Step 5] Calculate progress within current segment for synced reveal
                const startWeight = segIdx === 0 ? 0 : segmentWeights[segIdx - 1];
                const endWeight = segmentWeights[segIdx];
                const segmentWeight = endWeight - startWeight;
                const progressWithinSegment = Math.min(1, Math.max(0, (totalProgress - startWeight) / segmentWeight));

                // [Step 5] Transitions (Fade in/out)
                let globalFade = 1.0;
                if (progressWithinSegment < 0.1) globalFade = progressWithinSegment / 0.1;
                if (progressWithinSegment > 0.9) globalFade = (1.0 - progressWithinSegment) / 0.1;

                animationTime += 1 / FPS;

                // Sync Log (Throttled)
                if (Math.round(animationTime * FPS) % 60 === 0) {
                    console.log(`[DRAW] Seg: ${segIdx} | Prog: ${(progressWithinSegment * 100).toFixed(0)}% | Layout: ${layout}`);
                }

                // [Step 7] Temporal Glitch Logic (Year 2200 Persona)
                let shakeX = 0; let shakeY = 0;
                let aberration = 0;
                let isGlitching = false;

                const cycleTime = animationTime % 10;
                // Enhanced Glitch on Cuts & Random Temporal Spikes
                if (cycleTime < 0.6 || progressWithinSegment < 0.08 || (Math.random() > 0.99)) {
                    isGlitching = true;
                    const power = cycleTime < 0.6 ? (0.6 - cycleTime) : (0.08 - progressWithinSegment);
                    shakeX = (Math.random() - 0.5) * 80 * power;
                    shakeY = (Math.random() - 0.5) * 40 * power;
                    aberration = 25 * power;
                }

                // [Step 4/7] Quantum Camera & 3D Parallax
                const isCloseUp = Math.floor(animationTime / 10) % 2 === 1;
                const zoomBase = isCloseUp ? 1.5 : 1.25;
                const zoomFactor = zoomBase + 0.1 * Math.sin(animationTime * 0.5);

                const panX = 180 * Math.sin(animationTime * 0.25) + shakeX;
                const panY = 100 * Math.cos(animationTime * 0.3) + shakeY;

                ctx.fillStyle = '#020205'; // Quantum Void Black
                ctx.fillRect(0, 0, 3840, 2160);

                // [Step 7] Holographic 3D Grid Layer
                ctx.save();
                ctx.strokeStyle = 'rgba(220, 38, 38, 0.1)';
                ctx.lineWidth = 2;
                const gridSpace = 150;
                const gridOff = (animationTime * 100) % gridSpace;
                for (let x = -gridSpace; x < 3840 + gridSpace; x += gridSpace) {
                    ctx.beginPath();
                    ctx.moveTo(x + gridOff, 0);
                    ctx.lineTo(x + gridOff + (panX * 0.5), 2160);
                    ctx.stroke();
                }
                for (let y = -gridSpace; y < 2160 + gridSpace; y += gridSpace) {
                    ctx.beginPath();
                    ctx.moveTo(0, y + (animationTime * 50) % gridSpace);
                    ctx.lineTo(3840, y + (animationTime * 50) % gridSpace + (panY * 0.3));
                    ctx.stroke();
                }
                ctx.restore();

                // [Step 7] Binary Neural Streams (Background)
                ctx.save();
                ctx.font = '14px monospace';
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                for (let i = 0; i < 20; i++) {
                    const bx = (i * 200 + animationTime * 50) % 3840;
                    const bText = Math.random().toString(2).substring(2, 40);
                    ctx.fillText(bText, bx, (i * 120) % 2160);
                }
                ctx.restore();

                // [Step 8] Quantum Background Engine (Blurred Fog)
                ctx.save();
                ctx.globalAlpha = 0.4;
                const currentBg = bgImages[segIdx];
                if (currentBg?.complete && currentBg.naturalWidth > 0) {
                    ctx.drawImage(currentBg, 0, 0, 3840, 2160);
                }
                ctx.restore();

                // [Step 7] DRAW ATMOSPHERIC PARTICLES (Subtle Layer)
                ctx.save();
                particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < 0) p.x = 3840; if (p.x > 3840) p.x = 0;
                    if (p.y < 0) p.y = 2160; if (p.y > 2160) p.y = 0;
                    const pOsc = 0.5 + 0.5 * Math.sin(animationTime * 2 + (p.x / 100));
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * pOsc})`;
                    ctx.fill();
                });
                ctx.restore();

                // [Step 8] MEDIA PORTAL (PiP Window)
                ctx.save();
                const portalW = 1920;
                const portalH = 1080;
                let px = 1920 - (portalW / 2);
                let py = 400; // Default Center top

                if (layout === 'SIDEBAR') {
                    px = 150;
                    py = 400;
                }

                // Add virtual camera motion to portal
                px += panX * 0.3;
                py += panY * 0.3;

                // Portal Frame (Quantum Glass)
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.shadowColor = 'rgba(220,38,38,0.5)';
                ctx.shadowBlur = 100;
                ctx.fillRect(px - 10, py - 10, portalW + 20, portalH + 20);

                // Draw Portal Content
                if (currentBg?.complete && currentBg.naturalWidth > 0) {
                    ctx.drawImage(currentBg, px, py, portalW, portalH);
                }

                // Holographic Border [Step 8]
                ctx.strokeStyle = 'rgba(220,38,38,0.8)';
                ctx.lineWidth = 10;
                ctx.strokeRect(px, py, portalW, portalH);

                // Portal Scanline
                ctx.fillStyle = 'rgba(220,38,38,0.1)';
                const portalScan = (animationTime * 800) % portalH;
                ctx.fillRect(px, py + portalScan, portalW, 4);
                ctx.restore();

                const sideW = 1600; // Neural Sidebar Width

                // [Step 3/6/8] Glassmorphism SIDEBAR
                if (layout === 'SIDEBAR') {
                    ctx.save();
                    ctx.globalAlpha = globalFade;

                    // Main Glass Panel (Right side for PiP)
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 100;
                    ctx.fillRect(3840 - sideW, 0, sideW, 2160);

                    // Glass Accent Border (Neon)
                    ctx.fillStyle = 'rgba(220, 38, 38, 0.8)';
                    ctx.fillRect(3840 - sideW, 0, 8, 2160);

                    // Highlights with Glow
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    highlights.forEach((point, i) => {
                        const hpy = 800 + (i * 220);
                        const pAlpha = Math.min(1, progressWithinSegment * 5 - i);
                        if (pAlpha <= 0) return;

                        ctx.save();
                        ctx.globalAlpha = pAlpha * globalFade;
                        ctx.fillStyle = 'rgba(220, 38, 38, 0.1)';
                        ctx.fillRect(3840 - sideW + 100, hpy - 20, sideW - 200, 160);

                        ctx.fillStyle = 'white';
                        ctx.font = '900 italic 70px "Inter", sans-serif';
                        ctx.shadowColor = 'red';
                        ctx.shadowBlur = 30;
                        ctx.fillText(`▶ ${point.toUpperCase()}`, 3840 - sideW + 150, hpy + 15);
                        ctx.restore();
                    });
                    ctx.restore();
                }

                // High-quality Background Gradient (Lower half)
                const grad = ctx.createLinearGradient(0, 1080, 0, 2160);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(1, 'rgba(0,0,0,0.9)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 3840, 2160);

                // [Step 3/6/8] Layout-Aware Text Rendering + PiP Adjustments
                if (layout !== 'FULL_IMAGE') {
                    ctx.save();
                    ctx.globalAlpha = globalFade;

                    const fullText = segment?.text?.toUpperCase() || "";
                    const rawWords = fullText.split(' ');
                    const wordCountToReveal = Math.floor(rawWords.length * progressWithinSegment) + 1;
                    const visibleWords = rawWords.slice(0, wordCountToReveal);

                    let line = '';
                    const lines: string[] = [];
                    const maxTextWidth = layout === 'SIDEBAR' ? 1800 : 3400; // Adjusted for PiP

                    ctx.font = '900 italic 110px "Inter", sans-serif';
                    for (const word of visibleWords) {
                        const test = line + word + ' ';
                        if (ctx.measureText(test).width > maxTextWidth && line) {
                            lines.push(line);
                            line = word + ' ';
                        } else {
                            line = test;
                        }
                    }
                    lines.push(line);

                    const lineHeight = 140;
                    const totalHeight = lines.length * lineHeight;

                    // Position text below Portal or Beside it [Step 8]
                    const tx = layout === 'SIDEBAR' ? 3840 - 1500 : 1920;
                    let ty = layout === 'SIDEBAR' ? 400 : 1600 - (totalHeight / 2);

                    // [Step 6/7/8] Headline Glass Card (Temporal Aura)
                    ctx.save();
                    const auraGlow = 0.4 + 0.1 * Math.sin(animationTime * 5);
                    ctx.fillStyle = `rgba(10, 10, 20, ${auraGlow})`;
                    ctx.shadowColor = 'rgba(220, 38, 38, 0.4)';
                    ctx.shadowBlur = 100 * auraGlow;
                    const cardW = layout === 'SIDEBAR' ? 2000 : 3600;
                    const cardX = layout === 'SIDEBAR' ? 3840 - sideW - 1000 : 1920 - (cardW / 2);
                    ctx.fillRect(cardX, ty - 80, cardW, totalHeight + 160);

                    // Neon Border [Step 8]
                    ctx.fillStyle = 'rgba(220, 38, 38, 0.9)';
                    const neonW = cardW * progressWithinSegment;
                    ctx.fillRect(cardX, ty + totalHeight + 70, neonW, 12);
                    ctx.restore();

                    ctx.textAlign = layout === 'SIDEBAR' ? 'left' : 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = 'white';

                    lines.forEach((l, i) => {
                        const isLastLine = i === lines.length - 1;
                        if (isGlitching) {
                            ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = '#00ffff'; ctx.fillText(l, tx + 10, ty); ctx.restore();
                        }
                        if (isLastLine && progressWithinSegment < 0.98) {
                            const wordsInLine = l.trim().split(' ');
                            const lastWord = wordsInLine[wordsInLine.length - 1];
                            const baseText = wordsInLine.slice(0, -1).join(' ') + ' ';
                            let scrambled = ""; for (let c = 0; c < lastWord.length; c++) scrambled += glyphs[Math.floor(Math.random() * glyphs.length)];
                            ctx.shadowBlur = 100; ctx.shadowColor = '#ff3300';
                            ctx.save(); ctx.translate(tx, ty); ctx.scale(1.05, 1.05);
                            ctx.fillText((Math.random() > 0.7) ? baseText + scrambled : l, 0, 0); ctx.restore();
                        } else {
                            ctx.shadowBlur = 40; ctx.shadowColor = 'black';
                            ctx.fillText(l, tx, ty);
                        }
                        ty += lineHeight;
                    });
                    ctx.restore();
                }

                // [Step 6] CINEMATIC OVERLAYS (Scanlines, Vignette, Noise)
                ctx.save();
                // 1. Digital Scanlines
                ctx.globalAlpha = 0.08;
                for (let i = 0; i < 2160; i += 8) {
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, i, 3840, 2);
                }
                // 2. Heavy Vignette
                const vignette = ctx.createRadialGradient(1920, 1080, 500, 1920, 1080, 2200);
                vignette.addColorStop(0, 'rgba(0,0,0,0)');
                vignette.addColorStop(1, 'rgba(0,0,0,0.8)');
                ctx.globalAlpha = 0.8;
                ctx.fillStyle = vignette;
                ctx.fillRect(0, 0, 3840, 2160);
                // 3. VCR Top/Bottom Bars
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, 3840, 60);
                ctx.fillRect(0, 2100, 3840, 60);
                ctx.restore();

                // Ticker with SCROLLING (Scaled 4K)
                ctx.fillStyle = '#dc2626';
                ctx.fillRect(0, 1940, 3840, 220);

                // Breaking News Label
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 1940, 700, 220);
                ctx.fillStyle = '#dc2626';
                ctx.font = '900 italic 90px "Inter", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText("BREAKING NEWS", 350, 2080);

                // Scrolling Text
                ctx.save();
                ctx.beginPath();
                ctx.rect(700, 1940, 3840 - 700, 220);
                ctx.clip();

                ctx.fillStyle = 'white';
                ctx.font = '900 italic 90px "Inter", sans-serif';
                ctx.textAlign = 'left';

                // Calculate scroll position
                const tickerText = tickerMsg + "   +++   " + tickerMsg;
                const textWidth = ctx.measureText(tickerText).width;
                const speed = 300; // pixels per second (Scaled for 4K)
                const offset = (animationTime * speed) % textWidth;

                let gx = 760 - offset;
                if (gx < 700 - textWidth) gx += textWidth;

                // Draw twice to loop seamlessly
                ctx.fillText(tickerText, gx, 2080);
                ctx.fillText(tickerText, gx + textWidth, 2080);

                ctx.restore();
            };

            // 6. CRITICAL: Draw FIRST frame BEFORE creating stream
            console.log("[5] Drawing initial frame...");
            drawFrame();

            // 7. Animation loop
            const animationLoop = () => {
                drawFrame();
                requestRef.current = requestAnimationFrame(animationLoop);
            };
            requestRef.current = requestAnimationFrame(animationLoop);

            // 8. NOW create stream from canvas that has content
            // 8. NOW create stream from canvas that has content
            console.log("[6] Creating video stream from canvas (60 FPS)...");
            const videoStream = canvas.captureStream(60);

            // 9. Combined stream with audio - with null check
            if (!destinationRef.current) {
                throw new Error("Audio destination not initialized");
            }

            const combinedStream = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...destinationRef.current.stream.getAudioTracks()
            ]);

            // Health check
            const vTracks = combinedStream.getVideoTracks();
            const aTracks = combinedStream.getAudioTracks();
            console.log("[7] Stream health - Video:", vTracks.length, vTracks[0]?.readyState, "Audio:", aTracks.length, aTracks[0]?.readyState);

            if (aTracks.length === 0 || aTracks[0].readyState === 'ended') {
                console.error("[CRITICAL] NO ACTIVE AUDIO TRACKS FOR RECORDING!");
            }

            // 10. Recorder Setup with timeslice for guaranteed data
            chunksRef.current = [];
            mediaRecorderRef.current = new MediaRecorder(combinedStream, {
                mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
                    ? 'video/webm;codecs=vp9,opus'
                    : 'video/webm',
                videoBitsPerSecond: 45000000 // 45 Mbps for Professional 4K
            });

            mediaRecorderRef.current.ondataavailable = (e) => {
                console.log("[LOG] Data chunk received:", e.data?.size || 0, "bytes");
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorderRef.current.onstop = () => {
                console.log("[LOG] RECORDER STOPPED. Total chunks:", chunksRef.current.length);
                if (requestRef.current) cancelAnimationFrame(requestRef.current);
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                console.log("[LOG] Final blob size:", blob.size);
                finalizeUploadRef.current(blob);
            };

            mediaRecorderRef.current.onerror = (e: any) => {
                console.error("[ERR] RECORDER ERROR:", e.error?.message || e);
            };

            mediaRecorderRef.current.onstart = () => {
                console.log("[LOG] RECORDER STARTED successfully!");
            };

            // MOVED: Do NOT start recorder immediately. Wait for audio play.
            // mediaRecorderRef.current.start(1000); 

            // Auto-start playback with robust retry
            const tryPlay = async () => {
                if (!audioRef.current) return;

                // Wait for audio to be ready
                if (audioRef.current.readyState < 2) {
                    console.log("Waiting for audio to load...");
                    await new Promise(resolve => {
                        if (!audioRef.current) return resolve(null);
                        audioRef.current.oncanplay = resolve;
                        // Timeout backup
                        setTimeout(resolve, 3000);
                    });
                }

                try {
                    console.log("Attempting auto-play...");
                    audioRef.current.currentTime = 0; // Ensure start from 0

                    // CRITICAL: Play audio FIRST
                    await audioRef.current.play();

                    // THEN start recorder if audio success
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                        console.log("[LOG] Audio playing, starting MediaRecorder...");
                        mediaRecorderRef.current.start(1000);
                    }

                    setIsPlaying(true);
                    console.log("Auto-play SUCCESS!");
                } catch (error) {
                    console.warn("Auto-play blocked. User must click play button.", error);
                    setIsPlaying(false); // Show button
                    // Do NOT start recorder
                }
            };
            tryPlay();

            // Safety Timeout: If recording runs way too long (e.g. 25 mins), force stop
            setTimeout(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    console.warn("[SAFETY] Recording exceeded max duration. Force stopping.");
                    mediaRecorderRef.current.stop();
                }
            }, 1500000); // 25 minutes

            // NOTE: audioRef.current.onended removed. Logic moved to handleBroadcastEnd

        } catch (e) {
            console.error("Recording failed", e);
            setIsRecording(false);
        }
    };

    const downloadVideo = () => {
        if (!recordedBlob) return;
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `broadcast_${Date.now()}.webm`;
        a.click();
    };

    // Unified Manual Start Handler
    const handleManualStart = async () => {
        if (!audioRef.current) return;

        try {
            // 1. Play Audio
            await audioRef.current.play();
            setIsPlaying(true);

            // 2. Start Recorder if not started
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                console.log("[MANUAL] Starting MediaRecorder...");
                mediaRecorderRef.current.start(1000);
            }
        } catch (e) {
            console.error("Manual start failed:", e);
        }
    };

    // Kept for simple pause/play toggling if needed during playback, 
    // but the main button calls handleManualStart for the initial kick.
    const togglePlayback = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
                // Pause recorder? Usually better to continuously record or stop. 
                // For this use case, we just pause audio.
            } else {
                audioRef.current.play();
                setIsPlaying(true);
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
                    mediaRecorderRef.current.resume();
                }
            }
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current && content && segmentWeights.length > 0) {
            const duration = audioRef.current.duration;
            if (!duration || isNaN(duration)) return;

            const currentTime = audioRef.current.currentTime;
            const progress = currentTime / duration;

            // [Step 1] Character-Weighted Sync
            const index = segmentWeights.findIndex(weightLimit => progress <= weightLimit);
            const finalIndex = index === -1 ? content.segments.length - 1 : index;

            if (finalIndex !== activeSegmentRef.current) {
                console.log(`[SYNC CHANGE] Seg: ${activeSegmentRef.current} -> ${finalIndex}`);
                setActiveSegment(finalIndex);
                activeSegmentRef.current = finalIndex;
            }
        }
    };

    return (
        <>
            {(step === AppStep.RESULT && content) && (
                <div className="min-h-screen bg-black flex flex-col p-4 md:p-8 animate-in fade-in duration-700">
                    <div ref={broadcastContainerRef} className="relative aspect-video bg-zinc-950 rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl mx-auto w-full max-w-[1600px]">
                        {content.backgroundImages.map((img, idx) => (
                            <img
                                key={idx}
                                src={img}
                                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${activeSegment === idx ? 'opacity-100 animate-flow' : 'opacity-0'}`}
                                alt=""
                            />
                        ))}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40"></div>

                        {/* Centered Headlines UI */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-12 md:p-20 pointer-events-none z-20">
                            <div className="max-w-6xl animate-reveal-slow flex flex-col items-center text-center">
                                {/* Text Content - Medium Size, Centered */}
                                <div className="space-y-6">
                                    <h1 key={activeSegment} className="text-3xl md:text-5xl lg:text-6xl font-black uppercase italic tracking-tighter leading-[1.2] text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] filter brightness-110">
                                        {content.segments[activeSegment]?.text || ""}
                                    </h1>

                                    <div className="mt-12 inline-flex items-center gap-4 px-6 py-2.5 bg-red-600/60 border border-red-500/50 text-white font-black uppercase italic text-[12px] tracking-[0.4em] rounded-full shadow-[0_0_30px_rgba(220,38,38,0.4)] backdrop-blur-xl animate-pulse">
                                        <div className="w-2 h-2 bg-white rounded-full"></div>
                                        LIVE BROADCAST  •  NK AI STUDIOS
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-red-600/90 py-3 border-t border-white/20 z-30 overflow-hidden">
                            <div className="flex items-center gap-8">
                                <div className="bg-white text-red-600 px-4 py-1 font-black uppercase italic text-[9px] tracking-widest z-40 relative shadow-xl">
                                    Breaking News
                                </div>
                                <div className="animate-ticker text-white font-black uppercase italic text-[11px] tracking-[0.2em]">
                                    {tickerMsg}
                                </div>
                            </div>
                        </div>

                        {/* Host Avatar REMOVED as requested */}

                        {/* Fallback Play Button - Only shows if auto-play fails */}
                        {!isPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50 cursor-pointer" onClick={handleManualStart}>
                                <div className="text-center animate-bounce">
                                    <div className="p-8 bg-red-600 text-white rounded-full shadow-[0_0_50px_rgba(220,38,38,1)] mb-6 mx-auto w-40 h-40 flex items-center justify-center border-4 border-white">
                                        <svg className="w-20 h-20 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                    </div>
                                    <div className="text-white font-black uppercase italic tracking-widest text-2xl drop-shadow-lg bg-black/50 px-6 py-2 rounded-xl">
                                        Click to Start & Upload
                                    </div>
                                    <div className="text-red-400 font-bold uppercase text-xs mt-2 tracking-widest">
                                        Browser blocked auto-play
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* Status / Upload Feedback Bar */}
                    <div className="mt-6 flex flex-wrap gap-4 items-center justify-between">
                        <div className="flex gap-4 items-center">
                            <div className="px-8 py-4 bg-zinc-900/50 text-zinc-500 font-black uppercase tracking-[0.2em] text-[8px] rounded-2xl border border-white/5">
                                Autonomous Loop Active
                            </div>

                            {loadingMsg && (loadingMsg.includes("PUBLISHING") || loadingMsg.includes("Looping") || loadingMsg.includes("UPLOAD")) && (
                                <div className="flex items-center gap-3 animate-pulse">
                                    <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                                    <span className="text-[10px] font-black uppercase text-yellow-500 tracking-widest">{loadingMsg}</span>
                                </div>
                            )}

                            {lastUploadedUrl && (
                                <a
                                    href={lastUploadedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-6 py-2 bg-red-600 text-white font-black uppercase text-[9px] tracking-widest rounded-full hover:bg-red-500 transition-all shadow-lg flex items-center gap-2 animate-bounce"
                                >
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" /></svg>
                                    Watch on YouTube
                                </a>
                            )}
                        </div>

                        {isAutoEnabled && (
                            <div className="text-zinc-600 text-[9px] font-black uppercase tracking-widest">
                                NEXT SHOW: {nextBroadcastTime ? new Date(nextBroadcastTime).toLocaleTimeString() : '...'}
                            </div>
                        )}
                    </div>

                    {/* NEW: Explicit Error Overlay for Debugging */}
                    {uploadErrorDetail && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-8">
                            <div className="bg-zinc-900 border-2 border-red-600 rounded-3xl p-8 max-w-2xl w-full shadow-[0_0_100px_rgba(220,38,38,0.5)]">
                                <h3 className="text-2xl font-black text-red-600 uppercase italic mb-4">Upload Error Detected</h3>
                                <div className="bg-black p-4 rounded-xl border border-white/10 overflow-auto max-h-60 mb-6">
                                    <code className="text-red-400 font-mono text-xs break-all whitespace-pre-wrap">
                                        {uploadErrorDetail}
                                    </code>
                                </div>
                                <div className="flex justify-end gap-4">
                                    <button
                                        onClick={() => setUploadErrorDetail(null)}
                                        className="px-6 py-3 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700"
                                    >
                                        Dismiss & Continue
                                    </button>
                                    <button
                                        onClick={() => {
                                            setUploadErrorDetail(null);
                                            handleLinkYouTube(); // Retry auth
                                        }}
                                        className="px-6 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-500"
                                    >
                                        Re-Link YouTube
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {(step !== AppStep.DASHBOARD && step !== AppStep.RESULT) && (
                <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 gap-12 text-center">
                    <div className="relative w-40 h-40">
                        <div className="absolute inset-0 border-8 border-white/5 rounded-full"></div>
                        <div className="absolute inset-0 border-8 border-t-red-600 rounded-full animate-spin"></div>
                    </div>
                    <div className="space-y-4">
                        <h2 className="text-3xl font-black uppercase italic tracking-tighter text-white animate-pulse">{loadingMsg}</h2>
                        <p className="text-zinc-700 text-[10px] font-black tracking-[0.8em] uppercase">Nano Banana Engine • YouTube Auto-Post Enabled</p>
                    </div>
                </div>
            )}

            {(step === AppStep.DASHBOARD) && (
                <div className="min-h-screen bg-black text-white p-6 md:p-12 font-sans selection:bg-red-600/30">
                    <header className="flex flex-col md:flex-row justify-between items-center mb-16 md:mb-24 gap-8">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center transform -rotate-12 shadow-[0_0_30px_rgba(255,255,255,0.15)]">
                                <span className="text-black font-black text-3xl">B</span>
                            </div>
                            <div>
                                <h1 className="text-3xl font-black uppercase italic tracking-tighter leading-none">Broadcast Agent</h1>
                                <span className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.5em] block mt-1">NK AI STUDIOS • 4K PROFESSIONAL</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-6 bg-zinc-900/50 p-2 pr-6 rounded-full border border-white/5">
                            {youtubeChannel ? (
                                <div className="flex items-center gap-3">
                                    <img src={youtubeChannel.thumbnail} className="w-10 h-10 rounded-full" alt="YT" />
                                    <div className="text-[10px] font-black uppercase text-zinc-400">{youtubeChannel.name} <span className="text-emerald-500 text-[8px] ml-2">Linked</span></div>
                                </div>
                            ) : (
                                <button onClick={handleLinkYouTube} className="px-6 py-2.5 bg-red-600 text-white font-black uppercase text-[9px] tracking-widest rounded-full hover:bg-red-500 transition-colors">
                                    Link YouTube
                                </button>
                            )}
                            <div className="w-px h-6 bg-white/10 mx-2"></div>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <span className="text-[9px] font-black uppercase text-zinc-500">Auto Mode</span>
                                <input
                                    type="checkbox"
                                    checked={isAutoEnabled}
                                    onChange={(e) => toggleAutoMode(e.target.checked)}
                                    className="w-4 h-4 accent-red-600"
                                />
                            </label>
                            <div className="w-px h-6 bg-white/10 mx-2"></div>
                            <div className="flex flex-col">
                                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">Daily Quota</span>
                                <span className="text-[10px] font-black uppercase text-emerald-500">{10 - checkDailyQuota().count} / 10 Remaining</span>
                            </div>
                        </div>
                    </header>

                    <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
                        <section className="lg:col-span-4 p-8 bg-zinc-900/30 border border-white/5 rounded-[3rem] space-y-10 shadow-2xl">
                            <h3 className="text-xl font-black uppercase italic tracking-tighter text-zinc-500">1. Upload Host Face</h3>
                            <div className="relative w-48 h-48 mx-auto">
                                <label className="block w-full h-full bg-zinc-800 rounded-full border-4 border-white/5 overflow-hidden cursor-pointer hover:border-white/20 transition-all shadow-xl group">
                                    {faceImage ? (
                                        <img src={faceImage} className="w-full h-full object-cover" alt="Avatar" />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 gap-2">
                                            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                                            <span className="text-[8px] font-black uppercase tracking-widest">Upload Profile</span>
                                        </div>
                                    )}
                                    <input type="file" className="hidden" accept="image/*" onChange={handleFaceUpload} />
                                </label>
                            </div>
                            <p className="text-[9px] text-zinc-600 font-bold text-center leading-relaxed tracking-widest uppercase">
                                Each broadcast is now <span className="text-zinc-400">20 minutes (4K)</span>. Quota resets daily.
                            </p>
                        </section>

                        <section className="lg:col-span-8 p-8 bg-zinc-900/30 border border-white/5 rounded-[3rem] space-y-10 shadow-2xl">
                            <h3 className="text-xl font-black uppercase italic tracking-tighter text-zinc-500">2. Broadcast Logic</h3>
                            <div className="space-y-4">
                                <textarea
                                    value={topic}
                                    onChange={(e) => setTopic(e.target.value)}
                                    placeholder="Describe your broadcast topic... (e.g. 'Future of humanoid robots')"
                                    className="w-full bg-black/40 border border-white/5 rounded-[2rem] p-8 text-xl font-bold focus:border-red-600/30 transition-all outline-none min-h-[12rem] resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <button
                                    onClick={() => {
                                        if (!audioCtxRef.current) {
                                            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                                        }
                                        startBroadcast(false);
                                    }}
                                    className="py-5 bg-white text-black font-black rounded-3xl uppercase italic text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-xl disabled:opacity-30"
                                    disabled={!topic.trim()}
                                >
                                    Manual Generate
                                </button>
                                <button
                                    onClick={() => {
                                        // Unlock AudioContext logic
                                        if (!audioCtxRef.current) {
                                            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                                        }
                                        if (audioCtxRef.current.state === 'suspended') {
                                            audioCtxRef.current.resume();
                                        }

                                        if (audioRef.current) {
                                            audioRef.current.play().then(() => {
                                                audioRef.current?.pause();
                                                if (audioRef.current) audioRef.current.currentTime = 0;
                                            }).catch(e => console.log("Audio unlock failed slightly:", e));
                                        }

                                        startBroadcast(true);
                                    }}
                                    className="py-5 bg-red-600 text-white font-black rounded-3xl uppercase italic text-lg hover:scale-[1.02] active:scale-95 transition-all shadow-xl flex items-center justify-center gap-3"
                                >
                                    <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse"></div>
                                    {youtubeChannel ? "Live Daily News" : "Generate & Auto-Publish"}
                                </button>
                            </div>

                            {error && <p className="text-[10px] text-red-500 font-black uppercase text-center tracking-widest">{error}</p>}

                            {isAutoEnabled && (
                                <div className="p-6 bg-red-600/5 border border-red-600/20 rounded-3xl">
                                    <p className="text-[10px] text-red-400 font-black uppercase text-center tracking-widest">
                                        Automation Active: Next broadcast in {nextBroadcastTime ? Math.round((nextBroadcastTime - Date.now()) / 60000) : '...'} minutes.
                                    </p>
                                </div>
                            )}
                        </section>
                    </main>

                    <footer className="mt-32 border-t border-white/5 py-10 text-center opacity-30">
                        <p className="text-[9px] font-black uppercase tracking-[1.2em]">Autonomous Broadcast Studio • Powered by Gemini & Nano Banana</p>
                    </footer>
                </div>
            )}

            {/* TRULY PERSISTENT AUDIO ELEMENT */}
            <audio
                ref={audioRef}
                src={content?.audioBlobUrl}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => {
                    console.log("AUDIO ENDED - STOPPING RECORDER");
                    setIsPlaying(false);
                    setActiveSegment(0);
                    activeSegmentRef.current = 0;
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                        mediaRecorderRef.current.stop();
                        // ONLY stop video tracks. Audio tracks from legacy destination node MUST persist.
                        mediaRecorderRef.current.stream.getVideoTracks().forEach(t => {
                            console.log(`[REC] Stopping video track: ${t.label}`);
                            t.stop();
                        });
                    } else {
                        console.warn("MediaRecorder INACTIVE. Forcing upload with collected chunks.");
                        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                        finalizeUploadRef.current(blob);
                    }
                }}
                className="hidden"
            />

            <DebugOverlay
                logs={useDebugLogs()}
                state={{
                    channel: youtubeChannel,
                    auto: isAutoEnabled,
                    step: step
                }}
            />
        </>
    );
};

export default App;
