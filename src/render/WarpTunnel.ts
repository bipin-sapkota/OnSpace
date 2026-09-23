import * as THREE from 'three';

/**
 * Hyperspace tunnel shown during jumps. It hides system streaming behind a
 * diegetic effect: stretched light streaks rushing past the camera.
 */
export class WarpTunnel {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(camera: THREE.Camera) {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(0.5, 0.7, 1.0) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uIntensity; uniform vec3 uColor; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float a = vUv.x * 160.0;
          float lane = floor(a);
          float speed = 1.5 + h(vec2(lane, 1.0)) * 3.0;
          float y = fract(vUv.y * 2.0 + uTime * speed + h(vec2(lane, 7.0)));
          float streak = smoothstep(0.0, 0.02, y) * smoothstep(0.35, 0.0, y) * step(0.55, h(vec2(lane, floor(vUv.y * 2.0 + uTime * speed))));
          float edge = smoothstep(0.5, 0.0, abs(fract(a) - 0.5));
          vec3 c = mix(uColor, vec3(1.0, 0.6, 0.9), h(vec2(lane, 3.0))) * streak * edge * 6.0;
          float glow = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 3.0) * 0.4;
          gl_FragColor = vec4(c + uColor * glow * 0.6, (streak * edge + glow) * uIntensity);
        }`,
    });
    const geo = new THREE.CylinderGeometry(6, 6, 400, 64, 1, true);
    geo.rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  update(time: number, intensity: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
  }
}
