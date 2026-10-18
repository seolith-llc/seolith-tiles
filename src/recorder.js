// src/recorder.js
// Recordable Gameplay (Canvas 60fps Video Capture) & Mobile-First Viral Share Card Generator

export class SeolithRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
    this.lastVideoBlob = null;
    this.lastVideoUrl = null;
    this.mimeType = 'video/webm';
  }

  startRecording(audioCtx = null) {
    if (this.isRecording || !this.canvas || typeof this.canvas.captureStream !== 'function') {
      return false;
    }

    try {
      const stream = this.canvas.captureStream(60);
      const types = [
        'video/mp4;codecs=avc1',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      for (const t of types) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) {
          this.mimeType = t;
          break;
        }
      }

      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: 4_500_000,
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        if (this.chunks.length > 0) {
          this.lastVideoBlob = new Blob(this.chunks, { type: this.mimeType });
          if (this.lastVideoUrl) URL.revokeObjectURL(this.lastVideoUrl);
          this.lastVideoUrl = URL.createObjectURL(this.lastVideoBlob);
        }
      };

      this.mediaRecorder.start(250);
      this.isRecording = true;
      return true;
    } catch (err) {
      console.warn('Video recording not supported on this browser:', err);
      return false;
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        resolve(this.lastVideoBlob);
        return;
      }
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        if (this.chunks.length > 0) {
          this.lastVideoBlob = new Blob(this.chunks, { type: this.mimeType });
          if (this.lastVideoUrl) URL.revokeObjectURL(this.lastVideoUrl);
          this.lastVideoUrl = URL.createObjectURL(this.lastVideoBlob);
        }
        resolve(this.lastVideoBlob);
      };
      try {
        this.mediaRecorder.stop();
      } catch (_) {
        this.isRecording = false;
        resolve(null);
      }
    });
  }

  downloadLastVideo(levelName = 'seolith-tiles') {
    if (!this.lastVideoUrl) return false;
    const ext = this.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = this.lastVideoUrl;
    a.download = `${levelName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }

  // Generate a high-contrast shareable scorecard PNG Blob + mobile Web Share payload
  async generateShareCardBlob({ levelName, score, clearTimeSec, peakBalls, stars, locationLabel }) {
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1350;
    const ctx = c.getContext('2d');

    // Deep obsidian gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#090a10');
    grad.addColorStop(1, '#18181b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);

    // Draw snapshot of the live 3D game canvas in the center
    if (this.canvas) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 6;
      ctx.strokeRect(136, 220, 808, 760);
      ctx.drawImage(this.canvas, 140, 224, 800, 752);
      ctx.restore();
    }

    // Header
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 68px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SEOLITH TILES', 540, 110);

    ctx.fillStyle = '#fbbf24';
    ctx.font = '700 34px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${levelName}  •  ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, 540, 172);

    // Stats Footer
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `SCORE: ${score.toLocaleString()}   |   TIME: ${clearTimeSec}s`,
      540,
      1075
    );

    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 36px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      `PEAK CASCADE: ${peakBalls.toLocaleString()} BALLS   •   📍 ${locationLabel || 'Global'}`,
      540,
      1145
    );

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 30px system-ui, -apple-system, sans-serif';
    ctx.fillText('Play & break the record at seolith-tiles.seolith.workers.dev', 540, 1255);

    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  async shareRun({ levelName, score, clearTimeSec, peakBalls, stars, locationLabel }) {
    const shareUrl = window.location.origin;
    const shareText = `🧱 SEOLITH TILES — ${levelName}\n${'⭐'.repeat(stars)} Cleared in ${clearTimeSec}s!\n🏆 Score: ${score.toLocaleString()} pts (${peakBalls}x Ball Cascade)\n📍 ${locationLabel || 'Global'}\nCan you beat my time?`;

    try {
      const files = [];
      if (this.lastVideoBlob && this.lastVideoBlob.size < 25_000_000) {
        const ext = this.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const videoFile = new File([this.lastVideoBlob], `seolith-tiles-run.${ext}`, {
          type: this.mimeType,
        });
        if (navigator.canShare && navigator.canShare({ files: [videoFile] })) {
          files.push(videoFile);
        }
      }

      if (files.length === 0) {
        const cardBlob = await this.generateShareCardBlob({
          levelName,
          score,
          clearTimeSec,
          peakBalls,
          stars,
          locationLabel,
        });
        if (cardBlob) {
          const imgFile = new File([cardBlob], 'seolith-tiles-score.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [imgFile] })) {
            files.push(imgFile);
          }
        }
      }

      if (navigator.share) {
        await navigator.share({
          title: 'Seolith Tiles — Satisfying Micro-Brick Breaker',
          text: shareText,
          url: shareUrl,
          ...(files.length > 0 ? { files } : {}),
        });
        return { shared: true, method: 'native' };
      }
    } catch (_) {}

    // Fallback: copy rich text to clipboard
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      return { shared: true, method: 'clipboard' };
    } catch (_) {
      return { shared: false, method: 'none' };
    }
  }
}
