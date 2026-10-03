import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
let active = 0;
export async function transcodeToMp3(input: Buffer, signal?: AbortSignal, temporaryRoot = os.tmpdir()): Promise<Buffer<ArrayBuffer>> {
  if (input.byteLength > 50 * 1024 * 1024) throw new Error('Audio input exceeds byte limit');
  if (active >= 2) throw new Error('Audio conversion is busy');
  signal?.throwIfAborted();
  active++;
  let directory: string | undefined;
  try {
    directory = await fs.mkdtemp(path.join(temporaryRoot, 'baimiao-audio-'));
    const source = path.join(directory, 'input.webm');
    const output = path.join(directory, 'output.mp3');
    await fs.writeFile(source, input);
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(source, { timeout: 60 }).toFormat('mp3');
      const abort = () => command.kill('SIGKILL');
      const cleanup = () => signal?.removeEventListener('abort', abort);
      command.on('end', () => { cleanup(); resolve(); });
      command.on('error', error => { cleanup(); reject(error); });
      signal?.addEventListener('abort', abort, { once: true });
      command.on('start', () => { if (signal?.aborted) abort(); });
      command.save(output);
    });
    signal?.throwIfAborted();
    const stat = await fs.stat(output);
    if (stat.size > 50 * 1024 * 1024) throw new Error('Converted audio exceeds byte limit');
    return Buffer.from(await fs.readFile(output));
  } finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { active--; }
  }
}
