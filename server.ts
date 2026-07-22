import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import os from 'os';
import { fetchWithTimeout, FETCH_TIMEOUTS } from './src/lib/fetchWithTimeout';
import pkg from './package.json' with { type: 'json' };
import { evaluateTranscript, getDefaultPatterns, type HallucinationPattern } from './src/lib/hallucinationFilter';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function startServer() {
  const app = express();
  // Issue #002: 读 PORT 环境变量，让测试（4178）和生产部署灵活切换端口。
  // 缺省 3000 保持向后兼容。
  const PORT = parseInt(process.env.PORT || '3000', 10);
  
  app.use(express.json({ limit: '50mb' }));

  // DEBUG: TTS 请求观测中间件——只打日志、不改 body
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/tts')) {
      const body = req.body || {};
      console.log(`[TTS req] ${req.method} ${req.path} | text=${(body.text || '').length}ch provider=${body.settings?.provider} model=${body.settings?.model || 'default'} voice=${body.settings?.voice || ''} ua=${req.headers['user-agent']?.slice(0, 40)}`);
    }
    next();
  });

  // Build a GoogleGenAI client with base-URL normalization. Shared by every
  // endpoint that calls Gemini to avoid repeating the config dance.
  function buildGeminiClient(apiKey: string, baseUrl?: string) {
    const genAiConfig: any = { apiKey };
    let finalBaseUrl = baseUrl;
    if (finalBaseUrl === 'https://generativelanguage.googleapis.com/v1beta') {
      finalBaseUrl = 'https://generativelanguage.googleapis.com';
    }
    if (finalBaseUrl) {
      genAiConfig.httpOptions = { baseUrl: finalBaseUrl };
    }
    return new GoogleGenAI(genAiConfig);
  }

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

         const ai = buildGeminiClient(activeKey, baseUrl);

         let finalModel = model || 'gemini-3.1-flash-lite';

         const response = await ai.models.generateContent({
           model: finalModel,
           contents: promptContext,
         });
         diaryMarkdown = response.text || "";

         if (diaryMarkdown) {
           const summaryPromptStr = settings?.diarySummaryPrompt || `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
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
            const summaryPromptStr = settings?.diarySummaryPrompt || `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;
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
         
         const ai = buildGeminiClient(activeKey, baseUrl);
         
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
      if (!apiKey && provider !== 'custom') {
        return res.status(400).json({ error: 'API Key is required for embedding generation' });
      }

      let embedding: number[] = [];

      if (provider === 'gemini') {
        // Use @google/genai SDK for Gemini embedding
        const ai = buildGeminiClient(apiKey, baseUrl);
        const result = await ai.models.embedContent({
          model: embeddingModel || 'gemini-embedding-2',
          contents: text.trim(),
        });
        embedding = result.embeddings?.[0]?.values || [];
      } else {
        // OpenAI-compatible embedding endpoint (OpenAI, SiliconFlow, Volcengine, Zhipu, etc.)
        // NOTE: the canonical provider→config map lives in src/store/settings.store.ts
        // (DEFAULT_EMBED_PROVIDER_CONFIGS); this backend copy is only a fallback for
        // default baseUrl/model when the client omits them. Adding a provider requires
        // updating the frontend store too.
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

        const response = await fetchWithTimeout(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ input: text.trim(), model: actualModel }),
        }, FETCH_TIMEOUTS.embedding);

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

  // --- Test Connection endpoint ---
  app.post('/api/test-connection', async (req, res) => {
    try {
      const { type, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model } = settings || {};

      if (!apiKey && provider !== 'custom') {
        return res.status(400).json({ error: 'API Key 不能为空' });
      }

      if (type === 'chat') {
        if (provider === 'gemini') {
          const ai = buildGeminiClient(apiKey, baseUrl);
          const response = await ai.models.generateContent({
            model: model || 'gemini-3.1-flash-lite',
            contents: 'Say ok',
            config: {
              maxOutputTokens: 2
            }
          });
          if (response.text) {
            return res.json({ success: true });
          }
        } else {
          // OpenAI compatible chat completions
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
          }
          const apiBase = (baseUrl || '').replace(/\/$/, '');
          const response = await fetchWithTimeout(`${apiBase}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'Say ok' }],
              max_tokens: 2
            })
          }, FETCH_TIMEOUTS.testConnection);
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `HTTP ${response.status}`);
          }
          const data = await response.json();
          if (data.choices?.[0]?.message) {
            return res.json({ success: true });
          }
        }
      } else if (type === 'embed') {
        if (provider === 'gemini') {
          const ai = buildGeminiClient(apiKey, baseUrl);
          const result = await ai.models.embedContent({
            model: model || 'gemini-embedding-2',
            contents: 'test',
          });
          if (result.embeddings?.[0]?.values) {
            return res.json({ success: true });
          }
        } else {
          // OpenAI compatible embeddings
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
          }
          const apiBase = (baseUrl || '').replace(/\/$/, '');
          const response = await fetchWithTimeout(`${apiBase}/embeddings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model,
              input: 'test'
            })
          }, FETCH_TIMEOUTS.testConnection);
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `HTTP ${response.status}`);
          }
          const data = await response.json();
          if (data.data?.[0]?.embedding) {
            return res.json({ success: true });
          }
        }
      }

      throw new Error('测试连接响应异常');
    } catch (err: any) {
      console.error('Test connection error:', err);
      let cleanMsg = err.message || '';
      try {
        const parsed = JSON.parse(cleanMsg);
        if (parsed.error?.message) cleanMsg = parsed.error.message;
      } catch(e){}
      res.status(500).json({ error: cleanMsg || '测试连接失败，请检查网络或配置' });
    }
  });

  app.post('/api/generate-insights', async (req, res) => {
    try {
      const { logs, timeRange, timeRangeLabel, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, insightPrompt, insightSummaryPrompt } = settings || {};
      
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
         
         const ai = buildGeminiClient(activeKey, baseUrl);
         
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

      let summaryMarkdown = "";
      if (insightMarkdown) {
        const summaryPromptStr = insightSummaryPrompt || `你是一个用于生成一句话洞察摘要的助手。请根据提供的洞察报告文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
        try {
          if (provider === 'gemini') {
            const ai = buildGeminiClient(apiKey, baseUrl);
            const finalModel = model || 'gemini-3.1-flash-lite';
            const summaryResponse = await ai.models.generateContent({
              model: finalModel,
              contents: `${summaryPromptStr}\n\nInsight Report:\n${insightMarkdown}`,
            });
            summaryMarkdown = summaryResponse.text || "";
          } else {
            summaryMarkdown = await sendLLMRequest(
              provider,
              baseUrl,
              apiKey,
              model,
              summaryPromptStr,
              [{ role: "user", content: `Insight Report:\n${insightMarkdown}` }],
              1024
            );
          }
        } catch (err) {
          console.error("Failed to generate insight summary:", err);
        }
      }

      res.json({ report: insightMarkdown, ai_summary: summaryMarkdown });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // #8 洞察生成端点：一次调用同时产出「明悟」与「洞察」两类报告。
  // 数据源 = raw_logs + thoughts；按 settings.submitMultimedia 决定是否提交多媒体摘要。
  // 返回 mingwu_report/mingwu_summary + insight_report/insight_summary。
  app.post('/api/generate-insight', async (req, res) => {
    try {
      const { logs, thoughts, timeRangeLabel, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, mingwuPrompt, insightPrompt, insightSummaryPrompt } = settings || {};

      const defaultMingwuPrompt = `你是一位兼具东方哲学智慧与现代心理学素养的「明悟」导师。请审视用户一段时间内的记录与沉淀，超越表层行为与情绪，直抵生命深层脉络，产出一份通透、克制、富有启悟力量的明悟报告。`;
      const defaultInsightPrompt = `You are a productivity and life coach assistant. Based on the user's activity logs and diaries, provide deep insights into their routines, highlighting positive trends, areas for potential improvement, and actionable suggestions to enhance well-being and productivity.`;

      const logsSection = (logs || []).map((l: any) => `- [${l.date}] (ID: ${l.id}): ${l.content}${l.attachment_summary ? `\n  [附件摘要] ${l.attachment_summary}` : ''}`).join('\n');
      const thoughtsSection = (thoughts || []).map((t: any) => `- [${t.date}] (ID: ${t.id}): ${t.content}`).join('\n');

      // 明悟上下文
      const mingwuContext = `${mingwuPrompt || defaultMingwuPrompt}

Context:
- Analysis Time Range: ${timeRangeLabel}
- Logs count: ${(logs || []).length}
- Thoughts count: ${(thoughts || []).length}

Raw Logs:
${logsSection || '（无拾微记录）'}

Thoughts (沉淀):
${thoughtsSection || '（无沉淀笔记）'}

请用清晰克制的 Markdown 格式输出你的明悟报告。可在文中以 #标签 形式标注浮现的关键生命主题。`;

      // 洞察上下文
      const insightContext = `${insightPrompt || defaultInsightPrompt}

Context:
- Analysis Time Range: ${timeRangeLabel}
- Logs count: ${(logs || []).length}
- Thoughts count: ${(thoughts || []).length}

Raw Logs:
${logsSection || '（无拾微记录）'}

Thoughts (沉淀):
${thoughtsSection || '（无沉淀笔记）'}

Output your insights in a clear, well-structured Markdown format. Group your insights logically (e.g., Summary, Key Trends, Actionable Advice).
`;

      let mingwuMarkdown = "";
      let insightMarkdown = "";

      if (provider === 'gemini') {
        const activeKey = apiKey;
        if (!activeKey) {
          return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
        }
        const ai = buildGeminiClient(activeKey, baseUrl);
        const finalModel = model || 'gemini-3.1-flash-lite';

        const mingwuResponse = await ai.models.generateContent({
          model: finalModel,
          contents: mingwuContext,
        });
        mingwuMarkdown = mingwuResponse.text || "";

        const insightResponse = await ai.models.generateContent({
          model: finalModel,
          contents: insightContext,
        });
        insightMarkdown = insightResponse.text || "";
      } else {
        mingwuMarkdown = await sendLLMRequest(
          provider, baseUrl, apiKey, model,
          "You output well-formatted Markdown text.",
          [{ role: "user", content: mingwuContext }]
        );
        insightMarkdown = await sendLLMRequest(
          provider, baseUrl, apiKey, model,
          "You output well-formatted Markdown text.",
          [{ role: "user", content: insightContext }]
        );
      }

      // 生成两份摘要
      const summaryPromptStr = insightSummaryPrompt || `你是一个用于生成一句话摘要的助手。请根据提供的文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
      let mingwuSummary = "";
      let insightSummary = "";

      if (mingwuMarkdown) {
        try {
          if (provider === 'gemini') {
            const ai = buildGeminiClient(apiKey, baseUrl);
            const finalModel = model || 'gemini-3.1-flash-lite';
            const summaryResponse = await ai.models.generateContent({
              model: finalModel,
              contents: `${summaryPromptStr}\n\nReport:\n${mingwuMarkdown}`,
            });
            mingwuSummary = summaryResponse.text || "";
          } else {
            mingwuSummary = await sendLLMRequest(
              provider, baseUrl, apiKey, model,
              summaryPromptStr,
              [{ role: "user", content: `Report:\n${mingwuMarkdown}` }],
              1024
            );
          }
        } catch (err) {
          console.error("Failed to generate mingwu summary:", err);
        }
      }

      if (insightMarkdown) {
        try {
          if (provider === 'gemini') {
            const ai = buildGeminiClient(apiKey, baseUrl);
            const finalModel = model || 'gemini-3.1-flash-lite';
            const summaryResponse = await ai.models.generateContent({
              model: finalModel,
              contents: `${summaryPromptStr}\n\nInsight Report:\n${insightMarkdown}`,
            });
            insightSummary = summaryResponse.text || "";
          } else {
            insightSummary = await sendLLMRequest(
              provider, baseUrl, apiKey, model,
              summaryPromptStr,
              [{ role: "user", content: `Insight Report:\n${insightMarkdown}` }],
              1024
            );
          }
        } catch (err) {
          console.error("Failed to generate insight summary:", err);
        }
      }

      res.json({
        mingwu_report: mingwuMarkdown,
        mingwu_summary: mingwuSummary,
        insight_report: insightMarkdown,
        insight_summary: insightSummary,
      });
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
         
         const ai = buildGeminiClient(activeKey, baseUrl);
         
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

  app.post('/api/copilot-chat', async (req, res) => {
    const { contextContent } = req.body;
    const systemPrompt = `你是「白描 Copilot」，用户的个人反思与记录助手。以下是通过本地向量检索到的、与用户问题最相关的历史记录片段（每条带有一个 ID）：

${contextContent || '（本次未检索到相关片段）'}

回答规则：
1. 基于上述片段回答用户问题，保持客观、有同理心、有洞察力。
2. 每当你提及源于某条特定片段的事件或细节时，必须添加指向该片段 ID 的 Markdown 链接，格式严格为：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[那天跑了五公里](#log_id_12345-abcde)。
3. 如果未提供相关片段或片段与问题无关，可基于对话历史正常回答，但应说明当前未检索到强相关记录。
4. 使用 Markdown 格式输出，用中文回答。`;
    await processChatRequest(req, res, systemPrompt);
  });

  // #9 LLM Chat: 通用对话端点，不走 RAG 上下文，直接转发给 LLM。
  // 复用 processChatRequest 的 Gemini / OpenAI-compatible 调用逻辑。
  // 请求体与 /api/copilot-chat 一致（chatHistory + userMessage + settings），
  // contextContent 字段可被忽略。
  app.post('/api/chat', async (req, res) => {
    const systemPrompt = `你是「白描」的通用 AI 助手。你可以与用户自由对话，回答问题、提供建议、进行创作。请使用 Markdown 格式输出，用中文回答。`;
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
         
         const ai = buildGeminiClient(activeKey, baseUrl);
         
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
         // Issue #004: 用 evaluateTranscript 替代硬编码黑名单
         // 前端可在请求体里传 patterns；如果没传或为空，用金标准兜底
         // medium/low 时也保留文本，由前端在 UI 层用本地 patterns 二次评估（不污染后端响应）
         const requestPatterns: HallucinationPattern[] = Array.isArray(req.body?.patterns) && req.body.patterns.length > 0
           ? req.body.patterns
           : getDefaultPatterns().map((d, i) => ({ ...d, created_at: Date.now() + i } as HallucinationPattern));
         const evalResult = evaluateTranscript(transcript, requestPatterns);
         if (evalResult.dropped) {
           if (provider !== 'volcengine') {
             transcript = "";
             console.log('[transcribe] dropped hallucination:', evalResult.reason);
           }
         } else if (evalResult.confidence) {
           // medium/low：保留文本，但服务端记录日志供调试
           console.log('[transcribe] low-confidence transcript:', evalResult.confidence, evalResult.reason);
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
         
         const fetchRes = await fetchWithTimeout(apiUrl, {
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
         }, FETCH_TIMEOUTS.transcribe);

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
         
         const fetchRes = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: {
               'Authorization': `Bearer ${apiKey}`
            },
            body: formData
         }, FETCH_TIMEOUTS.transcribe);

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

  // #6 多媒体摘要：用 Gemini 多模态模型对图片/视频生成文本摘要。
  // 音频附件走 /api/transcribe，不经过此端点。读 GOOGLE_API_KEY 环境变量作为后备。
  app.post('/api/multimedia-summarize', async (req, res) => {
    try {
      const { file_base64, mime_type, kind, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model } = settings || {};

      if (!file_base64 || !mime_type) {
        return res.status(400).json({ error: 'Missing file data or mime type' });
      }

      let summary = '';

      if (provider === 'gemini') {
        const activeKey = apiKey || process.env.GOOGLE_API_KEY;
        if (!activeKey) {
          return res.status(500).json({ error: '请在设置页面中配置你的 Gemini API Key' });
        }

        const ai = buildGeminiClient(activeKey, baseUrl);
        const finalModel = model || 'gemini-3.1-flash-lite';
        const cleanMimeType = mime_type.split(';')[0];
        const kindLabel = kind === 'video' ? '视频' : '图片';
        const response = await ai.models.generateContent({
          model: finalModel,
          contents: [
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: file_base64,
              },
            },
            {
              text: `请用简练的中文描述这个${kindLabel}的内容，包括场景、物体、人物动作、文字信息等关键要素，生成一段100字以内的摘要。`,
            },
          ],
          config: {
            temperature: 0.3,
            systemInstruction: '你是一个多媒体内容描述助手。请根据提供的图片或视频，用简练准确的中文描述其内容，生成100字以内的摘要。',
          },
        });
        summary = response.text || '';
      } else {
        // 非 Gemini 提供商：多模态支持有限，返回占位提示
        summary = `[多媒体摘要仅支持 Gemini 提供商，当前为 ${provider}]`;
      }

      res.json({ summary: summary.trim() });
    } catch (err: any) {
      console.error('Multimedia summarize error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // #009 TTS 外部 API：接收 { text, lang, settings }，按 settings.provider 调 Gemini / 火山引擎，
  // 返回音频 blob（Gemini 返回 audio/wav，火山引擎返回 audio/mp3）。Web Speech 仍由前端直出，不走此端点。
  function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
  }

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, voice, rate } = settings || {};

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required and must not be empty' });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'API Key 不能为空' });
      }

      if (provider === 'gemini') {
        const ai = buildGeminiClient(apiKey, baseUrl);
        const finalModel = model || 'gemini-2.5-flash-preview-tts';
        const genConfig: any = { responseModalities: ['AUDIO'] };
        if (voice) {
          genConfig.speechConfig = {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
          };
        }
        const response = await ai.models.generateContent({
          model: finalModel,
          contents: [{ parts: [{ text }] }],
          config: genConfig,
        });
        const parts = response.candidates?.[0]?.content?.parts || [];
        const audioPart: any = parts.find((p: any) => p.inlineData);
        if (!audioPart?.inlineData?.data) {
          throw new Error('Gemini TTS 未返回音频数据');
        }
        // Gemini TTS 返回 PCM L16（24kHz / 16-bit / mono），包装为 WAV 供浏览器播放。
        const pcmBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
        res.set('Content-Type', 'audio/wav');
        return res.send(wavBuffer);
      }

      if (provider === 'volcengine') {
        // 火山引擎语音合成 HTTP API（openspeech）。
        // apiKey 约定为 "appid:access_token"；model = voice_type（如 BV001_streaming）；rate 映射为 speed_ratio。
        const sep = apiKey.indexOf(':');
        const appid = sep > 0 ? apiKey.slice(0, sep) : '';
        const accessToken = sep > 0 ? apiKey.slice(sep + 1) : apiKey;
        if (!appid) {
          return res.status(400).json({ error: '火山引擎 TTS 的 API Key 需为 "appid:access_token" 格式' });
        }
        const apiBase = (baseUrl || 'https://openspeech.bytedance.com').replace(/\/$/, '');
        const apiUrl = `${apiBase}/api/v1/tts`;
        const voiceType = model || 'BV001_streaming';
        const speedRatio = typeof rate === 'number' && rate > 0 ? rate : 1;
        const reqid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const fetchRes = await fetchWithTimeout(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer;${accessToken}`,
          },
          body: JSON.stringify({
            app: { appid, token: accessToken, cluster: 'volcano_tts' },
            user: { uid: 'baimiao' },
            audio: { voice_type: voiceType, encoding: 'mp3', speed_ratio: speedRatio },
            request: { reqid, text, operation: 'query' },
          }),
        }, FETCH_TIMEOUTS.tts);
        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          throw new Error(`火山引擎 TTS 错误: ${fetchRes.status} ${errText}`);
        }
        const data = await fetchRes.json();
        if (data.code !== 3000 || !data.data) {
          throw new Error(`火山引擎 TTS 失败: ${data.code} ${data.message || ''}`);
        }
        const mp3Buffer = Buffer.from(data.data, 'base64');
        res.set('Content-Type', 'audio/mp3');
        return res.send(mp3Buffer);
      }

      return res.status(400).json({ error: `不支持的 TTS Provider: ${provider}` });
    } catch (err: any) {
      console.error('TTS error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // #009-ext: 流式 TTS（SSE）。与 api/index.ts 同步双写（本地 dev/prod 跑的是 server.ts，Vercel 跑 api/index.ts）。
  // 后端用 Gemini generateContentStream 逐 chunk 拿 PCM，前端用 AudioWorklet 边收边播。
  // 协议：首条事件 { event: "config", sampleRate, channels, bitsPerSample }，
  //      中间事件 { event: "audio", data: "<base64 PCM chunk>" }，
  //      结束 { event: "end" } / 错误 { event: "error", message }。
  // 仅 Gemini 支持流式；火山引擎走上面 /api/tts 整段方案。
  app.post('/api/tts/stream', async (req, res) => {
    const t0 = Date.now();
    try {
      const { text, settings } = req.body;
      const { provider = 'gemini', apiKey, baseUrl, model, voice } = settings || {};

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required and must not be empty' });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'API Key 不能为空' });
      }
      if (provider !== 'gemini') {
        return res.status(400).json({ error: `流式 TTS 暂不支持 ${provider}，请改用 Gemini 或非流式 /api/tts` });
      }

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const writeEvent = (obj: any) => {
        // 必须立即 flush，否则 Node 默认会 buffer SSE 数据，
        // 浏览器端要等 buffer 满了才收到首字节 —— 这就是用户看到的"等很久"
        const ok = res.write(`data: ${JSON.stringify(obj)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
        return ok;
      };

      const ai = buildGeminiClient(apiKey, baseUrl);
      const finalModel = model || 'gemini-2.5-flash-preview-tts';
      const genConfig: any = { responseModalities: ['AUDIO'] };
      if (voice) {
        genConfig.speechConfig = {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        };
      }

      writeEvent({ event: 'config', sampleRate: 24000, channels: 1, bitsPerSample: 16 });

      const stream = await ai.models.generateContentStream({
        model: finalModel,
        contents: [{ parts: [{ text }] }],
        config: genConfig,
      });

      let chunkCount = 0;
      let totalBytes = 0;
      const t1 = Date.now();

      for await (const chunk of stream as any) {
        const parts = chunk?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p?.inlineData?.data) {
            chunkCount++;
            totalBytes += p.inlineData.data.length;
            writeEvent({ event: 'audio', data: p.inlineData.data });
          }
        }
      }

      const t2 = Date.now();
      writeEvent({ event: 'end', stats: { chunks: chunkCount, totalBase64Chars: totalBytes, upstreamMs: t2 - t1, totalMs: t2 - t0 } });
      res.end();
      console.log(`[TTS stream gemini] text=${text.length}ch model=${finalModel} | upstream=${t2 - t1}ms total=${t2 - t0}ms | chunks=${chunkCount} base64Chars=${totalBytes}`);
    } catch (err: any) {
      console.error('TTS stream error:', err);
      try {
        res.write(`data: ${JSON.stringify({ event: 'error', message: err.message })}\n\n`);
        res.end();
      } catch {
        /* connection already closed */
      }
    }
  });

  // DEBUG: 伪流式 TTS 端点（不调 Gemini）。发一个 440Hz 正弦波，分 20 段发出去，
  // 用于验证前端 SSE + AudioWorklet 链路到底有没有问题。
  // 如果这个能秒出声，就证明前端 OK，问题在 Gemini。
  app.post('/api/tts/test-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (obj: any) => {
      const ok = res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
      return ok;
    };

    const sampleRate = 24000;
    const durationSec = 3;
    const totalSamples = sampleRate * durationSec;
    const chunkCount = 20;
    const samplesPerChunk = totalSamples / chunkCount;
    const freq = 440;

    writeEvent({ event: 'config', sampleRate, channels: 1, bitsPerSample: 16 });

    for (let c = 0; c < chunkCount; c++) {
      const pcm = Buffer.alloc(samplesPerChunk * 2);
      for (let i = 0; i < samplesPerChunk; i++) {
        const sampleIdx = c * samplesPerChunk + i;
        const t = sampleIdx / sampleRate;
        const v = Math.sin(2 * Math.PI * freq * t) * 0.3 * 32767;
        pcm.writeInt16LE(Math.round(v), i * 2);
      }
      writeEvent({ event: 'audio', data: pcm.toString('base64') });
      // 每段间隔 100ms，模拟 Gemini 流式节奏
      await new Promise((r) => setTimeout(r, 100));
    }

    writeEvent({ event: 'end', stats: { chunks: chunkCount } });
    res.end();
    console.log('[TTS test-stream] done');
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

      const response = await fetchWithTimeout(url, {
        method,
        headers: requestHeaders,
        body: requestBody
      }, FETCH_TIMEOUTS.webdav);

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

  // Vite middleware for development
  // Health check endpoint — used by /api/health probes (e.g. uptime monitoring)
  // and to detect whether the local Express proxy is reachable from mobile PWA.
  // Issue #002: added alongside server timeout work.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: process.uptime(),
      version: pkg.version,
      timestamp: Date.now(),
    });
  });

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

  // Bind to loopback by default to prevent SSRF / unauthenticated LAN access to the
  // local AI-proxy endpoints (test-connection, generate-embedding fetch attacker-supplied URLs).
  // Set HOST=0.0.0.0 env var to allow LAN access (e.g. mobile PWA hitting this server).
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://localhost:${PORT}` + (HOST === '0.0.0.0' ? ' (LAN accessible)' : ' (loopback only)'));
  });
}

startServer();

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

   const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
   }, FETCH_TIMEOUTS.llm);

   if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errBody}`);
   }
   
   const data = await response.json();
   return provider === 'anthropic'
      ? data.content?.[0]?.text || ""
      : data.choices?.[0]?.message?.content || "";
}
