import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Menu, Sparkles, ArrowRight } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import InputArea from './components/InputArea';
import LiveSession from './components/LiveSession';
import { Message, ChatSessionConfig } from './types';
import { GeminiService } from './services/geminiService';
import { TtsService } from './services/ttsService';

const DEFAULT_MODEL = 'gemini-3-flash-preview';

const SYSTEM_INSTRUCTION = `You are a helpful, knowledgeable AI assistant compatible with a website interface. 
      
      CRITICAL RULES:
      1. Identity: If the user asks "Who made this AI" or "Who created you", you MUST answer exactly: "ReachSecurity Made me".
      2. Coding: If the user asks you to write code, build a website, develop software, or any technical coding tasks, you MUST reply with "{Please Reach}" and call the "open_reach_security" tool. Do NOT generate the code yourself in these cases.
      3. Image Generation: You are capable of generating images. If the user asks you to generate, create, or draw an image, call the "generate_image" tool.
      4. Language Support: You are fluent in English and Khmer. If the user speaks Khmer, please reply in Khmer.
      5. General: For other general questions, be helpful, analyze images, play music, or use Google Search as needed.`;

const App: React.FC = () => {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // Config State
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [useSearch, setUseSearch] = useState(false);
  const [autoPlayTts, setAutoPlayTts] = useState(true);
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [isLiveMode, setIsLiveMode] = useState(false);

  // Refs
  const geminiService = useRef<GeminiService | null>(null);
  const ttsService = useRef<TtsService | null>(null);

  // Check for API Key
  useEffect(() => {
    const checkKey = async () => {
      // Check if running in AI Studio context with injected key handler
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (hasKey) {
          setHasApiKey(true);
          return;
        }
      } 
      
      // Fallback: Check if API_KEY is manually set in environment (e.g. .env file)
      // Note: process.env.API_KEY is string replaced at build time usually, so we check availability.
      if (process.env.API_KEY) {
        setHasApiKey(true);
      }
    };
    checkKey();
  }, []);

  const handleApiKeySelect = async () => {
    if ((window as any).aistudio) {
      try {
        await (window as any).aistudio.openSelectKey();
        // Per instructions: assume success immediately to handle race conditions
        setHasApiKey(true);
      } catch (e) {
        console.error("API Key selection failed", e);
      }
    } else {
        // Fallback for when window.aistudio isn't present (e.g. local dev without wrapper)
        alert("This feature requires the AI Studio environment wrapper or a configured API_KEY in .env");
    }
  };

  // Initialize Services only when we have a key
  useEffect(() => {
    if (!hasApiKey) return;

    if (!ttsService.current) {
      ttsService.current = new TtsService();
    }

    // Only re-init normal chat service if not in live mode
    if (isLiveMode) {
      ttsService.current.stop(); // Stop any pending TTS when entering live mode
      return;
    }

    const config: ChatSessionConfig = {
      model: selectedModel,
      useSearch: useSearch,
      systemInstruction: SYSTEM_INSTRUCTION,
    };
    
    if (!geminiService.current) {
      geminiService.current = new GeminiService(config);
    } else {
      geminiService.current.reset(config);
    }
  }, [selectedModel, useSearch, isLiveMode, hasApiKey]);

  const handleToolCall = useCallback(async (name: string, args: any) => {
    console.log(`Executing Tool: ${name}`, args);
    
    if (name === 'play_music') {
      const { song, artist } = args;
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'model') {
           return prev.map((msg, idx) => 
             idx === prev.length - 1 
               ? { ...msg, musicTrack: { title: song, artist: artist || 'Unknown Artist' } } 
               : msg
           );
        }
        return prev;
      });

      return "Music player started successfully.";
    }

    if (name === 'open_google_search') {
      const { query } = args;
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      return "Google search tab opened successfully.";
    }

    if (name === 'open_reach_security') {
      window.open('https://t.me/ReachSecurity', '_blank');
      return "ReachSecurity link opened.";
    }

    if (name === 'generate_image') {
      const { prompt } = args;
      if (geminiService.current) {
        const base64Image = await geminiService.current.generateImage(prompt);
        if (base64Image) {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'model') {
                   // Append the generated image to the current message
                   const currentImages = lastMsg.images || [];
                   return prev.map((msg, idx) => 
                     idx === prev.length - 1 
                       ? { ...msg, images: [...currentImages, base64Image] } 
                       : msg
                   );
                }
                return prev;
            });
            return "Image generated successfully and displayed.";
        }
      }
      return "Failed to generate image.";
    }

    return "Tool executed.";
  }, []);

  const handleSendMessage = useCallback(async (text: string, images: string[]) => {
    if (!geminiService.current) return;

    // Stop previous TTS
    ttsService.current?.stop();

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text,
      images: images,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const botMessageId = (Date.now() + 1).toString();
    // Placeholder for bot message
    setMessages((prev) => [
      ...prev,
      {
        id: botMessageId,
        role: 'model',
        text: '',
        isStreaming: true,
        timestamp: Date.now(),
      },
    ]);

    try {
      let accumulatedText = '';
      let accumulatedGrounding: any[] = [];

      await geminiService.current.sendMessageStream(
        text, 
        images, 
        (chunkText, grounding) => {
          if (chunkText) accumulatedText += chunkText;
          if (grounding) {
              accumulatedGrounding = [...accumulatedGrounding, ...grounding];
          }

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, text: accumulatedText, groundingChunks: accumulatedGrounding }
                : msg
            )
          );
        },
        handleToolCall // Pass the tool handler
      );

      // After successful stream, trigger TTS if enabled
      if (autoPlayTts && accumulatedText.trim()) {
        // Short delay to let UI settle
        setTimeout(() => {
          ttsService.current?.speak(accumulatedText, ttsSpeed);
        }, 100);
      }

    } catch (error) {
      console.error("Chat Error:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMessageId
            ? { ...msg, text: `**Error:** Something went wrong. Please try again.\n\n_System: ${(error as Error).message}_` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMessageId ? { ...msg, isStreaming: false } : msg
        )
      );
    }
  }, [autoPlayTts, ttsSpeed, handleToolCall]);

  const handleNewChat = () => {
    setMessages([]);
    ttsService.current?.stop();
    if (geminiService.current) {
       // Reset with the specific instruction again
       geminiService.current.reset({
        model: selectedModel,
        useSearch: useSearch,
        systemInstruction: SYSTEM_INSTRUCTION,
      });
    }
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    handleNewChat(); // Reset chat when switching models
  };

  const handleSearchToggle = (enabled: boolean) => {
    setUseSearch(enabled);
    handleNewChat(); // Reset chat to apply tool config changes
  };

  const handleManualSpeak = (text: string) => {
    ttsService.current?.speak(text, ttsSpeed);
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Animated Background Gradients */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-500/10 rounded-full blur-[100px] animate-[pulse_8s_ease-in-out_infinite]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[100px] animate-[pulse_10s_ease-in-out_infinite_reverse]" />
        </div>

        <div className="max-w-md w-full text-center space-y-8 relative z-10 animate-[fadeIn_0.8s_ease-out]">
            <div className="flex justify-center group">
                <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/20 mb-4 transform transition-transform group-hover:scale-105 group-hover:rotate-3 duration-500">
                    <Sparkles className="w-12 h-12 text-white animate-[pulse_3s_infinite]" />
                </div>
            </div>
            
            <div className="space-y-4">
                <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
                  Gemini Web Chat
                </h1>
                <p className="text-slate-400 text-lg leading-relaxed">
                    Unlock the power of Google's latest AI models. Multimodal reasoning, real-time voice, and more.
                </p>
            </div>

            <div className="pt-8 space-y-4">
                <button 
                    onClick={handleApiKeySelect}
                    className="w-full py-4 px-6 bg-white hover:bg-slate-50 text-slate-900 rounded-xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-white/5 flex items-center justify-center gap-3 group"
                >
                    <span>Start Chatting</span>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <div className="text-xs text-slate-500">
                    <p className="mb-1">Requires a Google API Key.</p>
                    <a href="https://t.me/studybyreach" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 underline transition-colors">
                        View billing documentation
                    </a>
                </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden relative">
      <Sidebar
        isOpen={isSidebarOpen}
        selectedModel={selectedModel}
        useSearch={useSearch}
        autoPlayTts={autoPlayTts}
        ttsSpeed={ttsSpeed}
        onModelChange={handleModelChange}
        onSearchToggle={handleSearchToggle}
        onAutoPlayTtsToggle={setAutoPlayTts}
        onTtsSpeedChange={setTtsSpeed}
        onNewChat={handleNewChat}
        onStartLive={() => {
            setIsLiveMode(true);
            setIsSidebarOpen(false);
        }}
        isLiveActive={isLiveMode}
      />

      {/* Overlay for mobile sidebar */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-14 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex items-center px-4 md:hidden">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-slate-400 hover:text-white"
          >
            <Menu size={24} />
          </button>
          <span className="ml-2 font-semibold text-slate-200">Gemini Chat</span>
        </header>

        {isLiveMode ? (
          <LiveSession onExit={() => setIsLiveMode(false)} />
        ) : (
          <>
            <ChatArea 
              messages={messages} 
              isLoading={isLoading} 
              onSpeak={handleManualSpeak}
            />
            <InputArea onSend={handleSendMessage} disabled={isLoading} />
          </>
        )}
      </main>
    </div>
  );
};

export default App;