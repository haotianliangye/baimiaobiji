/**
 * #010: MP3 流式调度器（AudioWorklet 处理器）。
 *
 * 与 pcm-player.js 的差异：
 *   - pcm-player: 直接收 Int16Array 样本 → ring buffer 排队 → 逐帧混音。
 *   - mp3-scheduler: 主线程用 audioCtx.decodeAudioData 解码 mp3 后，投递的是完整的
 *     AudioBuffer（解码过程在主线程，避免 worklet 里不支持 mp3 codec 的问题）。
 *
 * 协议（主 → worklet）：
 *   { type: 'decode', buffer: AudioBuffer }   // 已解码的 mp3 段
 *   { type: 'end' }                             // 流结束，buffer 排空后通知 finished
 *   { type: 'stop' }                            // 立即停止，清空队列
 *
 * 协议（worklet → 主）：
 *   { type: 'ready' }                           // 初始化完成（保留可观测点）
 *   { type: 'finished' }                        // buffer 已排空 + end 已收到
 *
 * 设计约束：
 *   - 单声道输出（与现有 pcm-player 行为一致；多声道 mp3 仅取 channel[0]）。
 *   - 队列排空但流未结束：本帧填 0，不发 underrun —— 等下一个 decode chunk 到达后接续。
 *   - decode 后 buffer.duration 视为 0 的会被丢弃（主线程 decode 失败的也会被丢弃）。
 */

class MP3SchedulerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** 待播放的 AudioBuffer 队列（FIFO） */
    this._queue = [];
    /** 当前正在播放的 AudioBuffer */
    this._current = null;
    /** 当前 buffer 已播放的帧数 */
    this._cursor = 0;
    /** 主线程已告知流结束（流结束后只是清空队列后听 finished） */
    this._ended = false;
    /** 主线程已告知停止（清队列 + 持续输出静音直到 dispose） */
    this._closed = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;
      if (msg.type === 'decode') {
        // msg.buffer: 已解码的 AudioBuffer
        if (msg.buffer && typeof msg.buffer.length === 'number' && msg.buffer.length > 0) {
          this._queue.push(msg.buffer);
        }
      } else if (msg.type === 'end') {
        this._ended = true;
      } else if (msg.type === 'stop') {
        this._closed = true;
        this._queue = [];
        this._current = null;
      }
    };
    this.port.postMessage({ type: 'ready' });
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const channel = out[0];
    const frames = channel.length;

    // 已关闭：保持静音，让主线程 dispose AudioContext
    if (this._closed) {
      channel.fill(0);
      return true;
    }

    // 默认静音（队列空时这一帧就是无声）
    channel.fill(0);

    // 当前没有正在播的 buffer → 从队列取
    if (!this._current && this._queue.length > 0) {
      this._current = this._queue.shift();
      this._cursor = 0;
    }

    if (this._current) {
      const remaining = this._current.length - this._cursor;
      const take = Math.min(remaining, frames);
      // 单声道：取 channel[0]。多声道 mp3 解码后 channel[0] 通常是主声道，够用。
      const src = this._current.getChannelData(0);
      for (let i = 0; i < take; i++) {
        channel[i] = src[this._cursor + i];
      }
      this._cursor += take;
      if (this._cursor >= this._current.length) {
        this._current = null;
        this._cursor = 0;
      }
      // take < frames 的部分保持 fill(0) 的静音（段尾短暂静音）
      return true;
    }

    // 队列空 + 已告知 end → 通知主线程可关闭 AudioContext
    if (this._ended) {
      this.port.postMessage({ type: 'finished' });
      return false; // 终止处理器
    }

    // 队列空但流未结束：保持静音，等下一段 decode 到达
    return true;
  }
}

registerProcessor('mp3-scheduler', MP3SchedulerProcessor);
