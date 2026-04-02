/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Download, Settings2, Volume2, Mic2, History, Trash2, Clock, 
  ChevronRight, AlertCircle, HelpCircle, FileAudio, Layers, Sparkles, 
  User, LogOut, CreditCard, Zap, CheckCircle2, Loader2, ArrowRight,
  Menu, X, Sliders, Activity, Cpu, Globe, Headphones
} from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import axios from 'axios';
import { auth, googleProvider, signInWithPopup, signOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

interface ProjectItem {
  id: string;
  name: string;
  date: string;
  downloadUrl: string;
  zipUrl?: string;
}

const MultiVoiceSaaS = () => {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'editor' | 'dashboard' | 'pricing'>('editor');
  const [script, setScript] = useState("[Narrator | google | Zephyr]\nWelcome to the future of voice generation.\n\n[Hero | elevenlabs | pMs6B4M4mR2E6Uf15z2X]\nWith ElevenLabs and Gemini, the possibilities are endless.");
  const [projectName, setProjectName] = useState("Untitled Production");
  const [history, setHistory] = useState<ProjectItem[]>([]);
  const [previewConfig, setPreviewConfig] = useState({
    provider: "google",
    voiceId: "Zephyr",
    text: "This is a quick preview of the selected voice."
  });
  const [audioQuality, setAudioQuality] = useState({
    sampleRate: "24000",
    bitrate: "128"
  });
  const [voiceSettings, setVoiceSettings] = useState({
    speed: 1.0,
    pitch: 0,
    style: "neutral",
    gender: "female" as "male" | "female"
  });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Load history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('multi_tts_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveToHistory = (newEntry: ProjectItem) => {
    const updated = [newEntry, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('multi_tts_history', JSON.stringify(updated));
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('editor');
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setScript(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    if (!previewConfig.text.trim()) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const response = await axios.post('/api/preview', {
        text: previewConfig.text,
        provider: previewConfig.provider,
        voice_id: previewConfig.voiceId,
        quality: audioQuality
      }, { responseType: 'blob' });
      
      const url = URL.createObjectURL(response.data);
      setCurrentAudio(url);
    } catch (err: any) {
      setError("Preview failed. Check your API keys and voice IDs.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`/api/job-status/${jobId}`);
        const { progress, status, result } = res.data;
        
        setProgress(progress);
        setStatus(status);

        if (status === "completed") {
          clearInterval(interval);
          setLoading(false);
          const { projectId, fileName, downloadUrl, zipUrl } = result;
          const newEntry: ProjectItem = {
            id: projectId,
            name: projectName || "Untitled Project",
            date: new Date().toLocaleTimeString(),
            downloadUrl: downloadUrl,
            zipUrl: zipUrl
          };
          saveToHistory(newEntry);
          setCurrentAudio(downloadUrl);
        } else if (status === "failed") {
          clearInterval(interval);
          setLoading(false);
          setError(result.error || "Generation failed.");
        }
      } catch (e) {
        clearInterval(interval);
        setLoading(false);
        setError("Failed to track progress.");
      }
    }, 1500);
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    setLoading(true);
    setProgress(0);
    setStatus("Initiating...");
    setError(null);
    try {
      const response = await axios.post('/api/generate-longform', {
        script,
        project_name: projectName,
        quality: audioQuality,
        settings: voiceSettings
      });
      const { jobId } = response.data;
      pollJobStatus(jobId);
    } catch (err: any) {
      setLoading(false);
      setError(err.response?.data?.error || "Full generation failed.");
    }
  };

  const handleSubscribe = async () => {
    if (!user) return handleLogin();
    try {
      const res = await axios.post('/api/create-checkout-session', { userId: user.uid });
      window.location.href = res.data.url;
    } catch (e) {
      setError("Stripe checkout failed. Ensure STRIPE_SECRET_KEY is set.");
    }
  };

  // Script Visualizer Logic
  const scriptSegments = useMemo(() => {
    return script.split('\n\n').map(block => {
      const match = block.match(/^\[\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\]/);
      if (match) {
        return {
          character: match[1],
          provider: match[2],
          voice: match[3],
          text: block.replace(match[0], '').trim()
        };
      }
      return { text: block };
    });
  }, [script]);

  return (
    <div className="min-h-screen bg-studio-950 text-slate-200 font-sans selection:bg-emerald-500/30 flex flex-col">
      {/* Top Navigation */}
      <header className="h-20 glass sticky top-0 z-50 px-8 flex items-center justify-between border-b border-white/[0.03]">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2.5 hover:bg-white/5 rounded-xl transition-all lg:hidden active:scale-90"
          >
            <Menu size={20} />
          </button>
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4 cursor-pointer group" 
            onClick={() => setView('editor')}
          >
            <div className="bg-emerald-500 p-2 rounded-xl shadow-[0_0_30px_-5px_rgba(16,185,129,0.4)] group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
              <Headphones size={20} className="text-black" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-display font-black text-xl tracking-tighter text-gradient leading-none">OBSIDIAN</h1>
              <span className="text-[9px] font-bold tracking-[0.4em] text-emerald-500/60 uppercase mt-1">Studio Engine</span>
            </div>
          </motion.div>
        </div>

        <div className="flex items-center gap-10">
          <nav className="hidden lg:flex items-center gap-10 text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
            <button onClick={() => setView('editor')} className={`hover:text-emerald-400 transition-all relative py-2 group ${view === 'editor' ? 'text-emerald-400' : ''}`}>
              <span className="relative z-10">Production</span>
              {view === 'editor' && <motion.div layoutId="nav-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />}
              <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 rounded-lg -m-2 transition-colors" />
            </button>
            <button onClick={() => setView('dashboard')} className={`hover:text-emerald-400 transition-all relative py-2 group ${view === 'dashboard' ? 'text-emerald-400' : ''}`}>
              <span className="relative z-10">Assets</span>
              {view === 'dashboard' && <motion.div layoutId="nav-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />}
              <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 rounded-lg -m-2 transition-colors" />
            </button>
            <button onClick={() => setView('pricing')} className={`hover:text-emerald-400 transition-all relative py-2 group ${view === 'pricing' ? 'text-emerald-400' : ''}`}>
              <span className="relative z-10">Licensing</span>
              {view === 'pricing' && <motion.div layoutId="nav-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />}
              <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/5 rounded-lg -m-2 transition-colors" />
            </button>
          </nav>

          <div className="h-5 w-px bg-white/5 hidden lg:block"></div>

          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-[11px] font-bold font-display leading-none mb-1.5">{user.displayName}</p>
                <div className="flex items-center justify-end gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></div>
                  <p className="text-[8px] text-emerald-500/70 font-mono uppercase tracking-[0.2em] leading-none">Studio Pro</p>
                </div>
              </div>
              <div className="relative group">
                <div className="p-0.5 rounded-full bg-gradient-to-br from-emerald-500/20 to-transparent group-hover:from-emerald-500/50 transition-all">
                  <img src={user.photoURL} alt="Avatar" className="w-9 h-9 rounded-full border border-white/10" />
                </div>
                <div className="absolute right-0 top-full mt-3 w-56 glass rounded-2xl shadow-2xl opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all pointer-events-none group-hover:pointer-events-auto p-2 border border-white/[0.05]">
                  <div className="p-3 border-b border-white/5 mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Account</p>
                    <p className="text-xs font-medium truncate">{user.email}</p>
                  </div>
                  <button onClick={() => setView('dashboard')} className="w-full text-left p-2.5 hover:bg-white/5 rounded-xl text-[11px] flex items-center gap-3 transition-colors"><User size={14} className="text-emerald-500"/> Profile Settings</button>
                  <button onClick={handleLogout} className="w-full text-left p-2.5 hover:bg-red-500/10 text-red-400 rounded-xl text-[11px] flex items-center gap-3 transition-colors mt-1"><LogOut size={14}/> Sign Out</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={handleLogin} className="bg-white text-black text-[10px] font-black px-7 py-2.5 rounded-xl hover:bg-emerald-400 transition-all shadow-[0_10px_30px_-10px_rgba(255,255,255,0.2)] active:scale-95 uppercase tracking-widest">
              Sign In
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-grow overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside 
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 150 }}
              className="w-80 glass border-r border-white/[0.03] flex flex-col hidden lg:flex"
            >
              <div className="p-8 space-y-10 overflow-y-auto custom-scrollbar">
                {/* Voice Preview Section */}
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-1.5 h-4 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Voice Lab</h2>
                  </div>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Provider</label>
                      <select 
                        className="w-full bg-studio-800/50 border border-white/[0.05] p-3 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all appearance-none cursor-pointer hover:bg-studio-700/50"
                        value={previewConfig.provider}
                        onChange={(e) => setPreviewConfig({...previewConfig, provider: e.target.value})}
                      >
                        <option value="google">Gemini AI</option>
                        <option value="elevenlabs">ElevenLabs</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Voice ID</label>
                      <input 
                        type="text"
                        className="w-full bg-studio-800/50 border border-white/[0.05] p-3 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all font-mono placeholder:text-slate-800 hover:bg-studio-700/50"
                        placeholder="Voice ID"
                        value={previewConfig.voiceId}
                        onChange={(e) => setPreviewConfig({...previewConfig, voiceId: e.target.value})}
                      />
                    </div>
                    <button 
                      onClick={handlePreview}
                      disabled={previewLoading}
                      className="w-full glass-emerald hover:bg-emerald-500/10 text-emerald-400 font-bold py-3 rounded-xl text-[10px] flex items-center justify-center gap-3 transition-all active:scale-[0.98] glow-emerald uppercase tracking-widest"
                    >
                      {previewLoading ? <Loader2 className="animate-spin" size={14}/> : <><Volume2 size={16}/> Test Frequency</>}
                    </button>
                  </div>
                </motion.section>

                {/* Audio Quality Section */}
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-1.5 h-4 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Audio Quality</h2>
                  </div>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Sample Rate</label>
                      <select 
                        className="w-full bg-studio-800/50 border border-white/[0.05] p-3 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all appearance-none cursor-pointer hover:bg-studio-700/50"
                        value={audioQuality.sampleRate}
                        onChange={(e) => setAudioQuality({...audioQuality, sampleRate: e.target.value})}
                      >
                        <option value="16000">16kHz (Standard)</option>
                        <option value="24000">24kHz (High Def)</option>
                        <option value="48000">48kHz (Studio)</option>
                      </select>
                    </div>
                  </div>
                </motion.section>

                {/* Voice Expression Section */}
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-1.5 h-4 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Voice Expression</h2>
                  </div>
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Gender</label>
                        <select 
                          className="w-full bg-studio-800/50 border border-white/[0.05] p-3 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all appearance-none cursor-pointer hover:bg-studio-700/50"
                          value={voiceSettings.gender}
                          onChange={(e) => setVoiceSettings({...voiceSettings, gender: e.target.value as any})}
                        >
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Style</label>
                        <select 
                          className="w-full bg-studio-800/50 border border-white/[0.05] p-3 rounded-xl text-xs focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all appearance-none cursor-pointer hover:bg-studio-700/50"
                          value={voiceSettings.style}
                          onChange={(e) => setVoiceSettings({...voiceSettings, style: e.target.value})}
                        >
                          <option value="neutral">Neutral</option>
                          <option value="happy">Happy</option>
                          <option value="sad">Sad</option>
                          <option value="calm">Calm</option>
                          <option value="energetic">Energetic</option>
                          <option value="serious">Serious</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Speed ({voiceSettings.speed}x)</label>
                      </div>
                      <input 
                        type="range" min="0.5" max="2.0" step="0.1"
                        className="w-full accent-emerald-500 h-1 bg-studio-800 rounded-lg appearance-none cursor-pointer"
                        value={voiceSettings.speed}
                        onChange={(e) => setVoiceSettings({...voiceSettings, speed: parseFloat(e.target.value)})}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1">Pitch ({voiceSettings.pitch})</label>
                      </div>
                      <input 
                        type="range" min="-20" max="20" step="1"
                        className="w-full accent-emerald-500 h-1 bg-studio-800 rounded-lg appearance-none cursor-pointer"
                        value={voiceSettings.pitch}
                        onChange={(e) => setVoiceSettings({...voiceSettings, pitch: parseInt(e.target.value)})}
                      />
                    </div>
                  </div>
                </motion.section>

                {/* Engine Stats */}
                <motion.section 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="glass-emerald p-5 rounded-[1.5rem] space-y-4 relative overflow-hidden group"
                >
                  <div className="absolute -top-2 -right-2 p-2 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
                    <Cpu size={60} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                      <Activity size={14} className="text-emerald-500" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500/80">Engine Status</span>
                  </div>
                  <div className="space-y-3 relative z-10">
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-slate-500 uppercase tracking-widest">Latency</span><span className="text-emerald-400 font-bold">12ms</span></div>
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-slate-500 uppercase tracking-widest">Throughput</span><span className="text-emerald-400 font-bold">10x</span></div>
                  </div>
                </motion.section>

                {/* History */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <History size={14} className="text-slate-500" />
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Recent Masters</h2>
                  </div>
                  <div className="space-y-2">
                    {history.length > 0 ? history.map((item: any) => (
                      <motion.div 
                        key={item.id} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-3 rounded-lg bg-white/5 border border-transparent hover:border-emerald-500/30 transition-all group cursor-default"
                      >
                        <p className="text-[11px] font-bold truncate mb-2 group-hover:text-emerald-400 transition-colors">{item.name}</p>
                        <div className="flex gap-2">
                          <button onClick={() => setCurrentAudio(item.downloadUrl)} className="flex-grow bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[9px] font-bold py-1.5 rounded transition-all">LOAD</button>
                          <a href={item.downloadUrl} download className="p-1.5 bg-studio-800 hover:bg-studio-700 rounded text-slate-400 transition-colors"><Download size={12} /></a>
                          {item.zipUrl && (
                            <a href={item.zipUrl} download className="p-1.5 bg-studio-800 hover:bg-studio-700 rounded text-emerald-500 transition-colors flex items-center gap-1">
                              <Layers size={12} />
                            </a>
                          )}
                        </div>
                      </motion.div>
                    )) : (
                      <div className="text-center py-8 border border-dashed border-white/5 rounded-xl">
                        <p className="text-[9px] text-slate-600 uppercase tracking-widest">No recent masters</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-grow overflow-y-auto custom-scrollbar bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.03)_0%,transparent_70%)]">
          <AnimatePresence mode="wait">
            {view === 'editor' && (
              <motion.div 
                key="editor"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-5xl mx-auto p-8 lg:p-12 space-y-12"
              >
                {/* Project Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                  <div className="space-y-4 flex-grow max-w-2xl">
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-3"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                      <span className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-500/40">Live Production Session</span>
                    </motion.div>
                    <div className="relative group">
                      <input 
                        type="text"
                        className="bg-transparent border-none outline-none text-6xl font-display font-black text-gradient placeholder:text-studio-800 w-full focus:ring-0 transition-all duration-500 group-hover:translate-x-1"
                        placeholder="Production Title"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                      />
                      <div className="absolute -bottom-2 left-0 w-0 h-0.5 bg-gradient-to-r from-emerald-500/50 to-transparent group-focus-within:w-full transition-all duration-700" />
                    </div>
                    <div className="flex items-center gap-6 text-[10px] font-mono text-slate-600 uppercase tracking-[0.2em]">
                      <span className="flex items-center gap-2 hover:text-emerald-400 transition-colors cursor-default group"><Globe size={12} className="group-hover:rotate-12 transition-transform"/> Global Edge CDN</span>
                      <span className="flex items-center gap-2 hover:text-emerald-400 transition-colors cursor-default group"><Cpu size={12} className="group-hover:scale-110 transition-transform"/> Neural Engine v4.2</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button className="p-5 glass rounded-[1.5rem] hover:bg-white/5 transition-all text-slate-500 hover:text-white active:scale-90 border border-white/[0.02] group">
                      <Settings2 size={22} className="group-hover:rotate-90 transition-transform duration-500"/>
                    </button>
                    <button 
                      onClick={handleGenerate}
                      disabled={loading}
                      className="bg-emerald-500 hover:bg-emerald-400 text-black font-black px-12 py-5 rounded-[1.5rem] flex items-center gap-4 transition-all active:scale-[0.96] shadow-[0_20px_50px_-10px_rgba(16,185,129,0.3)] glow-emerald group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                      <span className="relative z-10 flex items-center gap-4">
                        {loading ? <Loader2 className="animate-spin" size={22}/> : <><Play size={22} fill="currentColor" className="group-hover:scale-110 transition-transform"/> MASTER AUDIO</>}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Bento Grid Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Script Editor Block */}
                  <div className="lg:col-span-8 space-y-6">
                    <div className="bento-card overflow-hidden group/editor">
                      <div className="bg-white/[0.02] px-10 py-5 border-b border-white/[0.03] flex justify-between items-center">
                        <div className="flex items-center gap-8">
                          <div className="flex items-center gap-3">
                            <label className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-all cursor-pointer group">
                              <Download size={14} className="text-slate-400 group-hover:text-emerald-500" />
                              <input type="file" className="hidden" accept=".txt" onChange={handleFileUpload} />
                            </label>
                            <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                              <Mic2 size={14} className="text-emerald-500" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Scripting Console</span>
                          </div>
                          <div className="h-4 w-px bg-white/5 hidden sm:block"></div>
                          <div className="hidden sm:flex items-center gap-3">
                            <span className="text-[11px] font-mono text-emerald-400 font-bold tracking-widest">{script.length}</span>
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em]">Characters</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <div className="w-2 h-2 rounded-full bg-studio-700 hover:bg-red-500/40 transition-all cursor-pointer"></div>
                          <div className="w-2 h-2 rounded-full bg-studio-700 hover:bg-yellow-500/40 transition-all cursor-pointer"></div>
                          <div className="w-2 h-2 rounded-full bg-studio-700 hover:bg-emerald-500/40 transition-all cursor-pointer"></div>
                        </div>
                      </div>
                      <textarea 
                        className="w-full h-[600px] bg-transparent p-12 outline-none resize-none text-xl leading-[1.8] font-medium placeholder:text-studio-800 custom-scrollbar focus:bg-white/[0.01] transition-all duration-700"
                        placeholder="Enter your multi-voice sequence..."
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                      />
                    </div>

                    {/* Progress Bar Overlay */}
                    <AnimatePresence>
                      {loading && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="glass-emerald p-6 rounded-2xl border border-emerald-500/20 glow-emerald"
                        >
                          <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-3">
                              <Loader2 className="animate-spin text-emerald-500" size={16}/>
                              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">{status}</span>
                            </div>
                            <span className="text-xs font-mono text-emerald-500/50">{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-studio-950 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                              initial={{ width: 0 }}
                              animate={{ width: `${progress}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Visualizer / Preview Block */}
                  <div className="lg:col-span-4 space-y-8">
                    <div className="bento-card p-10 space-y-10">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-emerald-500/10 rounded-xl">
                          <Sparkles size={18} className="text-emerald-500" />
                        </div>
                        <h3 className="font-display font-black text-xs uppercase tracking-[0.3em] text-slate-400">Script Analysis</h3>
                      </div>
                      
                      <div className="space-y-5 max-h-[450px] overflow-y-auto pr-3 custom-scrollbar">
                        {scriptSegments.map((seg, i) => (
                          <motion.div 
                            key={i} 
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="p-5 rounded-[1.5rem] bg-white/[0.02] border border-white/[0.03] space-y-3 hover:bg-white/[0.05] hover:border-emerald-500/20 transition-all group cursor-default"
                          >
                            {seg.character && (
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest group-hover:text-emerald-400 transition-colors">{seg.character}</span>
                                <div className="px-2 py-0.5 rounded-md bg-studio-800 text-[7px] font-mono text-slate-500 uppercase tracking-widest">{seg.provider}</div>
                              </div>
                            )}
                            <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed italic group-hover:text-slate-300 transition-colors">
                              "{seg.text || "..."}"
                            </p>
                          </motion.div>
                        ))}
                      </div>

                      <div className="pt-8 border-t border-white/[0.03]">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-1.5 bg-gold-accent/10 rounded-lg">
                            <Zap size={14} className="text-gold-accent" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Pro Tip</span>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                          Use <code className="text-emerald-500 font-mono bg-emerald-500/5 px-1.5 py-0.5 rounded">[Name | Provider | ID]</code> to switch voices instantly.
                        </p>
                      </div>
                    </div>

                    {/* Audio Player Card */}
                    <AnimatePresence>
                      {currentAudio && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9, y: 30 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className="bg-emerald-500 p-8 rounded-[2.5rem] shadow-[0_30px_60px_-15px_rgba(16,185,129,0.4)] space-y-6 glow-emerald relative overflow-hidden group"
                        >
                          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform duration-700">
                            <Headphones size={80} className="text-black" />
                          </div>
                          <div className="flex items-center justify-between relative z-10">
                            <div className="flex items-center gap-4">
                              <div className="bg-black/20 p-3 rounded-2xl backdrop-blur-md shadow-inner"><FileAudio size={24} className="text-black"/></div>
                              <div className="flex flex-col">
                                <span className="text-[10px] font-black text-black/60 uppercase tracking-[0.3em]">Master Output</span>
                                <span className="text-xs font-bold text-black uppercase tracking-widest">Studio Render v1.0</span>
                              </div>
                            </div>
                            <a href={currentAudio} download className="p-3 bg-black/10 hover:bg-black/20 rounded-2xl text-black transition-all active:scale-90 shadow-lg"><Download size={24}/></a>
                          </div>
                          <div className="relative z-10">
                            <audio src={currentAudio} controls className="w-full h-12 accent-black invert grayscale opacity-90 hover:opacity-100 transition-opacity" autoPlay />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-6xl mx-auto p-8 lg:p-12 space-y-12"
              >
                <div className="bento-card p-12 flex flex-col md:flex-row items-center gap-12 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-12 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity duration-700">
                    <User size={200} />
                  </div>
                  <div className="relative z-10">
                    <div className="relative group/avatar">
                      <div className="absolute inset-0 bg-emerald-500 rounded-full blur-2xl opacity-20 group-hover/avatar:opacity-40 transition-opacity" />
                      <img src={user?.photoURL} className="w-40 h-40 rounded-full border-4 border-white/5 relative z-10 group-hover/avatar:scale-105 transition-transform duration-500" alt="User" />
                      <div className="absolute -bottom-2 -right-2 bg-emerald-500 p-3 rounded-full border-4 border-studio-950 shadow-xl z-20"><CheckCircle2 size={20} className="text-black"/></div>
                    </div>
                  </div>
                  <div className="flex-grow text-center md:text-left space-y-4 relative z-10">
                    <div className="space-y-1">
                      <h2 className="text-5xl font-display font-black text-gradient tracking-tighter">{user?.displayName}</h2>
                      <p className="text-slate-500 font-mono text-sm tracking-widest uppercase opacity-60">{user?.email}</p>
                    </div>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4 pt-4">
                      <div className="px-5 py-2 glass-emerald rounded-2xl text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] glow-emerald">Studio Pro</div>
                      <div className="px-5 py-2 glass rounded-2xl text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] border border-white/[0.03]">Verified Creator</div>
                    </div>
                  </div>
                  <button onClick={() => setView('pricing')} className="bg-white text-black px-10 py-5 rounded-[1.5rem] text-xs font-black hover:bg-emerald-400 transition-all shadow-[0_20px_40px_-10px_rgba(255,255,255,0.2)] active:scale-95 uppercase tracking-widest relative z-10">Upgrade Studio</button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bento-card p-10 space-y-8"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/10 rounded-xl">
                        <Activity size={16} className="text-emerald-500" />
                      </div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Character Usage</h3>
                    </div>
                    <div className="relative h-56 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90">
                        <circle cx="50%" cy="50%" r="45%" className="fill-none stroke-white/[0.03] stroke-[12]" />
                        <motion.circle 
                          cx="50%" cy="50%" r="45%" 
                          className="fill-none stroke-emerald-500 stroke-[12] shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                          strokeDasharray="283"
                          initial={{ strokeDashoffset: 283 }}
                          animate={{ strokeDashoffset: 283 - (283 * 0.45) }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                        />
                      </svg>
                      <div className="absolute text-center">
                        <p className="text-4xl font-display font-black tracking-tighter">45.2k</p>
                        <p className="text-[9px] text-slate-600 font-black uppercase tracking-[0.2em] mt-1">of 100k</p>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-white/[0.03] flex justify-between items-center">
                      <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Reset in 12 days</span>
                      <button className="text-[9px] font-black text-emerald-500 uppercase tracking-widest hover:text-emerald-400 transition-colors">Add Credits</button>
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="lg:col-span-2 bento-card p-10 space-y-10"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 rounded-xl">
                          <History size={16} className="text-emerald-500" />
                        </div>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Production History</h3>
                      </div>
                      <button className="text-[9px] font-black text-slate-600 hover:text-emerald-400 transition-all uppercase tracking-[0.3em] border border-white/5 px-4 py-2 rounded-xl hover:bg-white/5">View Full Archive</button>
                    </div>
                    <div className="space-y-5">
                      {history.length > 0 ? history.slice(0, 4).map((item, i) => (
                        <motion.div 
                          key={i} 
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.3 + (i * 0.1) }}
                          className="flex items-center justify-between p-6 bg-white/[0.02] rounded-[1.5rem] border border-white/[0.03] hover:border-emerald-500/20 hover:bg-white/[0.04] transition-all group cursor-default"
                        >
                          <div className="flex items-center gap-6">
                            <div className="bg-emerald-500/10 p-3.5 rounded-2xl group-hover:bg-emerald-500/20 transition-all duration-500 group-hover:rotate-6"><FileAudio size={20} className="text-emerald-500"/></div>
                            <div className="space-y-1">
                              <p className="text-sm font-bold group-hover:text-emerald-400 transition-colors tracking-tight">{item.name}</p>
                              <div className="flex items-center gap-3">
                                <p className="text-[10px] text-slate-600 font-mono tracking-widest uppercase">{item.date}</p>
                                <div className="w-1 h-1 rounded-full bg-slate-800" />
                                <p className="text-[10px] text-slate-600 font-mono tracking-widest uppercase">2.4 MB</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                            <button onClick={() => setCurrentAudio(item.downloadUrl)} className="p-3 hover:bg-emerald-500/10 rounded-xl text-emerald-500 transition-colors"><Play size={18} fill="currentColor"/></button>
                            <a href={item.downloadUrl} download className="p-3 hover:bg-white/10 rounded-xl text-slate-400 transition-colors"><Download size={18}/></a>
                          </div>
                        </motion.div>
                      )) : (
                        <div className="text-center py-20 border-2 border-dashed border-white/[0.02] rounded-[2rem]">
                          <div className="bg-white/[0.02] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <FileAudio size={24} className="text-slate-700" />
                          </div>
                          <p className="text-[11px] text-slate-600 font-black uppercase tracking-[0.3em]">No productions archived</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}

            {view === 'pricing' && (
              <motion.div 
                key="pricing"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -30 }}
                className="max-w-6xl mx-auto p-8 lg:p-12 space-y-20"
              >
                <div className="text-center space-y-6">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="inline-block px-6 py-2 glass-emerald rounded-full text-[10px] font-black text-emerald-400 uppercase tracking-[0.4em] mb-4 glow-emerald"
                  >
                    Pricing Architecture
                  </motion.div>
                  <h2 className="text-7xl font-display font-black text-gradient tracking-tighter">Studio Licensing</h2>
                  <p className="text-slate-500 max-w-2xl mx-auto text-xl leading-relaxed">Scale your production with professional neural voices and high-speed parallel rendering engines.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                  {[
                    { name: "Starter", price: "0", features: ["10,000 Characters", "Gemini Voices Only", "Standard Speed", "Community Support"], color: "slate" },
                    { name: "Pro", price: "29", features: ["100,000 Characters", "All Providers", "10x Parallel Engine", "Priority Support"], color: "emerald", popular: true },
                    { name: "Studio", price: "99", features: ["Unlimited Characters", "Custom Voice Cloning", "API Access", "Dedicated Account Manager"], color: "gold" }
                  ].map((plan, idx) => (
                    <motion.div 
                      key={plan.name} 
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.15 }}
                      className={`relative bento-card p-12 flex flex-col transition-all duration-500 hover:translate-y-[-12px] ${plan.popular ? 'border-emerald-500/30 shadow-[0_40px_100px_-20px_rgba(16,185,129,0.15)]' : ''}`}
                    >
                      {plan.popular && <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-emerald-500 text-[10px] font-black px-8 py-2 rounded-full uppercase tracking-[0.2em] text-black shadow-xl glow-emerald z-20">Most Popular</div>}
                      <div className="mb-10">
                        <h3 className="text-3xl font-display font-black mb-4 tracking-tight">{plan.name}</h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-6xl font-display font-black tracking-tighter">${plan.price}</span>
                          <span className="text-slate-600 text-sm font-mono font-bold uppercase tracking-widest">/mo</span>
                        </div>
                      </div>
                      <ul className="space-y-6 mb-12 flex-grow">
                        {plan.features.map((feature, fIdx) => (
                          <li key={fIdx} className="flex items-center gap-4 text-sm text-slate-400 font-medium group/feat">
                            <div className={`p-1 rounded-full ${plan.popular ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/5 text-slate-600'} group-hover/feat:scale-110 transition-transform`}>
                              <CheckCircle2 size={14} />
                            </div>
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <button 
                        onClick={handleSubscribe}
                        className={`w-full py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] transition-all active:scale-[0.97] ${
                          plan.popular 
                            ? 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_20px_40px_-10px_rgba(16,185,129,0.3)] glow-emerald' 
                            : 'glass hover:bg-white/5 text-white'
                        }`}
                      >
                        {plan.price === "0" ? "Get Started" : "Select Plan"}
                      </button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return <MultiVoiceSaaS />;
}
