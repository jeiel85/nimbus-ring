import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { gradeShader } from './shaders.js';

// render → bloom (HDR) → tone map + sRGB → film grade
export function createPost(renderer, scene, camera, samples) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(size.clone(), 0.7, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(gradeShader);
  grade.uniforms.uRes.value = size.clone();
  composer.addPass(grade);

  return {
    composer,
    grade: grade.uniforms,
    resize() {
      renderer.getDrawingBufferSize(size);
      composer.setSize(size.x, size.y);
      grade.uniforms.uRes.value.copy(size);
    },
    render() {
      composer.render();
    },
  };
}
