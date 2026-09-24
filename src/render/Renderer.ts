import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AtmospherePass } from './AtmospherePass';
import { settings } from '../core/Settings';

const finalFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform float uExposure;
uniform float uSaturation;
uniform float uVignette;
uniform float uTime;
uniform float uGrain;
uniform float uAberration;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uDamage;
uniform float uFade;
uniform vec3 uLift;
uniform vec3 uGain;
varying vec2 vUv;

vec3 aces(vec3 x) {
  // Narkowicz ACES fit, with a slightly lifted toe for a filmic look
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  vec3 col;
  if (uAberration > 0.0) {
    vec2 off = dc * uAberration * 0.012;
    col.r = texture2D(tColor, uv + off).r;
    col.g = texture2D(tColor, uv).g;
    col.b = texture2D(tColor, uv - off).b;
  } else {
    col = texture2D(tColor, uv).rgb;
  }
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = col * uGain + uLift * (1.0 - col);
  float v = smoothstep(0.85, 0.2, length(dc * vec2(1.0, 0.8)));
  col *= mix(1.0, v, uVignette);
  // damage vignette
  float edge = smoothstep(0.25, 0.75, length(dc));
  col = mix(col, vec3(0.6, 0.02, 0.02), uDamage * edge);
  col = toSRGB(col);
  col += (hash(uv * 1000.0 + uTime) - 0.5) * uGrain;
  col = mix(col, uFlashColor, uFlash);
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

const fxaaFrag = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uInv;
varying vec2 vUv;
// compact FXAA 3.11-style edge blur
void main() {
  vec3 rgbNW = texture2D(tColor, vUv + vec2(-1.0, -1.0) * uInv).rgb;
  vec3 rgbNE = texture2D(tColor, vUv + vec2(1.0, -1.0) * uInv).rgb;
  vec3 rgbSW = texture2D(tColor, vUv + vec2(-1.0, 1.0) * uInv).rgb;
  vec3 rgbSE = texture2D(tColor, vUv + vec2(1.0, 1.0) * uInv).rgb;
  vec3 rgbM = texture2D(tColor, vUv).rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lumaNW = dot(rgbNW, luma), lumaNE = dot(rgbNE, luma), lumaSW = dot(rgbSW, luma), lumaSE = dot(rgbSE, luma), lumaM = dot(rgbM, luma);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  vec2 dir = vec2(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), ((lumaNW + lumaSW) - (lumaNE + lumaSE)));
  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * uInv;
  vec3 rgbA = 0.5 * (texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tColor, vUv + dir * -0.5).rgb + texture2D(tColor, vUv + dir * 0.5).rgb);
  float lumaB = dot(rgbB, luma);
  gl_FragColor = vec4((lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB, 1.0);
}`;

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Owns the WebGL renderer and the HDR post-processing chain:
 *   scene (HDR + log depth) → atmosphere scattering → bloom → grade/tonemap → FXAA
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly atmosphere = new AtmospherePass();
  private hdr!: THREE.WebGLRenderTarget;
  private post!: THREE.WebGLRenderTarget;
  private ldr!: THREE.WebGLRenderTarget;
  private bloom: UnrealBloomPass;
  private finalQuad: FullScreenQuad;
  private fxaaQuad: FullScreenQuad;
  readonly finalMat: THREE.ShaderMaterial;
  private fxaaMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  /** Extra scene rendered on top without post (e.g. galaxy map). */
  overlayScene: THREE.Scene | null = null;
  overlayCamera: THREE.Camera | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = settings.data.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(settings.data.fov, 1, 0.08, 5e8);
    this.scene.add(this.camera);
    this.scene.matrixWorldAutoUpdate = true;

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.92);
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: finalFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        uExposure: { value: 1.0 },
        uSaturation: { value: 1.08 },
        uVignette: { value: 0.35 },
        uTime: { value: 0 },
        uGrain: { value: 0.025 },
        uAberration: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: 0 },
        uDamage: { value: 0 },
        uFade: { value: 0 },
        uLift: { value: new THREE.Vector3(0.012, 0.014, 0.024) },
        uGain: { value: new THREE.Vector3(1.0, 0.99, 0.98) },
      },
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
    this.fxaaMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: fxaaFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: { tColor: { value: null }, uInv: { value: new THREE.Vector2() } },
    });
    this.fxaaQuad = new FullScreenQuad(this.fxaaMat);
    this.createTargets();
    window.addEventListener('resize', () => this.resize());
    settings.onChange((s) => {
      this.renderer.shadowMap.enabled = s.shadows;
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
      this.resize();
    });
    this.resize();
  }

  private createTargets(): void {
    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    };
    this.hdr = new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true });
    this.hdr.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.hdr.depthTexture.format = THREE.DepthFormat;
    this.post = new THREE.WebGLRenderTarget(1, 1, opts);
    this.ldr = new THREE.WebGLRenderTarget(1, 1, { ...opts, type: THREE.UnsignedByteType });
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = settings.data.renderScale * Math.min(window.devicePixelRatio || 1, 1.5);
    this.width = Math.max(1, Math.floor(w * scale));
    this.height = Math.max(1, Math.floor(h * scale));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.renderer.setDrawingBufferSize(w, h, 1);
    this.hdr.setSize(this.width, this.height);
    this.post.setSize(this.width, this.height);
    this.ldr.setSize(this.width, this.height);
    this.bloom.setSize(this.width, this.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fxaaMat.uniforms.uInv.value.set(1 / this.width, 1 / this.height);
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  render(time: number): void {
    const r = this.renderer;
    r.info.reset();
    this.finalMat.uniforms.uTime.value = time % 100;
    this.camera.updateMatrixWorld();

    r.setRenderTarget(this.hdr);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);

    this.atmosphere.render(r, this.camera, this.hdr, this.post, settings.data.atmosphereSteps);

    if (settings.data.bloom) {
      this.bloom.render(r, this.post, this.post, 0, false);
    }

    this.finalMat.uniforms.tColor.value = this.post.texture;
    if (settings.data.antialias) {
      r.setRenderTarget(this.ldr);
      this.finalQuad.render(r);
      this.fxaaMat.uniforms.tColor.value = this.ldr.texture;
      r.setRenderTarget(null);
      this.fxaaQuad.render(r);
    } else {
      r.setRenderTarget(null);
      this.finalQuad.render(r);
    }
    if (this.overlayScene && this.overlayCamera) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlayScene, this.overlayCamera);
      r.autoClear = true;
    }
  }
}
