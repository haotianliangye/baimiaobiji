import fs from 'fs';

const serverCode = fs.readFileSync('server.ts', 'utf-8');

// Find where app.post('/api/generate-timeline' starts
const startIdx = serverCode.indexOf(`app.post('/api/generate-timeline'`);
const endIdx = serverCode.indexOf(`// Vite middleware for development`);

if (startIdx !== -1 && endIdx !== -1) {
    const routesCode = serverCode.substring(startIdx, endIdx);
    
    const newApiCode = `import 'dotenv/config';
import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const app = express();

app.use(express.json({ limit: '50mb' }));

${routesCode}

export default app;
`;
    
    fs.writeFileSync('api/index.ts', newApiCode);
    console.log("Successfully rebuilt api/index.ts");
} else {
    console.log("Could not find boundaries");
}
