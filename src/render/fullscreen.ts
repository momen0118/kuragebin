// 画面全体に1枚の三角形を描くパス
import {
  BufferGeometry,
  Float32BufferAttribute,
  GLSL3,
  Mesh,
  OrthographicCamera,
  ShaderMaterial,
  type IUniform,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { frag } from './shaders/glsl';

export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const geometry = new BufferGeometry();
geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class FullscreenPass<U extends Record<string, IUniform>> {
  readonly material: ShaderMaterial;
  readonly uniforms: U;
  private readonly mesh: Mesh;

  constructor(fragmentShader: string, uniforms: U) {
    this.uniforms = uniforms;
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: frag(fragmentShader),
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
