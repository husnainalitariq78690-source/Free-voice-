import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import { GoogleGenAI, Modality } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";
import archiver from "archiver";

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

app.use(express.json({ limit: '50mb' }));

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

const splitTextIntoSegments = (text: string, wordsPerSegment: number = 750) => {
  const words = text.split(/\s+/);
  const segments: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerSegment) {
    segments.push(words.slice(i, i + wordsPerSegment).join(" "));
  }
  return segments;
};

async function generateTTS(text: string, provider: string, voiceId: string, options?: any): Promise<Buffer> {
  const requestedSampleRate = parseInt(options?.quality?.sampleRate || "24000");
  const speed = options?.settings?.speed || 1.0;
  const pitch = options?.settings?.pitch || 0;
  const style = options?.settings?.style || "neutral";

  if (provider === "google") {
    // We use prompting to influence speed, pitch, and style as Gemini TTS doesn't have direct params yet
    const prompt = `Say this in a ${style} tone, at ${speed}x speed, with a pitch offset of ${pitch}: ${text}`;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
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
    return createWavBuffer(pcmBuffer, requestedSampleRate);
  }
  throw new Error("Invalid provider");
}

// API Routes
app.post("/api/preview", async (req, res) => {
  try {
    const { text, provider, voice_id, quality, settings } = req.body;
    const audioBuffer = await generateTTS(text.substring(0, 300), provider, voice_id, { quality, settings });
    res.set("Content-Type", "audio/wav");
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-longform", async (req, res) => {
  const jobId = uuidv4();
  jobs.set(jobId, { progress: 0, status: "segmenting" });
  res.json({ jobId });

  try {
    const { script, project_name, quality, settings } = req.body;
    const projectId = uuidv4();
    const projectPath = path.join(PROJECTS_DIR, projectId);
    fs.mkdirSync(projectPath);

    // 1. Segmentation
    const segmentsText = splitTextIntoSegments(script, 750);
    const totalSegments = segmentsText.length;
    
    // 2. Voice Selection
    const maleVoices = ["Puck", "Charon", "Fenrir"];
    const femaleVoices = ["Kore", "Zephyr"];
    const availableVoices = settings.gender === "male" ? maleVoices : femaleVoices;
    const voiceId = availableVoices[0]; // Default to first available for longform

    jobs.set(jobId, { progress: 5, status: `Synthesizing ${totalSegments} segments...` });

    // 3. Parallel Generation
    const segmentBuffers: Buffer[] = [];
    const segmentFiles: string[] = [];

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < totalSegments; i += batchSize) {
      const batch = segmentsText.slice(i, i + batchSize);
      const batchPromises = batch.map(async (text, index) => {
        const segmentIndex = i + index + 1;
        const buffer = await generateTTS(text, "google", voiceId, { quality, settings });
        const fileName = `segment_${segmentIndex}.wav`;
        fs.writeFileSync(path.join(projectPath, fileName), buffer);
        return { buffer, fileName };
      });

      const results = await Promise.all(batchPromises);
      results.forEach(r => {
        segmentBuffers.push(r.buffer);
        segmentFiles.push(r.fileName);
      });

      const progress = 5 + Math.floor(((i + batch.length) / totalSegments) * 85);
      jobs.set(jobId, { progress, status: `Synthesizing segment ${i + batch.length}/${totalSegments}` });
    }

    // 4. Merging
    jobs.set(jobId, { progress: 95, status: "Merging segments..." });
    const mergedBuffer = mergeWavBuffers(segmentBuffers);
    const mergedFileName = `${project_name || "full_production"}.wav`;
    fs.writeFileSync(path.join(projectPath, mergedFileName), mergedBuffer);

    // 5. ZIP Creation
    jobs.set(jobId, { progress: 98, status: "Creating ZIP archive..." });
    const zipFileName = `${project_name || "production"}_all_files.zip`;
    const zipPath = path.join(projectPath, zipFileName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    segmentFiles.forEach(file => {
      archive.file(path.join(projectPath, file), { name: file });
    });
    archive.file(path.join(projectPath, mergedFileName), { name: mergedFileName });
    await archive.finalize();

    const result = {
      success: true,
      projectId,
      fileName: mergedFileName,
      zipName: zipFileName,
      downloadUrl: `/api/download/${projectId}/${mergedFileName}`,
      zipUrl: `/api/download/${projectId}/${zipFileName}`,
      segments: segmentFiles.map(f => `/api/download/${projectId}/${f}`)
    };

    jobs.set(jobId, { progress: 100, status: "completed", result });
  } catch (error: any) {
    console.error(error);
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
