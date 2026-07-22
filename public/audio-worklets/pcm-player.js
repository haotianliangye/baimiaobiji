/**
 * #009-ext: PCM 流式播放器（AudioWorklet 处理器）。
 *
 * 工作方式：
 *   主线程把后端 SSE 收到的每个 base64 PCM chunk 转成 Int16Array 后通过 port.postMessage 投递过来。
 *   我们把这些样本塞进一个 ring buffer；每个 render quantum（128 帧）从 buffer 头部取出对应声道数样本写入 output。
 *
 * 设计要点：
 *   - 单声道（Gemini TTS 输出固定 mono 24kHz/16bit）。
 *   - 静音/欠载时输出 0，避免爆音；输出端检测到欠载会自动等待下一个 chunk。
 *   - 主线程调用 closePlayback() 会把 underrun 状态保留但停止主动读 buffer，
 *     等主线程 disposeAudioContext() 时彻底释放。
 */

class PCMRingBuffer {
  constructor() {
    this._chunks = []; // Float32Array[]
    this._len = 0;
    this._readIdx = 0; // 当前 chunk 内已读取到的样本索引
  }

  push(samples) {
    if (samples && samples.length) {
      this._chunks.push(samples);
      this._len += samples.length;
    }
  }

  /** 取出最多 n 个样本（不会跨 chunk 切分） */
  drain(n) {
    const out = new Float32Array(n);
    let written = 0;
    while (written < n && this._chunks.length > 0) {
      const head = this._chunks[0];
      const remainingInHead = head.length - this._readIdx;
      const need = n - written;
      if (remainingInHead <= need) {
        out.set(head.subarray(this._readIdx), written);
        written += remainingInHead;
        this._chunks.shift();
        this._readIdx = 0;
      } else {
        out.set(head.subarray(this._readIdx, this._readIdx + need), written);
        this._readIdx += need;
        written += need;
      }
    }
    this._len -= written;
    return out;
  }

  size() {
    return this._len;
  }

  clear() {
    this._chunks = [];
    this._len = 0;
    this._readIdx = 0;
  }
}

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new PCMRingBuffer();
    this._closed = false;
    this._ended = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;
      if (msg.type === 'samples') {
        // msg.samples: Int16Array（或 { data: ArrayBuffer }）
        const i16 = msg.samples instanceof Int16Array
          ? msg.samples
          : new Int16Array(msg.samples);
        const f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) {
          // 16-bit PCM [-32768, 32767] -> Float32 [-1, 1]
          f32[i] = i16[i] < 0 ? i16[i] / 32768 : i16[i] / 32767;
        }
        this._buffer.push(f32);
        if (this._underrunNotified && this._buffer.size() > sampleRate * 0.1) {
          this.port.postMessage({ type: 'resumed' });
          this._underrunNotified = false;
        }
      } else if (msg.type === 'end') {
        this._ended = true;
      } else if (msg.type === 'stop') {
        this._closed = true;
        this._buffer.clear();
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const channel = out[0];
    const frames = channel.length;
    const available = this._buffer.size();

    if (this._closed) {
      // 已停止：输出静音并保持处理器存活到主线程 dispose
      channel.fill(0);
      return true;
    }

    if (available === 0) {
      channel.fill(0);
      if (this._ended) {
        // 流结束 + buffer 已空 -> 通知主线程可以销毁 AudioContext
        this.port.postMessage({ type: 'finished' });
        return false; // 终止处理器
      }
      // 还没收到样本，主线程稍后会通知 resumed。这里没必要发欠载，
      // 因为流式播放首批样本到达前都会 fill(0)。
      return true;
    }

    const take = Math.min(available, frames);
    const drained = this._buffer.drain(take);
    for (let i = 0; i < take; i++) channel[i] = drained[i];
    // 欠载：剩余 frames 填 0
    if (take < frames) {
      channel.fill(0, take);
    }
    // 如果 buffer 已耗尽但流还没结束，记下欠载状态，下次有 chunk 进来时通知
    if (this._buffer.size() === 0 && !this._ended) {
      this._underrunNotified = true;
      this.port.postMessage({ type: 'underrun' });
    }
    return true;
  }
}

registerProcessor('pcm-player', PCMPlayerProcessor);