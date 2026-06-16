import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  app.use(express.json({ limit: '50mb' }));

  app.post('/api/generate-timeline', async (req, res) => {
    try {
      const { logs, date, timezone, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, diaryPrompt, reviewPrompt } = settings || {};
      
      const defaultPrompt = `You are a thoughtful diary assistant. Your task is to take a list of raw log fragments and weave them into a single cohesive, beautifully written diary entry for the day in Chinese.

Rules:
1. Write a fluent, empathetic, and coherent diary entry in Chinese (typically 2-4 paragraphs) that summarizes the day organically, connecting all the given fragments into a meaningful narrative.
2. DO NOT output a timeline or JSON array. Output purely Markdown formatted text.
3. Start with a beautiful, poetic title (Heading 2) encapsulating the mood or main theme of the day.
4. Critically: whenever you mention an event or detail derived from a specific raw log fragment, you MUST add a markdown link pointing to its ID. Format the link exactly like this: [your text](#log_id_<ID>) where <ID> is the exact ID provided in the list above. Example: [今天早早起了床](#log_id_12345-abcde).
5. Add a brief, encouraging closing thought at the end.`;

      const promptContext = `${diaryPrompt || defaultPrompt}

Context:
- Current Date: ${date}
- System Timezone: ${timezone}

Raw Logs:
${logs.map((l: any) => `- [${new Date(l.created_at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: timezone })}] (ID: ${l.id}): ${l.content}`).join('\n')}
`;

      let diaryMarkdown = "";
      let summaryMarkdown = "";
      let reviewMarkdown = "";

      if (provider === 'gemini') {
         const activeKey = apiKey;
         if (!activeKey) {
            return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
         }
         
         const genAiConfig: any = { apiKey: activeKey };
         let finalBaseUrl = baseUrl;
         if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
             finalBaseUrl = 'https://generativelanguage.googleapis.com';
         }
         if (finalBaseUrl) {
            genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
         }
         const ai = new GoogleGenAI(genAiConfig);
         
         let finalModel = model || 'gemini-3.1-flash-lite';

         const response = await ai.models.generateContent({
           model: finalModel,
           contents: promptContext,
         });
         diaryMarkdown = response.text || "";

         if (diaryMarkdown) {
           const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
           const summaryRes = await ai.models.generateContent({
             model: model || 'gemini-3.1-flash-lite',
             contents: `${summaryPromptStr}\n\nDiary Text:\n${diaryMarkdown}`
           });
           summaryMarkdown = summaryRes.text || "";

           const activeReviewPrompt = reviewPrompt || `你是一个有深度的反思助手。你的任务是回顾过去一段时间的记录和日记，并针对用户的关注点、情绪状态以及取得的成就撰写一份有意义的总结。请保持鼓励性和建设性的基调。`;
           const promptReviewContext = `${activeReviewPrompt}\n\nContext:\n- Date: ${date}\n- Timeline Logs:\n${logs.map((l: any) => `- [${new Date(l.created_at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: timezone })}] ${l.content}`).join('\n')}\n- Generated Diary:\n${diaryMarkdown}`;

           reviewMarkdown = "";
         }

      } else {
         let defBase = 'http://127.0.0.1:11434/v1';
         let defModel = 'llama3';
         switch(provider) {
           case 'openai': defBase = 'https://api.openai.com/v1'; defModel = 'gpt-4o-mini'; break;
           case 'deepseek': defBase = 'https://api.deepseek.com/v1'; defModel = 'deepseek-chat'; break;
           case 'volcengine': defBase = 'https://ark.cn-beijing.volces.com/api/v3'; defModel = 'doubao-seed-2-0-lite-260428'; break;
           case 'kimi': defBase = 'https://api.moonshot.cn/v1'; defModel = 'moonshot-v1-8k'; break;
           case 'zhipu': defBase = 'https://open.bigmodel.cn/api/paas/v4'; defModel = 'glm-4-flash'; break;
           case 'minimax': defBase = 'https://api.minimax.chat/v1'; defModel = 'abab6.5s-chat'; break;
           case 'mimo': defBase = 'https://ai.xiaomi.com/v1'; defModel = 'mimo-chat'; break;
         }
         
         const baseStr = baseUrl || defBase;
         const apiUrl = baseStr.endsWith('/chat/completions') ? baseStr : `${baseStr.replace(/\/$/, '')}/chat/completions`;
         const actualModel = model || defModel;
         
         if (!apiUrl || !actualModel) {
            return res.status(400).json({ error: '缺少自定义 API 配置信息' });
         }

         const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
               model: actualModel,
               messages: [
                 { role: "system", content: "You output well-formatted Markdown text." },
                 { role: "user", content: promptContext }
               ]
            })
         });

         if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`模型接口报错: ${response.status} ${errBody}`);
         }
         
         const data = await response.json();
         diaryMarkdown = data.choices?.[0]?.message?.content || "";

         if (diaryMarkdown) {
            const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
            const summaryRes = await fetch(apiUrl, {
               method: 'POST',
               headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
               },
               body: JSON.stringify({
                  model: actualModel,
                  messages: [
                    { role: "system", content: summaryPromptStr },
                    { role: "user", content: `Diary Text:\n${diaryMarkdown}` }
                  ]
               })
            });
            if (summaryRes.ok) {
               const sData = await summaryRes.json();
               summaryMarkdown = sData.choices?.[0]?.message?.content || "";
            }

            reviewMarkdown = "";
         }
      }

      res.json({ timeline: "", ai_editorial: diaryMarkdown, ai_summary: summaryMarkdown, ai_review: reviewMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/generate-review', async (req, res) => {
    try {
      const { logs, date, timezone, diaryContent, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, reviewPrompt } = settings || {};
      
      const defaultReviewPrompt = `你是一个有深度的反思助手。你的任务是回顾过去一段时间的记录和日记，并针对用户的关注点、情绪状态以及取得的成就撰写一份有意义的总结。请保持鼓励性和建设性的基调。`;
      
      const promptReviewContext = `${reviewPrompt || defaultReviewPrompt}

Context:
- Current Date: ${date}
- System Timezone: ${timezone}

Raw Logs:
${logs.map((l: any) => `- [${new Date(l.created_at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: timezone })}] ${l.content}`).join('\n')}

Generated Diary:
${diaryContent || ""}
`;

      let reviewMarkdown = "";
      let summaryMarkdown = "";

      if (provider === 'gemini') {
         const activeKey = apiKey;
         if (!activeKey) {
            return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
         }
         
         const genAiConfig: any = { apiKey: activeKey };
         let finalBaseUrl = baseUrl;
         if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
             finalBaseUrl = 'https://generativelanguage.googleapis.com';
         }
         if (finalBaseUrl) {
            genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
         }
         const ai = new GoogleGenAI(genAiConfig);
         
         let finalModel = model || 'gemini-3.1-flash-lite';

         const response = await ai.models.generateContent({
           model: finalModel,
           contents: promptReviewContext,
         });
          reviewMarkdown = response.text || "";
          if (reviewMarkdown) {
             const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary. Based on the provided text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
             const summaryRes = await ai.models.generateContent({
               model: model || 'gemini-3.1-flash-lite',
               contents: `${summaryPromptStr}\n\nReview Text:\n${reviewMarkdown}`
             });
             summaryMarkdown = summaryRes.text || "";
          }

      } else {
         let defBase = 'http://127.0.0.1:11434/v1';
         let defModel = 'llama3';
         switch(provider) {
           case 'openai': defBase = 'https://api.openai.com/v1'; defModel = 'gpt-4o-mini'; break;
           case 'deepseek': defBase = 'https://api.deepseek.com/v1'; defModel = 'deepseek-chat'; break;
           case 'volcengine': defBase = 'https://ark.cn-beijing.volces.com/api/v3'; defModel = 'doubao-seed-2-0-lite-260428'; break;
           case 'kimi': defBase = 'https://api.moonshot.cn/v1'; defModel = 'moonshot-v1-8k'; break;
           case 'zhipu': defBase = 'https://open.bigmodel.cn/api/paas/v4'; defModel = 'glm-4-flash'; break;
           case 'minimax': defBase = 'https://api.minimax.chat/v1'; defModel = 'abab6.5s-chat'; break;
           case 'mimo': defBase = 'https://ai.xiaomi.com/v1'; defModel = 'mimo-chat'; break;
         }
         
         const baseStr = baseUrl || defBase;
         const apiUrl = baseStr.endsWith('/chat/completions') ? baseStr : `${baseStr.replace(/\/$/, '')}/chat/completions`;
         const actualModel = model || defModel;
         
         if (!apiUrl || !actualModel) {
            return res.status(400).json({ error: '缺少自定义 API 配置信息' });
         }

         const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
               model: actualModel,
               messages: [
                 { role: "system", content: "You output well-formatted Markdown text." },
                 { role: "user", content: promptReviewContext }
               ]
            })
         });

         if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`模型接口报错: ${response.status} ${errBody}`);
         }
         
         const data = await response.json();
          reviewMarkdown = data.choices?.[0]?.message?.content || "";
          if (reviewMarkdown) {
             const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary. Based on the provided text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
             const summaryRes = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                   'Content-Type': 'application/json',
                   'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                   model: actualModel,
                   messages: [
                     { role: "system", content: summaryPromptStr },
                     { role: "user", content: `Review Text:\n${reviewMarkdown}` }
                   ]
                })
             });
             if (summaryRes.ok) {
                const sData = await summaryRes.json();
                summaryMarkdown = sData.choices?.[0]?.message?.content || "";
             }
          }
      }

      res.json({ ai_review: reviewMarkdown, ai_summary: summaryMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/generate-insights', async (req, res) => {
    try {
      const { logs, timeRange, timeRangeLabel, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, insightPrompt } = settings || {};
      
      const defaultInsightPrompt = `You are a productivity and life coach assistant. Based on the user's activity logs and diaries, provide deep insights into their routines, highlighting positive trends, areas for potential improvement, and actionable suggestions to enhance well-being and productivity.`;
      
      const promptContext = `${insightPrompt || defaultInsightPrompt}

Context:
- Analysis Time Range: ${timeRangeLabel}
- Logs count: ${logs.length}

Raw Logs:
${logs.map((l: any) => `- [${l.date}] (ID: ${l.id}): ${l.content}`).join('\n')}

Output your insights in a clear, well-structured Markdown format. Group your insights logically (e.g., Summary, Key Trends, Actionable Advice).
`;

      let insightMarkdown = "";

      if (provider === 'gemini') {
         const activeKey = apiKey;
         if (!activeKey) {
            return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
         }
         
         const genAiConfig: any = { apiKey: activeKey };
         let finalBaseUrl = baseUrl;
         if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
             finalBaseUrl = 'https://generativelanguage.googleapis.com';
         }
         if (finalBaseUrl) {
            genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
         }
         const ai = new GoogleGenAI(genAiConfig);
         
         let finalModel = model || 'gemini-3.1-flash-lite';

         const response = await ai.models.generateContent({
           model: finalModel,
           contents: promptContext,
         });
         insightMarkdown = response.text || "";

      } else {
         let defBase = 'http://127.0.0.1:11434/v1';
         let defModel = 'llama3';
         switch(provider) {
           case 'openai': defBase = 'https://api.openai.com/v1'; defModel = 'gpt-4o-mini'; break;
           case 'deepseek': defBase = 'https://api.deepseek.com/v1'; defModel = 'deepseek-chat'; break;
           case 'volcengine': defBase = 'https://ark.cn-beijing.volces.com/api/v3'; defModel = 'doubao-seed-2-0-lite-260428'; break;
           case 'kimi': defBase = 'https://api.moonshot.cn/v1'; defModel = 'moonshot-v1-8k'; break;
           case 'zhipu': defBase = 'https://open.bigmodel.cn/api/paas/v4'; defModel = 'glm-4-flash'; break;
           case 'minimax': defBase = 'https://api.minimax.chat/v1'; defModel = 'abab6.5s-chat'; break;
           case 'mimo': defBase = 'https://ai.xiaomi.com/v1'; defModel = 'mimo-chat'; break;
         }
         
         const baseStr = baseUrl || defBase;
         const apiUrl = baseStr.endsWith('/chat/completions') ? baseStr : `${baseStr.replace(/\/$/, '')}/chat/completions`;
         const actualModel = model || defModel;
         
         if (!apiUrl || !actualModel) {
            return res.status(400).json({ error: '缺少自定义 API 配置信息' });
         }

         const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
               model: actualModel,
               messages: [
                 { role: "system", content: "You output well-formatted Markdown text." },
                 { role: "user", content: promptContext }
               ]
            })
         });

         if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`模型接口报错: ${response.status} ${errBody}`);
         }
         
         const data = await response.json();
         insightMarkdown = data.choices?.[0]?.message?.content || "";
      }

      res.json({ report: insightMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/transcribe', express.json({limit: '50mb'}), async (req, res) => {
    try {
       const { audio_base64, mime_type, settings } = req.body;
       const { provider = 'gemini', apiKey, baseUrl, model } = settings || {};

       if (!audio_base64 || !mime_type) {
         return res.status(400).json({ error: 'Missing audio data' });
       }

       let transcript = "";

       if (provider === 'gemini') {
         const activeKey = apiKey;
         if (!activeKey) {
            return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
         }
         
         const genAiConfig: any = { apiKey: activeKey };
         let finalBaseUrl = baseUrl;
         if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
             finalBaseUrl = 'https://generativelanguage.googleapis.com';
         }
         if (finalBaseUrl) {
            genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
         }
         const ai = new GoogleGenAI(genAiConfig);
         
         let finalModel = model || 'gemini-3.1-flash-lite';

         const cleanMimeType = mime_type.split(';')[0];
         const response = await ai.models.generateContent({
           model: finalModel,
           contents: [
             {
               inlineData: {
                 mimeType: cleanMimeType,
                 data: audio_base64
               }
             },
             {
               text: "请把上面的语音文件准确转录为简体中文。如果是静音、纯噪音或毫无可听的语音，请只输出 [EMPTY_AUDIO]"
             }
           ],
           config: {
             temperature: 0,
             systemInstruction: "You are an expert transcriber. Transcribe the given audio accurately into Simplified Chinese text. Reply with ONLY the transcribed text, without any markdown formatting, quotation marks, or extra explanation. CRITICAL: If the audio is completely silent, contains only background noise, or contains no speech, YOU MUST RETURN EXACTLY AND ONLY THE WORD \"[EMPTY_AUDIO]\"."
           }
         });
         transcript = response.text || "";
         const hallucinationKeywords = ["[EMPTY_AUDIO]", "EMPTY_AUDIO", "谢谢观看", "字幕提供", "请不吝赐教", "字幕", "Thank you", "空白", "空音频", "没有声音", "请把上面的语音文件", "转录为简体中文", "如果是静音", "[静音]"];
         const tTrimmed = transcript.trim().replace(/[.,!?;:'"。，！？；：’”（）()]+/g, "");
         
         if (transcript && (tTrimmed.includes("谢谢观看") || tTrimmed === "EMPTY_AUDIO" || tTrimmed === "哎" || tTrimmed.length <= 1)) {
           // Only drop if it's literally just the hallucination word, 
           // don't drop if it includes EMPTY_AUDIO but has other text, 
           // actually, for volcengine let's just let it pass through to debug what it's saying.
           if (provider !== 'volcengine') {
               transcript = "";
           }
         }
       } else if (provider === 'volcengine') {
         const baseStr = baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
         const apiPrefix = baseStr.replace(/\/chat\/completions$/, '').replace(/\/responses$/, '').replace(/\/$/, '');
         const apiUrl = `${apiPrefix}/responses`;
         
         if (!apiUrl) {
            return res.status(400).json({ error: '缺少自定义 API 配置信息' });
         }

         let convertedBase64 = audio_base64;
         let convertedMime = mime_type;
         
         if (mime_type.includes('webm')) {
           const tempInput = path.join(os.tmpdir(), `input_${Date.now()}.webm`);
           const tempOutput = path.join(os.tmpdir(), `output_${Date.now()}.mp3`);
           
           fs.writeFileSync(tempInput, Buffer.from(audio_base64, 'base64'));
           
           await new Promise<void>((resolve, reject) => {
             ffmpeg(tempInput)
               .toFormat('mp3')
               .on('end', () => resolve())
               .on('error', (err) => reject(err))
               .save(tempOutput);
           });
           
           convertedBase64 = fs.readFileSync(tempOutput).toString('base64');
           convertedMime = 'audio/mp3'; // use mp3 instead of mpeg for volcengine exact match
           
           fs.unlinkSync(tempInput);
           fs.unlinkSync(tempOutput);
         }

         const audioDataUrl = `data:${convertedMime};base64,${convertedBase64}`;
         
         const fetchRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
               model: model || 'doubao-seed-2-0-lite-260428',
               input: [
                 {
                   role: 'user',
                   content: [
                     {
                       type: 'input_text',
                       text: '请逐句将这段语音转录为文字，保持原意。如果是纯噪音、静音或没有明显的人类语音，请务必直接输出并且只输出 [EMPTY_AUDIO] 这个占位符。'
                     },
                     {
                       type: 'input_audio',
                       audio_url: audioDataUrl
                     }
                   ]
                 }
               ]
            })
         });

         if (!fetchRes.ok) {
            const errText = await fetchRes.text();
            throw new Error(`语音解析报错: ${errText}`);
         }
         
         const data = await fetchRes.json();
         console.log("Volcengine Audio Transcript Response:", JSON.stringify(data, null, 2));
         
         transcript = data.choices?.[0]?.message?.content || data.output?.text || data.text || data.data?.text || data.response?.text || "";
         
         if (!transcript && data.output && Array.isArray(data.output)) {
             const messageObj = data.output.find((o: any) => o.type === 'message');
             if (messageObj && messageObj.content && Array.isArray(messageObj.content)) {
                const textObj = messageObj.content.find((c: any) => c.type === 'text' || c.type === 'output_text');
                if (textObj && textObj.text) {
                   transcript = textObj.text;
                }
             }
             if (!transcript) {
                 transcript = data.output[0]?.text || data.output.find((o: any) => o.type === 'text')?.text || "";
             }
         }

         if (!transcript && data.choices && data.choices[0]?.message) {
            transcript = data.choices[0].message.content || "";
         }
         
         // DEBUG: If transcript is still empty, throw the raw JSON so we can see it on the frontend!
         if (!transcript) {
            throw new Error(`Volcengine response text empty. Raw JSON: ${JSON.stringify(data)}`);
         }
       } else {
         let defBase = 'http://127.0.0.1:11434/v1';
         let defModel = 'whisper-1';
         switch(provider) {
           case 'openai': defBase = 'https://api.openai.com/v1'; break;
           case 'volcengine': defBase = 'https://ark.cn-beijing.volces.com/api/v3'; break;
           case 'kimi': defBase = 'https://api.moonshot.cn/v1'; break;
           case 'zhipu': defBase = 'https://open.bigmodel.cn/api/paas/v4'; break;
           case 'minimax': defBase = 'https://api.minimax.chat/v1'; break;
           case 'mimo': defBase = 'https://ai.xiaomi.com/v1'; break;
         }

         const baseStr = baseUrl || defBase;
         const apiUrl = baseStr.endsWith('/audio/transcriptions') ? baseStr : `${baseStr.replace(/\/$/, '')}/audio/transcriptions`;
         
         if (!apiUrl) {
            return res.status(400).json({ error: '缺少自定义 API 配置信息，或者该服务商不支持语音转写' });
         }

         let finalBuffer = Buffer.from(audio_base64, 'base64');
         let finalMime = mime_type;
         let extension = mime_type.includes('mp4') ? 'mp4' : mime_type.includes('mpeg') ? 'mp3' : 'webm';
         
         // Convert all non-mp3 for volcengine standard endpoint just in case it's used
         if (provider === 'volcengine' && !mime_type.includes('mpeg') && !mime_type.includes('mp3')) {
           const tempInput = path.join(os.tmpdir(), `input_${Date.now()}.${extension}`);
           const tempOutput = path.join(os.tmpdir(), `output_${Date.now()}.mp3`);
           fs.writeFileSync(tempInput, finalBuffer);
           await new Promise<void>((resolve, reject) => {
             ffmpeg(tempInput)
               .toFormat('mp3')
               .on('end', () => resolve())
               .on('error', (err) => reject(err))
               .save(tempOutput);
           });
           finalBuffer = fs.readFileSync(tempOutput);
           finalMime = 'audio/mp3';
           extension = 'mp3';
           fs.unlinkSync(tempInput);
           fs.unlinkSync(tempOutput);
         }

         // OpenAI API expects multipart/form-data for audio
         const formData = new FormData();
         
         const audioBlob = new Blob([finalBuffer], { type: finalMime });
         formData.append('file', audioBlob, `audio.${extension}`);
         // model name for openai audio transcription is typically whisper-1, allow custom
         formData.append('model', provider === 'openai' ? 'whisper-1' : (model || 'whisper-1'));
         formData.append('temperature', '0');
         formData.append('prompt', '这是一段普通的中文语音。');
         
         const fetchRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
               'Authorization': `Bearer ${apiKey}`
            },
            body: formData
         });

         if (!fetchRes.ok) {
            const errText = await fetchRes.text();
            throw new Error(`语音转写失败: ${errText}`);
         }
         
         const data = await fetchRes.json();
         transcript = data.text || "";
       }

       res.json({ text: transcript.trim() });

    } catch (err: any) {
       console.error("Transcription error:", err);
       res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
       res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
