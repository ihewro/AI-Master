import React, { useEffect, useRef, useState, useCallback } from 'react';
import { InterviewConfig, ChatMessage, InterviewerMindset } from '../types';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decode, decodeAudioData, blobToBase64 } from '../services/audioUtils';
import { mindsetToolDeclaration } from '../services/geminiService';
import { Mic, MicOff, PhoneOff, Send, BrainCircuit, Activity, Wifi, WifiOff, RefreshCw, AlertCircle, Loader2, Lightbulb, CheckCircle2, User, Sparkles, ArrowRight, BookOpen, Quote } from 'lucide-react';

interface LiveSessionProps {
  config: InterviewConfig;
  onEnd: () => void;
}

type SessionStatus = 'listening' | 'thinking' | 'speaking';
type ConnectionStatus = 'initializing' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const LiveSession: React.FC<LiveSessionProps> = ({ config, onEnd }) => {
  // Connection & Session State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('initializing');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('listening');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const [isMicOn, setIsMicOn] = useState(true);
  const isMicOnRef = useRef(true); // Ref to track mic state inside callbacks
  
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const [audioVolume, setAudioVolume] = useState(0);
  
  // Mindset State
  const [mindset, setMindset] = useState<InterviewerMindset>({
    mood: 'Neutral',
    internal_thought: '正在准备面试环境...',
  });
  
  // Steering State
  const [steeringInput, setSteeringInput] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const avatarImgRef = useRef<HTMLImageElement>(null);
  
  // Refs for resources
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null); // Analyzes AI Voice
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const frameIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeSessionRef = useRef<any>(null);

  // Transcription tracking
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  const cleanupResources = () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (activeSessionRef.current) {
          activeSessionRef.current.close();
          activeSessionRef.current = null;
      }
  };

  const connectToGemini = useCallback(async (isRetry = false) => {
    if (!process.env.API_KEY) {
        setConnectionStatus('error');
        setErrorDetails("API Key 未配置");
        return;
    }

    if (activeSessionRef.current) {
        activeSessionRef.current.close();
    }

    setConnectionStatus(isRetry ? 'reconnecting' : 'connecting');
    setErrorDetails(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // 1. Setup Audio Contexts
      if (!inputAudioContextRef.current) {
          inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioContextRef.current) {
          outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      // Setup Analyser for AI Voice Visualization
      if (!outputAnalyserRef.current && outputAudioContextRef.current) {
          outputAnalyserRef.current = outputAudioContextRef.current.createAnalyser();
          outputAnalyserRef.current.fftSize = 32;
          outputAnalyserRef.current.smoothingTimeConstant = 0.8;
      }

      if (inputAudioContextRef.current.state === 'suspended') await inputAudioContextRef.current.resume();
      if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();

      const outputNode = outputAudioContextRef.current.createGain();
      outputNode.connect(outputAudioContextRef.current.destination);

      // 2. Get Media Stream
      if (!streamRef.current) {
          streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      }
      
      if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
      }

      // 3. Prepare Instruction
      let finalSystemInstruction = config.systemInstruction;
      if (isRetry && chatHistoryRef.current.length > 0) {
          const transcript = chatHistoryRef.current.filter(m => m.role === 'user' || m.role === 'model').slice(-20).map(msg => 
              `${msg.role === 'user' ? 'Candidate' : 'Interviewer'}: ${msg.text}`
          ).join('\n');
          finalSystemInstruction += `\n\n[SYSTEM: CONNECTION RESTORED] Resume the interview. Transcript:\n${transcript}`;
      }

      // 4. Connect
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: finalSystemInstruction,
          tools: [{ functionDeclarations: [mindsetToolDeclaration] }], 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setConnectionStatus('connected');
            setSessionStatus('listening');
            
            if (!isRetry) {
                setMindset(prev => ({ ...prev, internal_thought: '正在启动面试流程...' }));
                // Send hidden text to trigger proactive start
                sessionPromise.then(session => {
                   // Some SDK versions support sending text content directly for context
                   // If strictly unsupported, we rely on the system instruction "Speak First" rule.
                   // Here we try to send a dummy input if needed, but usually the prompt is enough.
                });
            } else {
                setMindset(prev => ({ ...prev, internal_thought: '连接恢复，继续面试...' }));
            }
            
            // Audio Input
            const source = inputAudioContextRef.current!.createMediaStreamSource(streamRef.current!);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              if (!isMicOnRef.current) return; // Use Ref to check current mic state
              
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((acc, val) => acc + Math.abs(val), 0) / inputData.length;
              setAudioVolume(Math.min(volume * 500, 100)); 
              
              if (volume > 0.01 && sessionStatus !== 'speaking') {
                 setSessionStatus('listening');
              }

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
              }).catch(() => {});
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);

            startLoops(sessionPromise);
          },
          onmessage: async (message: LiveServerMessage) => {
            // 1. Tool Calls (Mindset + Coaching)
            if (message.toolCall) {
              const calls = message.toolCall.functionCalls;
              for (const call of calls) {
                  if (call.name === 'update_mindset') {
                      const newMindset = call.args as unknown as InterviewerMindset;
                      setMindset(newMindset);
                      
                      // Inject Coaching Messages into Chat
                      setChatHistory(prev => {
                          const newHistory = [...prev];
                          
                          // Feedback on previous answer
                          if (newMindset.last_answer_feedback && newMindset.last_answer_feedback.advice) {
                              newHistory.push({
                                  role: 'coach-feedback',
                                  text: newMindset.last_answer_feedback.advice,
                                  timestamp: Date.now(),
                                  metadata: {
                                      score: newMindset.last_answer_feedback.score,
                                      refined_answer: newMindset.last_answer_feedback.refined_response
                                  }
                              });
                          }

                          // Standard Reference Answer for CURRENT Question
                          if (newMindset.reference_answer_for_question) {
                               newHistory.push({
                                   role: 'coach-reference',
                                   text: newMindset.reference_answer_for_question,
                                   timestamp: Date.now() + 50
                               });
                          }

                          // Hints
                          if (newMindset.suggested_answer_tips) {
                               newHistory.push({
                                  role: 'coach-hint',
                                  text: newMindset.suggested_answer_tips,
                                  timestamp: Date.now() + 100 
                              });
                          }
                          
                          chatHistoryRef.current = newHistory;
                          return newHistory;
                      });

                      sessionPromise.then(session => {
                          session.sendToolResponse({
                              functionResponses: [{
                                  id: call.id,
                                  name: call.name,
                                  response: { result: "ok" } 
                              }]
                          });
                      });
                  }
              }
              return;
            }

            // 2. Text Transcription
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
              setSessionStatus('speaking');
            } else if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
              setSessionStatus('listening');
            }

            if (message.serverContent?.turnComplete) {
              setSessionStatus('listening');
              
              const userText = currentInputTranscription.current;
              const modelText = currentOutputTranscription.current;

              if (userText.trim() || modelText.trim()) {
                  setChatHistory(prev => {
                      const newHistory = [...prev];
                      if (userText.trim()) {
                          newHistory.push({ role: 'user', text: userText, timestamp: Date.now() });
                      }
                      if (modelText.trim()) {
                          newHistory.push({ role: 'model', text: modelText, timestamp: Date.now() });
                      }
                      chatHistoryRef.current = newHistory;
                      return newHistory;
                  });
                  currentInputTranscription.current = '';
                  currentOutputTranscription.current = '';
              }
            }

            // 3. Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              setSessionStatus('speaking');
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                ctx,
                24000,
                1
              );
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              // Connect to Analyser first, then to Output
              if (outputAnalyserRef.current) {
                  source.connect(outputAnalyserRef.current);
                  outputAnalyserRef.current.connect(outputNode);
              } else {
                  source.connect(outputNode);
              }

              source.addEventListener('ended', () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) {
                      setSessionStatus('listening');
                  }
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => source.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              currentOutputTranscription.current = ''; 
              setSessionStatus('listening');
            }
          },
          onclose: (e) => {
              console.log('Session closed', e);
          },
          onerror: (err) => {
              console.error("Live API Error:", err);
              setConnectionStatus('error');
              setErrorDetails("连接中断，请检查网络。");
          }
        }
      });
      
      activeSessionRef.current = await sessionPromise;

    } catch (e) {
      console.error("Failed to start session", e);
      setConnectionStatus('error');
      setErrorDetails(e instanceof Error ? e.message : "初始化失败");
    }
  }, [config]); // Removed isMicOn from deps to prevent reconnection on toggle

  useEffect(() => {
    connectToGemini();
    return () => {
      cleanupResources();
      inputAudioContextRef.current?.close();
      outputAudioContextRef.current?.close();
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, audioVolume]);

  // Animation Loop for Video Streaming and Avatar Visualization
  const startLoops = (sessionPromise: Promise<any>) => {
    const FPS = 1; 
    
    // 1. Video Streaming Loop
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = window.setInterval(() => {
        if (!videoRef.current || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        const targetWidth = 480;
        const videoRatio = videoRef.current.videoWidth / videoRef.current.videoHeight || (16/9);
        const targetHeight = targetWidth / videoRatio;

        canvasRef.current.width = targetWidth;
        canvasRef.current.height = targetHeight;
        ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);

        canvasRef.current.toBlob(async (blob) => {
            if (blob) {
                const base64 = await blobToBase64(blob);
                sessionPromise.then(session => {
                    session.sendRealtimeInput({
                        media: { mimeType: 'image/jpeg', data: base64 }
                    });
                }).catch(() => {});
            }
        }, 'image/jpeg', 0.6);

    }, 1000 / FPS);

    // 2. Avatar Animation Loop (High Frame Rate)
    const updateAvatarAnimation = () => {
        if (outputAnalyserRef.current && avatarImgRef.current) {
            const dataArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
            outputAnalyserRef.current.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for(let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const average = sum / dataArray.length;
            
            const scale = 1 + (average / 255) * 0.08;
            avatarImgRef.current.style.transform = `scale(${scale})`;
        }
        animationFrameRef.current = requestAnimationFrame(updateAvatarAnimation);
    };
    updateAvatarAnimation();
  };

  const toggleMic = () => {
      setIsMicOn(prev => {
          const newState = !prev;
          isMicOnRef.current = newState;
          return newState;
      });
  };

  const handleSteering = async () => {
      if (!steeringInput.trim() || !activeSessionRef.current) return;
      try {
          setChatHistory(prev => [...prev, { role: 'user', text: `(指令) ${steeringInput}`, timestamp: Date.now() }]);
          
          // Send text content to Gemini Context
          // Note: Standard Live API supports receiving Content parts in RealtimeInput
          // If strictly not supported by SDK types, this might need casting, but we attempt standard way.
          activeSessionRef.current.sendRealtimeInput({
              content: {
                  role: 'user',
                  parts: [{ text: `[System Instruction: ${steeringInput}]` }]
              }
          });

          setSteeringInput('');
      } catch (e) { console.error(e); }
  };

  const getMoodEmoji = (mood: string) => {
      switch(mood) {
          case 'Impressed': return '🤩';
          case 'Skeptical': return '🤨';
          case 'Strict': return '😠';
          case 'Encouraging': return '🤗';
          case 'Disappointed': return '😞';
          default: return '😐';
      }
  };

  const getMoodStyles = (mood: string): React.CSSProperties => {
      let filter = 'contrast(100%) saturate(100%) brightness(100%)';
      let borderColor = 'rgba(255, 255, 255, 0.8)';

      switch(mood) {
          case 'Strict': 
              filter = 'contrast(115%) saturate(80%) brightness(95%) sepia(10%)';
              borderColor = '#64748b'; 
              break;
          case 'Encouraging':
              filter = 'contrast(95%) saturate(110%) brightness(105%) sepia(5%)';
              borderColor = '#f59e0b'; 
              break;
          case 'Skeptical':
              filter = 'contrast(110%) saturate(90%) brightness(98%)';
              borderColor = '#a855f7'; 
              break;
          case 'Impressed':
              filter = 'contrast(105%) saturate(120%) brightness(108%)';
              borderColor = '#10b981'; 
              break;
          case 'Disappointed':
              filter = 'contrast(90%) saturate(60%) brightness(90%) grayscale(20%)';
              borderColor = '#ef4444'; 
              break;
      }
      return { filter, borderColor, transition: 'filter 0.5s ease, border-color 0.5s ease' };
  };

  return (
    <div className="flex h-screen w-full relative overflow-hidden text-slate-800 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      
      {/* CONNECTION ERROR OVERLAY */}
      {connectionStatus === 'error' && (
          <div className="absolute inset-0 z-[60] bg-white/80 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-fade-in">
              <div className="bg-white border border-red-200 p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-md text-center">
                  <WifiOff className="w-16 h-16 text-red-500 mb-4" />
                  <h3 className="text-2xl font-bold mb-2 text-slate-800">连接断开</h3>
                  <p className="text-slate-500 mb-6">{errorDetails}</p>
                  <div className="flex gap-4">
                      <button onClick={onEnd} className="px-6 py-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors font-medium">退出</button>
                      <button onClick={() => connectToGemini(true)} className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors font-bold flex items-center gap-2">
                          <RefreshCw className="w-4 h-4" /> 重试
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MAIN CONTENT GRID */}
      <div className="flex flex-col md:flex-row w-full h-full">
        
        {/* LEFT: VISUALS */}
        <div className="w-full md:w-[55%] h-full flex flex-col p-6 gap-6">
             {/* AI AVATAR */}
             <div className="relative flex-1 flex items-center justify-center">
                 <div className={`relative w-full h-full rounded-3xl overflow-hidden border-[3px] transition-all duration-500 shadow-lg bg-white/20 backdrop-blur-sm`}
                      style={{ borderColor: getMoodStyles(mindset.mood).borderColor }}>
                    
                    {config.avatarUrl && (
                        <img 
                            ref={avatarImgRef}
                            src={config.avatarUrl} 
                            className="w-full h-full object-cover origin-bottom" 
                            style={{ 
                                filter: getMoodStyles(mindset.mood).filter,
                                animation: sessionStatus !== 'speaking' ? 'breathing 6s ease-in-out infinite' : 'none'
                            }}
                            alt="AI" 
                        />
                    )}
                    
                    {/* Mindset HUD */}
                    <div className="absolute top-6 left-6 z-20 flex flex-col gap-3 max-w-[80%]">
                        <div className="self-start flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-md">
                            <span className="text-2xl animate-bounce">{getMoodEmoji(mindset.mood)}</span>
                            <span className="text-sm font-medium text-white/90">{mindset.mood}</span>
                        </div>
                        
                        {mindset.internal_thought && (
                            <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl rounded-tl-none border border-slate-200 text-slate-700 text-sm leading-relaxed shadow-lg animate-in slide-in-from-left-4 fade-in duration-500 max-w-md">
                                <div className="flex items-center gap-2 mb-1 text-purple-600 text-xs font-bold uppercase tracking-wider">
                                    <BrainCircuit className="w-3 h-3" /> 潜台词
                                </div>
                                "{mindset.internal_thought}"
                            </div>
                        )}
                    </div>
                 </div>
             </div>

             {/* USER CAMERA */}
             <div className={`h-[240px] bg-black rounded-3xl overflow-hidden relative border-[3px] shadow-xl transition-colors duration-300 ${
                 sessionStatus === 'listening' ? 'border-emerald-400 shadow-emerald-100' : 'border-white'
             }`}>
                 <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                 
                 <div className="absolute bottom-4 right-4 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                     <div className={`w-2 h-2 rounded-full ${isMicOn ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}></div>
                     <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
                         <div className="h-full bg-emerald-400 transition-all duration-100" style={{ width: `${audioVolume}%` }}></div>
                     </div>
                 </div>
                 <canvas ref={canvasRef} className="hidden" />
             </div>
        </div>

        {/* RIGHT: INTERACTION */}
        <div className="w-full md:w-[45%] h-full flex flex-col glass border-l border-white/40 shadow-2xl">
            
            {/* STATUS HEADER (NEW) */}
            <div className="px-6 py-4 border-b border-slate-100 bg-white/50 backdrop-blur-sm flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-2 text-slate-600">
                    <div className="p-1.5 bg-slate-100 rounded-lg">
                        <Activity className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-sm">面试进程</span>
                </div>
                
                <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border transition-all duration-300 ${
                    sessionStatus === 'speaking' 
                    ? 'bg-blue-100 text-blue-700 border-blue-200'
                    : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}>
                    {sessionStatus === 'speaking' ? (
                        <>
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span>面试官正在提问</span>
                        </>
                    ) : (
                        <>
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                            <span>请用户回答</span>
                        </>
                    )}
                </div>
            </div>

            {/* Chat List */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
                {/* Intro Message */}
                <div className="text-center py-4 text-slate-400 text-xs uppercase tracking-widest font-medium">全程录音中</div>

                {chatHistory.map((msg, idx) => {
                    // RENDER: COACH REFERENCE ANSWER (BLUE CARD)
                    if (msg.role === 'coach-reference') {
                        return (
                            <div key={idx} className="mx-4 bg-blue-50/90 border border-blue-200 rounded-xl p-5 shadow-sm animate-in slide-in-from-right-4 duration-500">
                                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-blue-200/60">
                                    <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                                        <BookOpen className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-bold text-blue-800 tracking-wide">本题参考回答范例</span>
                                </div>
                                <div className="relative pl-4 border-l-2 border-blue-300">
                                    <Quote className="absolute -top-1 -left-6 w-4 h-4 text-blue-300 rotate-180" />
                                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">{msg.text}</p>
                                </div>
                            </div>
                        );
                    }

                    // RENDER: COACH FEEDBACK CARD (GREEN CARD)
                    if (msg.role === 'coach-feedback') {
                        return (
                            <div key={idx} className="mx-4 bg-emerald-50/90 border border-emerald-200 rounded-xl p-5 shadow-sm animate-in zoom-in-95 duration-500 group hover:border-emerald-300 transition-colors">
                                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-emerald-200/60">
                                    <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
                                        <Sparkles className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-bold text-emerald-800 tracking-wide">AI 面试助手点评</span>
                                    {msg.metadata?.score && (
                                        <span className="ml-auto text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200">
                                            表现评分: {msg.metadata.score}
                                        </span>
                                    )}
                                </div>
                                
                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        <div className="mt-0.5 p-1 bg-emerald-100 rounded-full h-fit">
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                        </div>
                                        <div>
                                            <span className="text-xs font-bold text-emerald-700 block mb-1">评价与建议</span>
                                            <p className="text-sm text-slate-700 leading-relaxed">{msg.text}</p>
                                        </div>
                                    </div>

                                    {msg.metadata?.refined_answer && (
                                        <div className="bg-white/60 rounded-xl p-4 border border-emerald-100 relative overflow-hidden">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Lightbulb className="w-3.5 h-3.5 text-yellow-500" />
                                                <span className="text-xs font-bold text-emerald-700">优化你的回答 (基于你的内容)</span>
                                            </div>
                                            <p className="text-sm text-slate-600 italic leading-relaxed">
                                                "{msg.metadata.refined_answer}"
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    // RENDER: COACH HINT CARD (YELLOW)
                    if (msg.role === 'coach-hint') {
                        return (
                            <div key={idx} className="mx-4 bg-amber-50/90 border border-amber-200 rounded-xl p-4 shadow-sm animate-in slide-in-from-right-4 duration-500">
                                <div className="flex items-center gap-2 mb-2 text-amber-700">
                                    <div className="p-1 bg-amber-100 rounded">
                                        <Lightbulb className="w-3.5 h-3.5" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">小提示</span>
                                </div>
                                <p className="text-sm text-slate-700">{msg.text}</p>
                            </div>
                        );
                    }

                    // RENDER: STANDARD MESSAGES
                    return (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'model' && (
                                <div className="w-9 h-9 rounded-full overflow-hidden mr-3 border border-slate-200 shadow-sm flex-shrink-0 bg-white">
                                    <img src={config.avatarUrl || ''} className="w-full h-full object-cover" />
                                </div>
                            )}
                            <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                msg.role === 'user' 
                                ? 'bg-purple-600 text-white rounded-tr-none shadow-md' 
                                : 'bg-white text-slate-700 rounded-tl-none border border-slate-100'
                            }`}>
                                {msg.text}
                            </div>
                            {msg.role === 'user' && (
                                <div className="w-9 h-9 rounded-full bg-purple-100 ml-3 flex items-center justify-center border border-purple-200 flex-shrink-0">
                                    <User className="w-5 h-5 text-purple-600" />
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Live Transcription Ghost Text */}
                {(currentInputTranscription.current || currentOutputTranscription.current) && (
                    <div className="space-y-2 px-4 opacity-60">
                        {currentOutputTranscription.current && (
                             <div className="flex gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse"></div>
                                <p className="text-sm text-slate-500">{currentOutputTranscription.current}...</p>
                             </div>
                        )}
                        {currentInputTranscription.current && (
                             <div className="flex justify-end gap-3">
                                <p className="text-sm text-purple-500">{currentInputTranscription.current}...</p>
                                <div className="w-8 h-8 rounded-full bg-purple-100 animate-pulse"></div>
                             </div>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom Controls (Steering + Mic) */}
            <div className="p-4 bg-white/60 backdrop-blur-xl border-t border-white/40 space-y-4">
                {/* Director Input */}
                <div className="relative">
                    <input 
                        type="text" 
                        value={steeringInput}
                        onChange={(e) => setSteeringInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSteering()}
                        placeholder="给面试官发送指令 (如: 换个话题, 增加压力)..."
                        className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-12 py-3 text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all shadow-sm"
                    />
                    <button 
                        onClick={handleSteering}
                        disabled={!steeringInput.trim()}
                        className="absolute right-2 top-2 p-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-white disabled:opacity-50 transition-colors shadow-sm"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>

                {/* Main Actions */}
                <div className="flex items-center justify-between">
                    <button onClick={onEnd} className="flex items-center gap-2 text-slate-500 hover:text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-all text-sm font-medium">
                        <PhoneOff className="w-4 h-4" /> 结束
                    </button>

                    <button 
                        onClick={toggleMic}
                        className={`p-4 rounded-full shadow-lg transition-all transform hover:scale-105 ring-4 ring-white/50 ${
                            isMicOn ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-red-500 text-white hover:bg-red-400'
                        }`}
                    >
                        {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                    </button>

                    <div className="w-[80px]"></div> {/* Spacer for alignment */}
                </div>
            </div>
        </div>
      </div>
      
      <style>{`
          @keyframes breathing {
              0% { transform: scale(1); }
              50% { transform: scale(1.03); }
              100% { transform: scale(1); }
          }
      `}</style>
    </div>
  );
};

export default LiveSession;