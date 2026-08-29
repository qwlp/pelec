import type { TelegramCallVideoFrame } from '../../../shared/connectors';

type RendererState = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  textures: [WebGLTexture, WebGLTexture, WebGLTexture];
};

const rendererByCanvas = new WeakMap<HTMLCanvasElement, RendererState>();

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create Telegram call video shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Telegram call video shader failed.');
  }
  return shader;
};

const createRenderer = (canvas: HTMLCanvasElement): RendererState | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  const vertex = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 position;
    out vec2 uv;
    void main() {
      uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
      gl_Position = vec4(position, 0.0, 1.0);
    }`,
  );
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision mediump float;
    in vec2 uv;
    uniform sampler2D yPlane;
    uniform sampler2D uPlane;
    uniform sampler2D vPlane;
    out vec4 color;
    void main() {
      float y = texture(yPlane, uv).r;
      float u = texture(uPlane, uv).r - 0.5;
      float v = texture(vPlane, uv).r - 0.5;
      color = vec4(
        y + 1.402 * v,
        y - 0.344136 * u - 0.714136 * v,
        y + 1.772 * u,
        1.0
      );
    }`,
  );
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const textures = [0, 1, 2].map((unit) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to create Telegram call video texture.');
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }) as [WebGLTexture, WebGLTexture, WebGLTexture];
  gl.uniform1i(gl.getUniformLocation(program, 'yPlane'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uPlane'), 1);
  gl.uniform1i(gl.getUniformLocation(program, 'vPlane'), 2);
  return { gl, program, textures };
};

export const renderI420Frame = (
  canvas: HTMLCanvasElement,
  frame: TelegramCallVideoFrame,
): void => {
  const state = rendererByCanvas.get(canvas) ?? createRenderer(canvas);
  if (!state) return;
  rendererByCanvas.set(canvas, state);

  const { gl, program, textures } = state;
  const ySize = frame.width * frame.height;
  const chromaWidth = frame.width / 2;
  const chromaHeight = frame.height / 2;
  const chromaSize = chromaWidth * chromaHeight;
  if (frame.data.byteLength !== ySize + chromaSize * 2) return;

  canvas.width = frame.width;
  canvas.height = frame.height;
  gl.viewport(0, 0, frame.width, frame.height);
  gl.useProgram(program);
  const planes = [
    { width: frame.width, height: frame.height, data: frame.data.subarray(0, ySize) },
    {
      width: chromaWidth,
      height: chromaHeight,
      data: frame.data.subarray(ySize, ySize + chromaSize),
    },
    {
      width: chromaWidth,
      height: chromaHeight,
      data: frame.data.subarray(ySize + chromaSize),
    },
  ];
  planes.forEach((plane, index) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, textures[index]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      plane.width,
      plane.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      plane.data,
    );
  });
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};
