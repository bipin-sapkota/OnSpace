import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { settings } from '../../core/Settings';

/**
 * Drives the render camera in universe space: first-person on foot, chase
 * camera for flight, with smoothed transitions between them, trauma-based
 * shake and speed-dependent field of view.
 */
export class CameraRig {
  readonly posU = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  private trauma = 0;
  private blend = 1;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private chaseUp = new THREE.Vector3(0, 1, 0);
  fovBoost = 0;
  orbit = { yaw: 0, pitch: 0.25, active: false };
  thirdPersonFoot = false;

  shake(amount: number): void {
    if (!settings.data.motionBlurShake) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Start a smooth transition from the current pose. */
  beginBlend(): void {
    this.fromPos.copy(this.posU);
    this.fromQuat.copy(this.quat);
    this.blend = 0;
    this.chaseInit = false;
  }

  update(dt: number, game: Game): void {
    const target = new THREE.Vector3();
    const tq = new THREE.Quaternion();
    let fov = settings.data.fov;
    const mode = game.mode;
    if (mode === 'foot' || mode === 'dead') {
      const p = game.player;
      if (this.thirdPersonFoot) {
        const up = p.up.clone();
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(p.lookQuat);
        target.copy(p.eye).addScaledVector(back, 4.5).addScaledVector(up, 0.8);
        tq.copy(p.lookQuat);
      } else {
        target.copy(p.eye);
        tq.copy(p.lookQuat);
      }
    } else {
      const s = game.ship;
      const up = s.upVec;
      const fwd = s.forward;
      const L = s.model.length;
      const docked = s.mode === 'docked' || s.mode === 'landed';
      let desired: THREE.Vector3;
      if (docked || this.orbit.active) {
        // slow orbit around the parked ship
        const q = s.quat.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.orbit.pitch, this.orbit.yaw, 0, 'YXZ')));
        desired = new THREE.Vector3(0, 0, L * 1.9).applyQuaternion(q).add(s.pos);
        if (docked && !this.orbit.active) this.orbit.yaw += dt * 0.08;
      } else {
        desired = s.pos.clone().addScaledVector(fwd, -L * 1.25).addScaledVector(up, L * 0.32);
      }
      if (!this.chaseInit) {
        this.chasePos.copy(desired);
        this.chaseUp.copy(up);
        this.chaseInit = true;
      }
      // follow in ship-relative frame so high speed does not lag the camera far behind
      const rel = this.chasePos.clone().sub(s.pos);
      const relDesired = desired.clone().sub(s.pos);
      rel.lerp(relDesired, 1 - Math.exp(-dt * 7));
      this.chasePos.copy(s.pos).add(rel);
      this.chaseUp.lerp(up, 1 - Math.exp(-dt * 5)).normalize();
      target.copy(this.chasePos);
      const lookAt = s.pos.clone().addScaledVector(fwd, docked ? 0 : L * 2.2).addScaledVector(up, docked ? 0 : L * 0.1);
      const m = new THREE.Matrix4().lookAt(target, lookAt, this.chaseUp);
      tq.setFromRotationMatrix(m);
      const sp = s.speed;
      fov += Math.min(14, sp / 60) + (s.boosting ? 6 : 0) + (s.mode === 'pulse' ? 14 : 0);
    }
    fov += this.fovBoost;

    // blend from previous pose
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.9);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      this.posU.copy(this.fromPos).lerp(target, e);
      this.quat.copy(this.fromQuat).slerp(tq, e);
    } else {
      this.posU.copy(target);
      this.quat.copy(tq);
    }

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    if (sh > 0.0005) {
      const t = game.time * 40;
      const e = new THREE.Euler(Math.sin(t * 1.1) * 0.03 * sh, Math.sin(t * 1.7 + 1) * 0.03 * sh, Math.sin(t * 0.9 + 2) * 0.05 * sh);
      this.quat.multiply(new THREE.Quaternion().setFromEuler(e));
    }

    const cam = game.renderer.camera;
    cam.position.copy(game.world.toRender(this.posU));
    cam.quaternion.copy(this.quat);
    const newFov = THREE.MathUtils.lerp(cam.fov, fov, 1 - Math.exp(-dt * 4));
    if (Math.abs(newFov - cam.fov) > 0.01) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
