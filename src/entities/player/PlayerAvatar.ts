import * as THREE from 'three';
import { GeoBuilder, box, column, sphere, trs } from '../../render/GeoKit';
import { propMaterial } from '../../render/Materials';
import type { Game } from '../../core/Game';

/**
 * Procedural exosuit avatar shown in third-person. Limbs are simple pivots
 * animated from the player's movement (walk cycle, jetpack pose).
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private torso: THREE.Group;
  private phase = 0;
  private jetGlow: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    const mat = propMaterial({ roughness: 0.5, metalness: 0.3 });
    const suit = new THREE.Color(0.86, 0.84, 0.78);
    const dark = new THREE.Color(0.18, 0.19, 0.22);
    const accent = new THREE.Color(1.0, 0.5, 0.15);
    const visor = new THREE.Color(0.2, 0.7, 1.0);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;
    const tb = new GeoBuilder();
    tb.add(box(0.46, 0.55, 0.28), suit, trs(0, 0.32, 0));
    tb.add(box(0.48, 0.08, 0.3), accent, trs(0, 0.12, 0));
    tb.add(box(0.36, 0.5, 0.2), dark, trs(0, 0.35, 0.22));
    tb.add(column(0.05, 0.05, 6), accent, trs(0.12, 0.62, 0.22, 0, 0, 0, 1, 0.12, 1), 1.8);
    tb.add(sphere(0.2, 12, 10), suit, trs(0, 0.8, 0));
    tb.add(sphere(0.14, 12, 8), visor, trs(0, 0.8, -0.1, 0, 0, 0, 1.2, 0.8, 0.7), 1.6);
    tb.add(box(0.36, 0.22, 0.22), suit, trs(0, -0.02, 0));
    const torsoMesh = new THREE.Mesh(tb.build(), mat);
    torsoMesh.castShadow = true;
    this.torso.add(torsoMesh);
    this.root.add(this.torso);

    const limb = (len: number, w: number) => new GeoBuilder()
      .add(box(w, len * 0.5, w), suit, trs(0, -len * 0.25, 0))
      .add(box(w * 0.9, len * 0.5, w * 0.9), suit, trs(0, -len * 0.75, 0))
      .add(box(w * 1.05, 0.06, w * 1.05), dark, trs(0, -len * 0.5, 0))
      .build();
    const legGeo = limb(0.9, 0.17);
    const armGeo = limb(0.62, 0.12);
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 0.12, 0.95, 0);
      const lm = new THREE.Mesh(legGeo, mat);
      lm.castShadow = true;
      leg.add(lm);
      const boot = new THREE.Mesh(new GeoBuilder().add(box(0.2, 0.1, 0.3), dark, trs(0, -0.9, -0.04)).build(), mat);
      leg.add(boot);
      this.root.add(leg);
      this.legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(s * 0.3, 0.6, 0);
      const am = new THREE.Mesh(armGeo, mat);
      am.castShadow = true;
      arm.add(am);
      this.torso.add(arm);
      this.arms.push(arm);
    }
    this.jetGlow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 3.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.jetGlow.position.set(0, 0.1, 0.3);
    this.torso.add(this.jetGlow);
    this.root.visible = false;
    parent.add(this.root);
  }

  update(dt: number, game: Game): void {
    const p = game.player;
    const show = game.mode === 'foot' && game.cameraRig.thirdPersonFoot;
    this.root.visible = show;
    if (!show) return;
    this.root.position.copy(p.pos);
    this.root.quaternion.copy(p.body);
    const up = p.up.clone();
    const sp = p.vel.clone().addScaledVector(up, -p.vel.dot(up)).length();
    this.phase += dt * sp * 1.6;
    const swing = Math.min(0.8, sp * 0.12);
    const air = !p.onGround;
    this.legs[0].rotation.x = air ? 0.3 : Math.sin(this.phase) * swing;
    this.legs[1].rotation.x = air ? -0.2 : -Math.sin(this.phase) * swing;
    this.arms[0].rotation.x = air ? -0.4 : -Math.sin(this.phase) * swing * 0.8;
    this.arms[1].rotation.x = air ? -0.4 : Math.sin(this.phase) * swing * 0.8;
    this.torso.rotation.x = -Math.min(0.25, sp * 0.02);
    this.torso.position.y = 0.95 + Math.abs(Math.cos(this.phase)) * swing * 0.04;
    const jet = air && game.input.isDown('jump') && p.jetpack > 0;
    this.jetGlow.visible = jet;
    if (jet) this.jetGlow.scale.setScalar(0.8 + Math.random() * 0.6);
  }
}
