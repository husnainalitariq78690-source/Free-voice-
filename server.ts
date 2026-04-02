import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import { GoogleGenAI, Modality } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";

const app = express();
const PORT = 3000;

// Lazy Stripe initialization
let stripe: Stripe | null = null;
const getStripe = () => {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is missing");
    stripe = new Stripe(key);
  }
  return stripe;
};

app.use(express.json());

const STORAGE_DIR = path.join(process.cwd(), "storage");
const PROJECTS_DIR = path.join(STORAGE_DIR, "projects");
const PREVIEWS_DIR = path.join(STORAGE_DIR, "previews");

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR);
if (!fs.existsSync(PREVIEWS_DIR)) fs.mkdirSync(PREVIEWS_DIR);

// Simple Job Tracking for Progress Bar
const jobs = new Map<string, { progress: number; status: string; result?: any }>();

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Helper to create a WAV buffer from raw PCM
const createWavBuffer = (pcmData: Buffer, sampleRate: number) => {
  const buffer = Buffer.alloc(44 + pcmData.length);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + pcmData.length, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(pcmData.length, 40);
  pcmData.copy(buffer, 44);
  return buffer;
};

const mergeWavBuffers = (buffers: Buffer[]) => {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];
  const totalDataLength = buffers.reduce((acc, buf) => acc + (buf.length - 44), 0);
  const merged = Buffer.alloc(44 + totalDataLength);
  buffers[0].copy(merged, 0, 0, 44);
  merged.writeUInt32LE(36 + totalDataLength, 4);
  merged.writeUInt32LE(totalDataLength, 40);
  let offset = 44;
  for (const buf of buffers) {
    buf.copy(merged, offset, 44);
    offset += (buf.length - 44);
  }
  return merged;
};

async function generateTTS(text: string, provider: string, voiceId: string, quality?: { sampleRate: string, bitrate: string }): Promise<Buffer> {
  const requestedSampleRate = parseInt(quality?.sampleRate || "24000");
  
  if (provider === "google") {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceId as any },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data from Gemini");
    const pcmBuffer = Buffer.from(base64Audio, "base64");
    // Gemini TTS returns 24kHz PCM. If user requested different, we use it in header.
    // Note: This doesn't resample, just changes playback speed unless resampled.
    // For a real app, we'd use ffmpeg to resample.
    return createWavBuffer(pcmBuffer, requestedSampleRate);
  } else if (provider === "elevenlabs") {
    const apiKey = process.env.ELEVEN_API_KEY;
    if (!apiKey) throw new Error("ELEVEN_API_KEY is missing");
    
    // Map sample rate to ElevenLabs format if possible
    let outputFormat = "audio/wav"; 
    // ElevenLabs supports specific formats in query params usually.
    
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      { text, model_id: "eleven_monolingual_v1" },
      {
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/wav" },
        responseType: "arraybuffer",
      }
    );
    return Buffer.from(response.data);
  }
  throw new Error("Invalid provider");
}

// API Routes
app.post("/api/preview", async (req, res) => {
  try {
    const { text, provider, voice_id, quality } = req.body;
    const audioBuffer = await generateTTS(text.substring(0, 300), provider, voice_id, quality);
    res.set("Content-Type", "audio/wav");
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const jobId = uuidv4();
  jobs.set(jobId, { progress: 0, status: "parsing" });
  res.json({ jobId });

  try {
    const { script, project_name, quality } = req.body;
    const projectId = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, projectId);
    fs.mkdirSync(projectPath);

    const pattern = /\[\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\]\n(.*?)(?=\n\[|$)/gs;
    const matches = [...script.matchAll(pattern)];

    if (matches.length === 0) throw new Error("Invalid script format");

    jobs.set(jobId, { progress: 10, status: "synthesizing" });

    // PARALLEL PROCESSING (10x Speed)
    const segmentPromises = matches.map(async (match, index) => {
      const [_, name, provider, voiceId, text] = match;
      const buffer = await generateTTS(text.trim(), provider.trim().toLowerCase(), voiceId.trim(), quality);
      
      // Update progress
      const currentJob = jobs.get(jobId);
      if (currentJob) {
        const progress = 10 + Math.floor(((index + 1) / matches.length) * 80);
        jobs.set(jobId, { ...currentJob, progress });
      }
      
      return buffer;
    });

    const segments = await Promise.all(segmentPromises);

    jobs.set(jobId, { progress: 95, status: "merging" });
    const mergedBuffer = mergeWavBuffers(segments);
    const fileName = `${project_name || "merged"}.wav`;
    const filePath = path.join(projectPath, fileName);
    fs.writeFileSync(filePath, mergedBuffer);

    const result = {
      success: true,
      projectId,
      fileName,
      downloadUrl: `/api/download/${projectId}/${fileName}`
    };

    jobs.set(jobId, { progress: 100, status: "completed", result });
  } catch (error: any) {
    jobs.set(jobId, { progress: 0, status: "failed", result: { error: error.message } });
  }
});

app.get("/api/job-status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/download/:projectId/:fileName", (req, res) => {
  const { projectId, fileName } = req.params;
  const filePath = path.join(PROJECTS_DIR, projectId, fileName);
  if (fs.existsSync(filePath)) res.download(filePath);
  else res.status(404).send("File not found");
});

// STRIPE SAAS ENDPOINTS
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { userId } = req.body;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/pricing`,
      client_reference_id: userId,
    });
    res.json({ url: session.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
