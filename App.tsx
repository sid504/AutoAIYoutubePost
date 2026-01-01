import React, { useState, useRef, useEffect } from 'react';
import { AppStep, GeneratedContent, ScriptSegment, YouTubeChannel } from './types';
import { generateStructuredContent, generateImage, generateAudio, fetchDailyAINews, uploadToYouTube, generateSEOMetadata, generateYouTubeThumbnail, TOPIC_ROTATION } from './services/geminiService';
// 1. SETUP: CLIENT_ID from Env Var (Critical for Local vs Prod split)
const CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || '141862474119-6tl67uk28k57f3ia4cg01q1jcbh7pfno.apps.googleusercontent.com'; // Fallback to local for dev

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
    const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
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
        if (youtubeChannel && !isAutoEnabled) {
            console.log("Channel detected. Engaging Full Automation Mode.");
            setIsAutoEnabled(true);
            isAutoEnabledRef.current = true;
        }
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
    const debugLogs = useDebugLogs();

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const broadcastContainerRef = useRef<HTMLDivElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const tokenClientRef = useRef<any>(null);

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
                            console.error("[OAUTH] Error:", response.error, response.error_description, response);
                            setError(`YouTube Login Failed: ${response.error_description || response.error}. Please check console.`);
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

    // Global Audio unlock
    useEffect(() => {
        const unlock = async () => {
            if (audioCtxRef.current?.state === 'suspended') {
                await audioCtxRef.current.resume();
                console.log("[AUDIO] Context Unlocked");
                setIsAudioUnlocked(true);
            } else {
                setIsAudioUnlocked(true);
            }
            window.removeEventListener('click', unlock);
        };
        window.addEventListener('click', unlock);
        return () => window.removeEventListener('click', unlock);
    }, []);

    // OAuth logic
    const handleLinkYouTube = async () => {
        // Unlock AudioContext for automation
        if (audioCtxRef.current?.state === 'suspended') {
            await audioCtxRef.current.resume();
        }

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

    const isGeneratingRef = useRef(false);

    const startBroadcast = async (useDailyNews: boolean) => {
        if (isGeneratingRef.current) {
            console.warn("Broadcast generation already in progress.");
            return;
        }

        if (!useDailyNews && !topic.trim()) {
            setError("Please enter a topic.");
            return;
        }

        isGeneratingRef.current = true;
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
            let finalAvatar = faceImage || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fit=crop&w=150&h=150&q=80"; // Valid fallback image

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
                isGeneratingRef.current = false; // Reset guard after handover
            }, 1500);

        } catch (err: any) {
            isGeneratingRef.current = false; // Reset guard on error
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
    const requestRef = useRef<number | null>(null);
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
                setLoadingMsg("⚠️ RECORDING FAILED: 0 BYTES. RETRYING IN 10S...");
                isUploadingRef.current = false; // Reset for next attempt
                setIsRecording(false);
                setIsPlaying(false);

                if (isAutoEnabledRef.current) {
                    setTimeout(() => startBroadcast(true), 10000);
                }
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
                    setLoadingMsg("✅ UPLOAD COMPLETE! Starting next topic in 60s...");

                    incrementUploadCount();

                    // Sequential Loop: Wait 60s (quota buffer) then start next
                    setTimeout(() => startBroadcast(true), 60000);
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

    // AUTO-START TRIGGER
    useEffect(() => {
        if (youtubeChannel && !isGeneratingRef.current && !isAutoEnabled) {
            console.log("Channel detected. Engaging Full Automation Mode.");
            setIsAutoEnabled(true);
            isAutoEnabledRef.current = true;
            // Kick off the first one
            startBroadcast(true);
        }
    }, [youtubeChannel]);

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

        if (!ctx) {
            console.error("ABORT: Could not get canvas context");
            return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        console.log("[3] Canvas context obtained (High Quality)");

        // ANALYSER: Setup for "Advanced" Audio Visualization
        const analyser = audioCtxRef.current?.createAnalyser();
        if (analyser && audioSourceRef.current) {
            analyser.fftSize = 256;
            // Connect: Source -> Analyser -> Destination
            // We need to re-route carefully. 
            // Current chain: Source -> Destination & Source -> Hardware
            // New chain: Source -> Analyser -> Destination
            // And: Analyser -> Hardware (for monitoring? No, source usually goes to hardware)
            // Let's tap into it:
            try {
                audioSourceRef.current.connect(analyser); 
            } catch (e) { console.warn("Analyser connect failed", e); }
        }
        const bufferLength = analyser ? analyser.frequencyBinCount : 0;
        const dataArray = analyser ? new Uint8Array(bufferLength) : new Uint8Array(0);

        try {
            // ... (Previous Audio Setup Code mostly remains, but we utilized the analyser above) ...
            
            // 4. Pre-load images & Wait for Fonts
            const bgImages = contentToUse.backgroundImages.map(url => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = url;
                return img;
            });
            // ... (Weights calc) ...

            // 5. Define draw function
            let lastSegIdx = 0;
            let animationTime = 0;
            const FPS = 60;

            const drawFrame = () => {
                const segIdx = activeSegmentRef.current;
                const segment = contentToUse.segments[segIdx];
                const layout = segment?.layout || 'CENTER';
                
                // Get Audio Data for Visualization
                let audioLevel = 0;
                if (analyser) {
                    analyser.getByteFrequencyData(dataArray);
                    // Calculate average volume/energy
                    let sum = 0;
                    for(let i=0; i<bufferLength; i++) sum += dataArray[i];
                    audioLevel = sum / bufferLength; // 0-255
                }
                const audioScale = 1 + (audioLevel / 255) * 0.5; // 1.0 to 1.5

                const progressWithinSegment = 0.5; // Simplified for this snippet reference, assume calculated above (RETAIN ORIGINAL CALCULATIONS in real file)

                // RETAIN: Progress Calculation Logic (We are splicing into drawing only)
                const audio = audioRef.current;
                const duration = audio?.duration || 1;
                const currentTime = audio?.currentTime || 0;
                const totalProgress = currentTime / duration;
                const startWeight = segIdx === 0 ? 0 : segmentWeights[segIdx - 1];
                const endWeight = segmentWeights[segIdx];
                const sWeight = endWeight - startWeight;
                const prog = Math.min(1, Math.max(0, (totalProgress - startWeight) / sWeight));


                animationTime += 1 / FPS;

                // [Step 4] Quantum Camera - Reacts to AUDIO now!
                const panX = 100 * Math.sin(animationTime * 0.2) * audioScale;
                const panY = 50 * Math.cos(animationTime * 0.2 * 0.8);

                ctx.fillStyle = '#020205'; // Quantum Void Black
                ctx.fillRect(0, 0, 3840, 2160);

                // [Step 7] Holographic 3D Grid that BEATS with Audio
                ctx.save();
                ctx.strokeStyle = `rgba(220, 38, 38, ${0.1 * audioScale})`; // Beat flash
                ctx.lineWidth = 2 * audioScale;
                const gridSpace = 150;
                const gridOff = (animationTime * 80) % gridSpace;
                
                // Dynamic Perspective
                for (let x = -gridSpace; x < 3840 + gridSpace; x += gridSpace) {
                    ctx.beginPath();
                    ctx.moveTo(x + gridOff, 0);
                    // Distort grid with audio
                    const distort = (audioLevel / 5) * Math.sin(x/100 + animationTime);
                    ctx.lineTo(x + gridOff + (panX * 0.5) + distort, 2160);
                    ctx.stroke();
                }
                ctx.restore();

                // [Step 8] Render Bg or FALLBACK VISUALIZER
                const imgIdx = Math.min(segIdx, bgImages.length - 1);
                const currentBg = bgImages[imgIdx];
                
                ctx.save();
                if (currentBg?.complete && currentBg.naturalWidth > 0) {
                     // Existing Image Draw Logic...
                     const zoom = 1.05 + 0.05 * Math.sin(animationTime * 0.1); 
                     const zw = 3840 * zoom;
                     const zh = 2160 * zoom;
                     const zx = (3840 - zw) / 2 + panX;
                     const zy = (2160 - zh) / 2 + panY;
                     ctx.globalAlpha = 0.4;
                     ctx.drawImage(currentBg, zx, zy, zw, zh);
                } else {
                    // *** FALLBACK: ADVANCED AUDIO VISUALIZER ***
                    // If image fails, we show a cool Spectrum Circle
                    ctx.translate(1920, 1080);
                    const radius = 400 * audioScale;
                    
                    // 1. Core Sphere
                    const grad = ctx.createRadialGradient(0,0,10, 0,0, radius);
                    grad.addColorStop(0, '#ff0000');
                    grad.addColorStop(1, 'rgba(50,0,0,0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath(); ctx.arc(0,0, radius, 0, Math.PI*2); ctx.fill();

                    // 2. Circular Spectrum
                    ctx.strokeStyle = '#ff3333';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    for(let i=0; i<bufferLength; i++) {
                         const v = dataArray[i] / 128.0;
                         const angle = (i / bufferLength) * Math.PI * 2;
                         const h = 500 + (v * 300); // Bar height
                         const x1 = Math.cos(angle) * 500;
                         const y1 = Math.sin(angle) * 500;
                         const x2 = Math.cos(angle) * h;
                         const y2 = Math.sin(angle) * h;
                         ctx.moveTo(x1, y1);
                         ctx.lineTo(x2, y2);
                    }
                    ctx.stroke();
                    ctx.translate(-1920, -1080);
                }
                ctx.restore();

                // [Step 8] MEDIA PORTAL (PiP Window) with AUDIO REACTIVITY
                ctx.save();
                // ... (Portal logic: Add audio shake) ...
                const portalKick = (audioLevel > 180) ? 10 : 0; // Kick on loud bass
                const portalW = 1920 + portalKick;
                const portalH = 1080 + portalKick;
                let px = 1920 - (portalW / 2);
                let py = 450 - (portalKick/2);

                if (layout === 'SIDEBAR') { px = 1500; py = 450; }

                // Portal Frame
                ctx.fillStyle = 'rgba(0,0,0,0.85)'; // Darker
                ctx.shadowColor = `rgba(220,38,38,${0.5 * audioScale})`; // Glowing Beat
                ctx.shadowBlur = 60 * audioScale;
                ctx.fillRect(px, py, portalW, portalH);

                // Draw Portal Content (Same Fallback Logic)
                if (currentBg?.complete && currentBg.naturalWidth > 0) {
                     ctx.save();
                     ctx.beginPath();
                     ctx.rect(px, py, portalW, portalH);
                     ctx.clip();
                     ctx.drawImage(currentBg, px - (panX * 2), py - (panY * 2), portalW + 400, portalH + 200);
                     ctx.restore();
                } else {
                     // Portal Fallback: Digital Noise / Abstract
                     ctx.fillStyle = '#110000';
                     ctx.fillRect(px, py, portalW, portalH);
                     ctx.fillStyle = '#ff0000';
                     ctx.font = '100px monospace';
                     ctx.textAlign = 'center';
                     ctx.globalAlpha = 0.2;
                     ctx.fillText("NO SIGNAL", px + portalW/2, py + portalH/2);
                     
                     // Show waveform in portal
                     ctx.beginPath();
                     ctx.strokeStyle = '#ff0000';
                     ctx.lineWidth = 5;
                     const sliceWidth = portalW * 1.0 / bufferLength;
                     let x = px;
                     for(let i = 0; i < bufferLength; i++) {
                        const v = dataArray[i] / 128.0;
                        const y = py + (portalH/2) + (v * 100 - 100); // Waveform
                        if(i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                        x += sliceWidth;
                     }
                     ctx.stroke();
                }
                // ... (Border and Text rendering logic remains) ...


                // High-quality Background Gradient (Lower half for Text)
                const grad = ctx.createLinearGradient(0, 1200, 0, 2160);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(0.3, 'rgba(0,0,0,0.8)');
                grad.addColorStop(1, 'rgba(0,0,0,0.95)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 3840, 2160);

                // [Step 3/6/8] Layout-Aware Text Rendering
                if (layout !== 'FULL_IMAGE') {
                    ctx.save();
                    ctx.globalAlpha = globalFade;

                    const fullText = segment?.text || "";
                    // FIX: Ensure words aren't skipped. Reveal logic was too aggressive.
                    const rawWords = fullText.split(' ');
                    // Smoother reveal: 1 word every X frames or based on progress
                    const wordCountToReveal = Math.floor(rawWords.length * Math.min(1, progressWithinSegment * 1.2)); // Reveal slightly faster than Audio
                    const visibleWords = rawWords.slice(0, Math.max(1, wordCountToReveal));

                    // Improved wrapping logic
                    const lines: string[] = [];
                    let currentLine = '';
                    // Wider text area, smaller font for better fit
                    const fontSize = 100; 
                    const maxTextWidth = 3400; 
                    ctx.font = `900 ${fontSize}px "Inter", sans-serif`;

                    visibleWords.forEach(word => {
                        const testLine = currentLine + word + ' ';
                        const metrics = ctx.measureText(testLine);
                        if (metrics.width > maxTextWidth && currentLine !== '') {
                            lines.push(currentLine);
                            currentLine = word + ' ';
                        } else {
                            currentLine = testLine;
                        }
                    });
                    lines.push(currentLine);

                    const lineHeight = fontSize * 1.3;
                    const totalBlockHeight = lines.length * lineHeight;
                    let ty = 1750 - (totalBlockHeight / 2); // Center in lower third

                    // Headline Card Background
                    ctx.fillStyle = 'rgba(10, 10, 20, 0.7)';
                    ctx.shadowColor = 'rgba(0,0,0,0.9)';
                    ctx.shadowBlur = 50;
                    ctx.fillRect(100, ty - 60, 3640, totalBlockHeight + 120);

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = 'white';
                    ctx.shadowColor = 'black';
                    ctx.shadowBlur = 20;

                    lines.forEach((line, i) => {
                         // Alternate color for emphasis? No, keep it clean white per user request
                        ctx.fillText(line.trim(), 1920, ty + (i * lineHeight) + (lineHeight/2));
                    });
                    
                    ctx.restore();
                }

                // [Step 6] CINEMATIC OVERLAYS (Scanlines, Vignette)
                ctx.save();
                // Heavy Vignette
                const vignette = ctx.createRadialGradient(1920, 1080, 900, 1920, 1080, 2200);
                vignette.addColorStop(0, 'rgba(0,0,0,0)');
                vignette.addColorStop(1, 'rgba(0,0,0,0.9)');
                ctx.fillStyle = vignette;
                ctx.fillRect(0, 0, 3840, 2160);
                
                // Subtle Noise/Scanline
                ctx.globalAlpha = 0.05;
                ctx.fillStyle = '#ffffff';
                for (let y = 0; y < 2160; y+=4) ctx.fillRect(0, y, 3840, 1);
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
                    setLoadingMsg("🔴 ON AIR - AUTOMATION ACTIVE");

                    // THEN start recorder if audio success
                    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                        console.log("[LOG] Audio playing, starting MediaRecorder...");
                        mediaRecorderRef.current.start(100);
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
            // Unlock AudioContext
            if (audioCtxRef.current?.state === 'suspended') {
                await audioCtxRef.current.resume();
            }

            // 1. Play Audio
            await audioRef.current.play();
            setIsPlaying(true);

            // 2. Start Recorder if not started
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                console.log("[MANUAL] Starting MediaRecorder...");
                mediaRecorderRef.current.start(100);
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
        <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-red-900 selection:text-white overflow-hidden">
            <DebugOverlay logs={debugLogs} state={{ step, channel: youtubeChannel, auto: isAutoEnabled }} />

            {/* HEADER */}
            <div className="fixed top-0 left-0 w-full z-50 bg-black/80 backdrop-blur-md border-b border-white/10 p-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.8)]" />
                    <h1 className="text-xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
                        BROADCAST <span className="text-red-600">AGENT</span>
                    </h1>
                </div>
                {youtubeChannel && (
                    <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
                        <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-full border border-white/5">
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                            <span>LINKED: {youtubeChannel.name}</span>
                        </div>
                        <div className="px-3 py-1 bg-zinc-900 rounded-full border border-white/5">
                            DAILY QUOTA: {checkDailyQuota().count}/{DAILY_UPLOAD_LIMIT}
                        </div>
                    </div>
                )}
            </div>

            {/* MAIN CONTENT CENTER */}
            <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-6 pt-24">

                {/* 1. SETUP SECTION (Only if not linked) */}
                {!youtubeChannel && (
                    <div className="p-8 border border-white/10 bg-zinc-900/50 rounded-2xl backdrop-blur-sm max-w-md w-full text-center space-y-6 animate-in slide-in-from-bottom-10 fade-in duration-500">
                        <div className="w-16 h-16 bg-zinc-800 rounded-full mx-auto flex items-center justify-center border border-white/5">
                            <span className="text-2xl">🔗</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold mb-2">Connect Studio</h2>
                            <p className="text-zinc-400 text-sm">Link your YouTube channel to enable the Broadcast Agent.</p>
                        </div>
                        <button
                            onClick={handleLinkYouTube}
                            className="px-6 py-3 bg-white text-black font-bold rounded-lg hover:bg-zinc-200 transition-all flex items-center gap-2 mx-auto"
                        >
                            <span className="w-2 h-2 bg-red-600 rounded-full" />
                            LINK YOUTUBE CHANNEL
                        </button>
                        {error && <div className="text-red-400 text-xs bg-red-900/20 p-3 rounded">{error}</div>}
                    </div>
                )}

                {/* 2. AUDIO ENGAGEMENT (Browser Autoplay Policy) */}
                {youtubeChannel && !isAudioUnlocked && (
                    <div className="p-12 border border-white/10 bg-zinc-900/50 rounded-2xl backdrop-blur-sm max-w-md w-full text-center space-y-8 animate-in zoom-in-95 duration-500 shadow-[0_0_50px_rgba(220,38,38,0.1)]">
                        <div className="w-20 h-20 bg-red-600/20 rounded-full mx-auto flex items-center justify-center border border-red-500/30 animate-pulse">
                            <span className="text-3xl">📡</span>
                        </div>
                        <div>
                            <h2 className="text-2xl font-black mb-2 tracking-tighter">WAKE UP AGENT</h2>
                            <p className="text-zinc-400 text-sm leading-relaxed">
                                Browser safety requires one click to enable the high-quality recording engine.
                            </p>
                        </div>
                        <button
                            onClick={() => { }} // Unlocked via global listener
                            className="w-full py-4 bg-white text-black font-black rounded-xl hover:bg-zinc-200 transition-all tracking-[0.2em] shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                        >
                            ENGAGE AUTOMATION
                        </button>
                    </div>
                )}

            {/* 3. AUTOMATION STATUS (Main View) */}
            {/* 3. AUTOMATION STATUS (Main View) */}
                {youtubeChannel && isAudioUnlocked && (
                    <div className="relative w-full max-w-4xl aspect-video bg-black/50 border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center justify-center animate-in zoom-in-95 duration-500">
                        {/* LIVE CANVAS RENDERER */}
                        <canvas 
                            ref={canvasRef}
                            width={3840}
                            height={2160}
                            className="absolute inset-0 w-full h-full object-contain z-0 bg-black"
                        />

                        {/* Status Overlay */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center space-y-8 z-20 pointer-events-none">

                            {/* RECORDED VIDEO PREVIEW */}
                            {recordedBlob && !isRecording && !isPlaying && (
                                <div className="absolute inset-0 z-30 bg-black flex flex-col pointer-events-auto">
                                    <video 
                                        src={URL.createObjectURL(recordedBlob)} 
                                        controls 
                                        className="w-full h-full object-contain"
                                    />
                                    {/* Overlay Controls for Video */}
                                    <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/90 to-transparent flex justify-between items-center">
                                        <div className="text-left">
                                            <div className="text-white font-bold text-sm">BROADCAST RECORDING</div>
                                            <div className="text-zinc-400 text-xs">{(recordedBlob.size / 1024 / 1024).toFixed(2)} MB</div>
                                        </div>
                                        {uploadErrorDetail && (
                                            <div className="flex items-center gap-4">
                                                <span className="text-red-400 text-xs font-mono">{uploadErrorDetail.substring(0, 40)}...</span>
                                                <button 
                                                    onClick={() => {
                                                        const a = document.createElement('a');
                                                        a.href = URL.createObjectURL(recordedBlob);
                                                        a.download = `broadcast_${new Date().toISOString().slice(0,10)}.webm`;
                                                        document.body.appendChild(a);
                                                        a.click();
                                                        document.body.removeChild(a);
                                                    }}
                                                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold rounded uppercase tracking-wider transition-colors border border-white/10"
                                                >
                                                    Download
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        setUploadErrorDetail(null);
                                                        setLoadingMsg("Retrying Upload...");
                                                        isUploadingRef.current = false; // Reset guard
                                                        finalizeUploadRef.current(recordedBlob);
                                                    }}
                                                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded uppercase tracking-wider transition-colors"
                                                >
                                                    Retry Upload
                                                </button>
                                            </div>
                                        )}
                                         {!uploadErrorDetail && loadingMsg.includes("COMPLETE") && (
                                            <div className="px-3 py-1 bg-green-900/50 border border-green-500/30 text-green-400 text-xs rounded-full">
                                                UPLOAD SUCCESSFUL
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ERROR DISPLAY */}
                            {error && !recordedBlob && (
                                <div className="max-w-xl bg-red-950/90 border border-red-500/50 p-6 rounded-xl backdrop-blur-xl pointer-events-auto">
                                    <div className="text-red-400 font-mono text-sm mb-2">CRITICAL ALERT</div>
                                    <div className="text-white font-bold">{error}</div>
                                </div>
                            )}

                            {/* LOADING/STATUS */}
                            {!error && loadingMsg && !recordedBlob && (
                                isPlaying ? (
                                    /* MINIMAL LIVE BADGE (When showing canvas) */
                                    <div className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1 bg-red-600/90 text-white rounded-full text-xs font-bold shadow-[0_0_15px_rgba(220,38,38,0.6)] animate-pulse">
                                        <span className="w-2 h-2 bg-white rounded-full" />
                                        <span>LIVE</span>
                                    </div>
                                ) : (
                                    /* FULL SCREEN LOADER (When generating) */
                                    <div className="space-y-4 animate-in fade-in zoom-in duration-500 bg-black/40 p-8 rounded-2xl backdrop-blur-sm">
                                        <div className="inline-flex items-center gap-3 px-4 py-1.5 bg-zinc-900/80 rounded-full border border-white/10">
                                            <span className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
                                            <span className="text-xs font-mono tracking-widest text-zinc-300">SYSTEM PROCESSING</span>
                                        </div>
                                        <h2 className="text-4xl md:text-5xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-500 drop-shadow-2xl">
                                            {loadingMsg}
                                        </h2>
                                    </div>
                                )
                            )}

                            {/* IDLE STATE */}
                            {!error && !loadingMsg && !isGeneratingRef.current && !recordedBlob && (
                                <div className="space-y-4">
                                    <div className="animate-spin w-8 h-8 border-2 border-white/20 border-t-white rounded-full mx-auto" />
                                    <p className="text-zinc-500 font-mono text-sm">SYSTEM STANDBY - WAITING FOR SCHEDULE...</p>
                                    <div className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.5em]">
                                        Next Show In: {60}s
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Scanlines Effect */}
                        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10 bg-[length:100%_2px,3px_100%]" />
                    </div>
                )}
            </div>

            {/* TICKER footer */}
            <div className="fixed bottom-0 left-0 w-full bg-black border-t border-white/10 py-1 overflow-hidden z-50">
                <div className="whitespace-nowrap animate-[marquee_20s_linear_infinite] text-xs font-mono text-zinc-500">
                    {tickerMsg}  +++  BROADCAST_AGENT_V4.0_ONLINE  +++  AUTOMATION_LEVEL_MAX  +++  ZERO_TOUCH_PROTOCOL_ACTIVE  +++
                </div>
            </div>

            {/* INVISIBLE PRELOAD (Audio Only - Canvas moved) */}
            <div style={{ display: 'none' }}>
                <audio
                    ref={audioRef}
                    crossOrigin="anonymous"
                    src={content?.audioBlobUrl}
                    onEnded={() => {
                        console.log("AUDIO ENDED - STOPPING RECORDER");
                        setIsPlaying(false);
                        setActiveSegment(0);
                        activeSegmentRef.current = 0;
                        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                            mediaRecorderRef.current.stop();
                            mediaRecorderRef.current.stream.getVideoTracks().forEach(t => t.stop());
                        } else {
                            const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                            finalizeUploadRef.current(blob);
                        }
                    }}
                />
            </div>
        </div>
    );
};

export default App;
