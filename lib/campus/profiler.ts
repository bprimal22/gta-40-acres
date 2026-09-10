// Read-only diagnostic timings. GPU samples are asynchronous and optional;
// unsupported or disjoint results are never reported as zero-cost rendering.
export class FrameProfiler {
  cpu: number[] = [];
  gpu: number[] = [];
  private query: WebGLQuery | null = null;
  private queryStartFrame: number | null = null;
  private gpuSampleFrames: number[] = [];
  private validGpuSamplesTotal = 0;
  private gpuDisjointCount = 0;
  private running = false;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin(frame: number) {
    const { gl, ext } = this;
    if (!ext) return;
    if (this.query) {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ready = gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE);
      if (disjoint) {
        this.gpu = [];
        this.gpuSampleFrames = [];
        this.gpuDisjointCount++;
      }
      if (ready && !disjoint) {
        this.gpu.push(gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6);
        this.gpuSampleFrames.push(this.queryStartFrame!);
        this.validGpuSamplesTotal++;
        if (this.gpu.length > 120) {
          this.gpu.shift();
          this.gpuSampleFrames.shift();
        }
      }
      if (ready || disjoint) {
        gl.deleteQuery(this.query);
        this.query = null;
        this.queryStartFrame = null;
      }
    }
    if (!this.query && frame % 20 === 0) {
      this.query = gl.createQuery();
      if (this.query) {
        this.queryStartFrame = frame;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query);
        this.running = true;
      }
    }
  }
  end(cpuMs: number) {
    if (this.running && this.ext) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.running = false;
    }
    this.cpu.push(cpuMs);
    if (this.cpu.length > 600) this.cpu.shift();
  }
  snapshot() {
    const summary = (values: number[]) => {
      const s = [...values].sort((a, b) => a - b);
      return s.length
        ? {
            median: s[Math.floor(s.length * 0.5)],
            p95: s[Math.floor(s.length * 0.95)],
            sampleCount: s.length,
          }
        : null;
    };
    return {
      cpuFrameMs: summary(this.cpu),
      gpuRenderMs: summary(this.gpu),
      gpuTimerSupported: !!this.ext,
      // Query-start frames identify which rendered poses the retained timings
      // belong to. Lifetime count lets read-only diagnostics await fresh data.
      gpuSampling: {
        validSamplesTotal: this.validGpuSamplesTotal,
        retainedSamples: this.gpuSampleFrames.length,
        firstRenderFrame: this.gpuSampleFrames[0] ?? null,
        lastRenderFrame: this.gpuSampleFrames.at(-1) ?? null,
        pendingStartFrame: this.queryStartFrame,
        disjointCount: this.gpuDisjointCount,
      },
    };
  }
  dispose() {
    if (this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    this.queryStartFrame = null;
  }
}
