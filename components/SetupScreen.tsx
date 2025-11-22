import React, { useState } from 'react';
import { InterviewTemplate, InterviewConfig, VoiceOption } from '../types';
import { TEMPLATES, VOICE_OPTIONS, DEFAULT_AVATAR } from '../constants';
import { generateInterviewerPersona, generateAvatarImage } from '../services/geminiService';
import { ArrowRight, Loader2, Camera, User, Mic } from 'lucide-react';

interface SetupScreenProps {
  onStart: (config: InterviewConfig) => void;
}

const SetupScreen: React.FC<SetupScreenProps> = ({ onStart }) => {
  const [selectedTemplate, setSelectedTemplate] = useState<InterviewTemplate>(TEMPLATES[0]);
  const [context, setContext] = useState(TEMPLATES[0].defaultPrompt);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>(VOICE_OPTIONS[0]);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  
  // Changed from boolean to string | null to support detailed status messages
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);

  const handleTemplateChange = (t: InterviewTemplate) => {
    setSelectedTemplate(t);
    setContext(t.defaultPrompt);
  };

  const handleGenerateAvatar = async () => {
    setIsGeneratingAvatar(true);
    const desc = `${selectedTemplate.title} interviewer, professional look, severe but fair expression`;
    const url = await generateAvatarImage(desc);
    if (url) setAvatarUrl(url);
    setIsGeneratingAvatar(false);
  };

  const handleStart = async () => {
    try {
      setLoadingStatus("正在构建面试官人格...");
      const systemInstruction = await generateInterviewerPersona(selectedTemplate.title, context);
      
      if (!avatarUrl) {
        setLoadingStatus("正在生成面试官形象...");
        const desc = `${selectedTemplate.title} interviewer, professional look`;
        // Auto-generate avatar if not present, but don't block if it fails
        generateAvatarImage(desc).then(url => { if(url) setAvatarUrl(url) });
      }

      setLoadingStatus("正在初始化 Live API 连接...");
      // Simulate a small delay for UX so user reads the status
      await new Promise(resolve => setTimeout(resolve, 800));

      onStart({
        templateId: selectedTemplate.id,
        context,
        avatarUrl: avatarUrl || DEFAULT_AVATAR,
        voiceName: selectedVoice.name,
        systemInstruction
      });
    } catch (e) {
      console.error(e);
      setLoadingStatus(null);
      alert("初始化失败，请重试");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
          AI 模拟面试官
        </h1>
        <p className="text-slate-500 font-medium">
          基于 Gemini Live 原生多模态模型，提供身临其境的真实面试体验
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column: Configuration */}
        <div className="space-y-6 bg-white/70 p-6 rounded-2xl border border-white/60 shadow-xl shadow-blue-900/5 backdrop-blur-md">
          
          {/* Template Selection */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-3">选择面试场景</label>
            <div className="grid grid-cols-1 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateChange(t)}
                  className={`p-3 rounded-xl text-left transition-all duration-200 ${
                    selectedTemplate.id === t.id
                      ? 'bg-blue-50 border-blue-500 border shadow-sm'
                      : 'bg-white border-slate-200 border hover:border-blue-300 hover:shadow-md'
                  }`}
                >
                  <div className={`font-bold ${selectedTemplate.id === t.id ? 'text-blue-700' : 'text-slate-700'}`}>{t.title}</div>
                  <div className="text-xs text-slate-500 mt-1">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* User Context */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-3">
              <User className="inline w-4 h-4 mr-1" /> 你的背景 (供面试官参考)
            </label>
            <textarea
              className="w-full h-32 bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-700 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none shadow-inner"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="输入你的简历摘要或当前工作重点..."
            />
          </div>
        </div>

        {/* Right Column: Appearance & Voice */}
        <div className="space-y-6 bg-white/70 p-6 rounded-2xl border border-white/60 shadow-xl shadow-blue-900/5 backdrop-blur-md flex flex-col justify-between">
          
          {/* Avatar Section */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-3">
              <Camera className="inline w-4 h-4 mr-1" /> 面试官形象
            </label>
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative w-40 h-40 rounded-full overflow-hidden border-4 border-white shadow-2xl bg-slate-100">
                {isGeneratingAvatar ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                    <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                  </div>
                ) : (
                  <img 
                    src={avatarUrl || DEFAULT_AVATAR} 
                    alt="Avatar" 
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <button
                onClick={handleGenerateAvatar}
                disabled={isGeneratingAvatar}
                className="text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 py-2 px-4 rounded-full transition-colors font-medium shadow-sm"
              >
                {avatarUrl ? '重新生成形象' : '生成专属面试官'}
              </button>
            </div>
          </div>

          {/* Voice Selection */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-3">
              <Mic className="inline w-4 h-4 mr-1" /> 面试官音色
            </label>
            <select
              value={selectedVoice.name}
              onChange={(e) => setSelectedVoice(VOICE_OPTIONS.find(v => v.name === e.target.value) || VOICE_OPTIONS[0])}
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-slate-700 outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
            >
              {VOICE_OPTIONS.map(v => (
                <option key={v.name} value={v.name}>{v.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleStart}
            disabled={!!loadingStatus}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-purple-500/20 transform transition hover:scale-[1.02] active:scale-[0.98]"
          >
            {loadingStatus ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{loadingStatus}</span>
              </>
            ) : (
              <>
                <span>开始面试</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SetupScreen;