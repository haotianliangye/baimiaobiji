import 'dotenv/config';
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
         diaryMarkdown = await sendLLMRequest(
            provider,
            baseUrl,
            apiKey,
            model,
            "You output well-formatted Markdown text.",
            [{ role: "user", content: promptContext }]
         );

         if (diaryMarkdown) {
            const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
            try {
               summaryMarkdown = await sendLLMRequest(
                  provider,
                  baseUrl,
                  apiKey,
                  model,
                  summaryPromptStr,
                  [{ role: "user", content: `Diary Text:\n${diaryMarkdown}` }],
                  1024
               );
            } catch (err) {
               console.error("Failed to generate diary summary:", err);
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
         reviewMarkdown = await sendLLMRequest(
            provider,
            baseUrl,
            apiKey,
            model,
            "You output well-formatted Markdown text.",
            [{ role: "user", content: promptReviewContext }]
         );

         if (reviewMarkdown) {
            const summaryPromptStr = settings?.summaryPrompt || `You are an assistant that creates a concise, one-sentence summary. Based on the provided text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
            try {
               summaryMarkdown = await sendLLMRequest(
                  provider,
                  baseUrl,
                  apiKey,
                  model,
                  summaryPromptStr,
                  [{ role: "user", content: `Review Text:\n${reviewMarkdown}` }],
                  1024
               );
            } catch (err) {
               console.error("Failed to generate review summary:", err);
            }
         }
      }

      res.json({ ai_review: reviewMarkdown, ai_summary: summaryMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Embedding (vector) generation endpoint ---
  app.post('/api/generate-embedding', async (req, res) => {
    try {
      const { text, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, embeddingModel } = settings || {};

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required and must not be empty' });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'API Key is required for embedding generation' });
      }

      let embedding: number[] = [];

      if (provider === 'gemini') {
        const genAiConfig: any = { apiKey };
        let finalBaseUrl = baseUrl;
        if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
          finalBaseUrl = 'https://generativelanguage.googleapis.com';
        }
        if (finalBaseUrl) {
          genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
        }
        const ai = new GoogleGenAI(genAiConfig);
        const result = await ai.models.embedContent({
          model: embeddingModel || 'text-embedding-004',
          contents: text.trim(),
        });
        embedding = result.embeddings?.[0]?.values || [];
      } else {
        const defConfigs: Record<string, { baseUrl: string; model: string }> = {
          openai: { baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
          siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-large-zh-v1.5' },
          volcengine: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-embedding' },
          zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
          custom: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'nomic-embed-text' },
        };
        const def = defConfigs[provider] || defConfigs['custom'];
        const apiBase = (baseUrl || def.baseUrl).replace(/\/$/, '');
        const apiUrl = `${apiBase}/embeddings`;
        const actualModel = embeddingModel || def.model;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ input: text.trim(), model: actualModel }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Embedding API error: ${response.status} ${errBody}`);
        }

        const data = await response.json();
        embedding = data.data?.[0]?.embedding || [];
      }

      if (!embedding.length) {
        throw new Error('Embedding API returned empty vector');
      }

      res.json({ embedding });
    } catch (err: any) {
      console.error('Embedding generation error:', err);
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
         insightMarkdown = await sendLLMRequest(
            provider,
            baseUrl,
            apiKey,
            model,
            "You output well-formatted Markdown text.",
            [{ role: "user", content: promptContext }]
         );
      }

      res.json({ report: insightMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  async function processChatRequest(req: any, res: any, systemPrompt: string) {
    try {
      const { chatHistory, userMessage, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model } = settings || {};
      
      let replyMarkdown = "";

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
         
         const contents = (chatHistory || []).map((msg: any) => ({
             role: msg.role === 'assistant' ? 'model' : 'user',
             parts: [{ text: msg.content }]
         }));
         contents.push({ role: 'user', parts: [{ text: userMessage }] });

         const response = await ai.models.generateContent({
           model: finalModel,
           contents: contents,
           config: {
               systemInstruction: systemPrompt
           }
         });
         replyMarkdown = response.text || "";

      } else {
         const chatMessages = [
             ...(chatHistory || []).map((msg: any) => ({ role: msg.role, content: msg.content })),
             { role: "user", content: userMessage }
         ];
         replyMarkdown = await sendLLMRequest(
            provider,
            baseUrl,
            apiKey,
            model,
            systemPrompt,
            chatMessages
         );
      }

      res.json({ reply: replyMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  app.post('/api/insight-chat', async (req, res) => {
    const { insightContent } = req.body;
    const systemPrompt = `你是一个有洞察力的 AI 助手。以下是一份针对用户的「生命洞察」报告内容：\n\n${insightContent}\n\n请基于这份报告的内容，以及用户的历史对话，回答用户的最新问题。回答要保持客观、有洞察力且鼓励性，使用 Markdown 格式。如果用户的问题与报告无关，也可以正常回答。`;
    await processChatRequest(req, res, systemPrompt);
  });

  app.post('/api/diary-chat', async (req, res) => {
    const { contextContent } = req.body;
    const systemPrompt = `你是一个有同理心和洞察力的个人日记助理。以下是用户的一篇日记内容：\n\n${contextContent}\n\n请基于这篇日记的内容，以及用户的历史对话，回答用户的最新问题。回答要保持客观、有洞察力且鼓励性，使用 Markdown 格式。如果用户的问题与日记无关，也可以正常回答。`;
    await processChatRequest(req, res, systemPrompt);
  });

  app.post('/api/review-chat', async (req, res) => {
    const { contextContent } = req.body;
    const systemPrompt = `你是一个有同理心和洞察力的个人反思教练。以下是用户的一篇回顾与反思总结：\n\n${contextContent}\n\n请基于这份总结的内容，以及用户的历史对话，回答用户的最新问题。回答要保持客观、有洞察力且鼓励性，使用 Markdown 格式。如果用户的问题与回顾无关，也可以正常回答。`;
    await processChatRequest(req, res, systemPrompt);
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

  app.post('/api/webdav-proxy', async (req, res) => {
    try {
      const { endpoint, method, path: filePath, auth, body, headers } = req.body;
      if (!endpoint || !method) {
        return res.status(400).json({ error: 'Missing endpoint or method' });
      }

      const cleanEndpoint = endpoint.endsWith('/') ? endpoint : endpoint + '/';
      const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
      const url = cleanEndpoint + cleanPath;

      const requestHeaders: Record<string, string> = {
        'Authorization': auth,
        ...headers
      };

      let requestBody: any = undefined;
      if (body) {
        if (method === 'PUT') {
          requestBody = Buffer.from(body, 'base64');
        } else {
          requestBody = body;
        }
      }

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody
      });

      if (method === 'GET') {
        if (response.status === 404) {
          return res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
        if (!response.ok) {
          return res.status(response.status).json({ error: `Fetch failed: ${response.statusText}` });
        }
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return res.json({ status: response.status, data: base64 });
      }

      return res.json({ status: response.status });
    } catch (err: any) {
      console.error("WebDAV Proxy Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

async function sendLLMRequest(
  provider: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 4096
): Promise<string> {
   let defBase = 'http://127.0.0.1:11434/v1';
   let defModel = 'llama3';
   switch(provider) {
     case 'openai': defBase = 'https://api.openai.com/v1'; defModel = 'gpt-4o-mini'; break;
     case 'deepseek': defBase = 'https://api.deepseek.com/v1'; defModel = 'deepseek-chat'; break;
     case 'siliconflow': defBase = 'https://api.siliconflow.cn/v1'; defModel = 'Qwen/Qwen2.5-7B-Instruct'; break;
     case 'volcengine': defBase = 'https://ark.cn-beijing.volces.com/api/v3'; defModel = 'doubao-seed-2-0-lite-260428'; break;
     case 'kimi': defBase = 'https://api.moonshot.cn/v1'; defModel = 'moonshot-v1-8k'; break;
     case 'zhipu': defBase = 'https://open.bigmodel.cn/api/paas/v4'; defModel = 'glm-4-flash'; break;
     case 'minimax': defBase = 'https://api.minimax.chat/v1'; defModel = 'abab6.5s-chat'; break;
     case 'mimo': defBase = 'https://ai.xiaomi.com/v1'; defModel = 'mimo-chat'; break;
     case 'anthropic': defBase = 'https://api.anthropic.com/v1'; defModel = 'claude-3-5-sonnet-latest'; break;
   }
   
   const baseStr = baseUrl || defBase;
   const actualModel = model || defModel;
   let apiUrl = '';
   const headers: Record<string, string> = {
      'Content-Type': 'application/json'
   };
   let bodyPayload: any;

   if (provider === 'anthropic') {
      apiUrl = baseStr.endsWith('/messages') ? baseStr : `${baseStr.replace(/\/$/, '')}/messages`;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      const cleanMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));

      bodyPayload = {
         model: actualModel,
         max_tokens: maxTokens,
         system: systemPrompt,
         messages: cleanMessages
      };
   } else {
      apiUrl = baseStr.endsWith('/chat/completions') ? baseStr : `${baseStr.replace(/\/$/, '')}/chat/completions`;
      headers['Authorization'] = `Bearer ${apiKey}`;
      const cleanMessages = [
         { role: 'system', content: systemPrompt },
         ...messages.map(m => ({
           role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
           content: m.content
         }))
      ];
      bodyPayload = {
         model: actualModel,
         messages: cleanMessages
      };
   }

   const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
   });

   if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errBody}`);
   }
   
   const data = await response.json();
   return provider === 'anthropic'
      ? data.content?.[0]?.text || ""
      : data.choices?.[0]?.message?.content || "";
}

export default app;
