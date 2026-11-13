import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { detailSet, DETAIL_KINDS, classify, applyDetail, applySurfaceDetail, AREA_BASE } from '../../js/surfaceDetail.js';
import { MISSIONS } from '../../js/config.js';

const std = (p = {}) => new THREE.MeshStandardMaterial(p);

test('every detail class synthesises a full, varied, tileable set', () => {
  for (const kind of DETAIL_KINDS) {
    const s = detailSet(kind, 64);
    assert.equal(s.mapData.length, 64 * 64 * 4, kind);
    let lo = 255, hi = 0, nz = 0;
    for (let i = 0; i < 64 * 64; i++) {
      lo = Math.min(lo, s.mapData[i * 4]); hi = Math.max(hi, s.mapData[i * 4]);
      nz += s.normalData[i * 4 + 2];
      assert.equal(s.mapData[i * 4 + 3], 255);
    }
    assert.ok(hi - lo > 12, `${kind}: albedo has no structure (${lo}..${hi})`);
    assert.ok(nz / (64 * 64) > 150, `${kind}: normals should mostly face out`);
    assert.ok(s.size > 0 && s.bump > 0 && s.mix > 0);
    assert.equal(detailSet(kind, 64), s, 'sets are cached');
  }
});

test('full-resolution sets carry GPU textures set up for tiling', () => {
  const s = detailSet('concrete');
  assert.ok(s.map.isDataTexture && s.normal.isDataTexture);
  assert.equal(s.map.wrapS, THREE.RepeatWrapping);
  assert.equal(s.map.colorSpace, THREE.NoColorSpace, 'multiplier maps stay linear');
});

test('classify: by world, tag and metalness', () => {
  assert.equal(classify(std(), { area: 'tomb' }), 'stone');
  assert.equal(classify(std(), { area: 'canyon' }), 'rock');
  assert.equal(classify(std(), { area: 'station' }), 'concrete');
  assert.equal(classify(std(), {}), 'concrete');
  assert.equal(classify(std(), { tag: 'wood', area: 'lab' }), 'wood');
  assert.equal(classify(std({ metalness: 0.9 }), { area: 'tomb' }), 'metal');
  assert.equal(classify(std({ metalness: 0.9 }), { area: 'lab' }), 'panel', 'sci-fi worlds use hull panelling for metal');
  assert.equal(classify(std(), { tag: 'metal', area: 'station' }), 'metal');
  const tile = std(); tile.userData.detailKind = 'tile';
  assert.equal(classify(tile, { area: 'canyon' }), 'tile', 'authored override wins');
});

test('classify: leaves glass, lamps, screens, unlit and opted-out materials alone', () => {
  assert.equal(classify(new THREE.MeshBasicMaterial(), {}), null);
  assert.equal(classify(null, {}), null);
  assert.equal(classify(std({ transparent: true }), {}), null);
  assert.equal(classify(std({ opacity: 0.5 }), {}), null);
  assert.equal(classify(new THREE.MeshPhysicalMaterial({ transmission: 0.9 }), {}), null);
  assert.equal(classify(std({ emissive: 0xffffff, emissiveIntensity: 2 }), {}), null);
  assert.equal(classify(std({ emissiveMap: new THREE.Texture() }), {}), null);
  assert.equal(classify(std(), { tag: 'glass' }), null);
  const no = std(); no.userData.noDetail = true;
  assert.equal(classify(no, {}), null);
  assert.equal(classify(std({ emissive: 0xffffff, emissiveIntensity: 0.1 }), { area: 'ice' }), 'ice', 'faint emissive is still a surface');
});

test('every arena world has a base surface class that exists', () => {
  for (const m of MISSIONS) {
    const area = ['hall', 'platform', 'garden'].includes(m.area) ? 'station' : m.area;
    assert.ok(DETAIL_KINDS.includes(AREA_BASE[area]), area);
  }
});

test('applyDetail patches the shader once, chains earlier hooks and keys the program', () => {
  const m = std();
  let chained = 0;
  m.onBeforeCompile = () => { chained++; };
  m.customProgramCacheKey = () => 'base';
  assert.equal(applyDetail(m, detailSet('metal')), true);
  assert.equal(applyDetail(m, detailSet('metal')), false, 'idempotent');
  assert.equal(m.userData.detail, 'metal');
  assert.equal(m.customProgramCacheKey(), 'base|det1');
  const sh = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>',
  };
  m.onBeforeCompile(sh);
  assert.equal(chained, 1);
  assert.ok(sh.uniforms.detailMap.value.isDataTexture && sh.uniforms.detailNormal.value.isDataTexture);
  assert.ok(Math.abs(sh.uniforms.detailParams.value.x - 1 / detailSet('metal').size) < 1e-9);
  assert.ok(sh.vertexShader.includes('vDetP = ( modelMatrix * detWP ).xyz'));
  assert.ok(sh.fragmentShader.includes('detailNormal') && sh.fragmentShader.includes('detRough'));
  // a splat shader that swallowed <map_fragment> must still get the albedo hook
  assert.ok(sh.fragmentShader.includes('diffuseColor.rgb *= mix'));
  assert.ok(sh.fragmentShader.includes('float detRough = 1.0'), 'defaults keep detail a no-op if an anchor is missing');
  assert.equal(applyDetail(new THREE.MeshBasicMaterial(), detailSet('metal')), false);
  // moving meshes project in object space and get their own program
  const mv = std();
  applyDetail(mv, detailSet('metal'), { object: true });
  const sh2 = { uniforms: {}, vertexShader: sh.vertexShader.split('\n').slice(0, 2).join('\n').replace(/varying[^\n]*\n/g, ''), fragmentShader: '#include <common>' };
  sh2.vertexShader = '#include <common>\n#include <project_vertex>';
  mv.onBeforeCompile(sh2);
  assert.ok(sh2.vertexShader.includes('vDetP = transformed'));
  assert.equal(mv.customProgramCacheKey(), '|det1o');
});

test('applySurfaceDetail walks the scene, respects skip/moving and world groups', () => {
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const wall = new THREE.Mesh(geo, std());
  const tomb = new THREE.Group(); tomb.name = 'world:tomb';
  const block = new THREE.Mesh(geo, std());
  const gear = new THREE.Mesh(geo, std({ metalness: 1 }));
  tomb.add(block, gear);
  const actor = new THREE.Group();
  const soldier = new THREE.Mesh(geo, std());
  actor.add(soldier);
  const mapped = new THREE.Mesh(geo, std({ map: new THREE.Texture() }));
  const lamp = new THREE.Mesh(geo, std({ emissive: 0xffffff, emissiveIntensity: 3 }));
  const multi = new THREE.Mesh(geo, [std(), new THREE.MeshBasicMaterial()]);
  scene.add(wall, tomb, actor, mapped, lamp, multi);
  const res = applySurfaceDetail(scene, { skip: (o) => o === actor, moving: (o) => o === gear });
  assert.equal(wall.material.userData.detail, 'concrete');
  assert.equal(block.material.userData.detail, 'stone');
  assert.equal(gear.material.userData.detail, 'metal');
  assert.equal(gear.material.customProgramCacheKey(), '|det1o');
  assert.equal(soldier.material.userData.detail, undefined, 'skipped subtree untouched');
  assert.equal(lamp.material.userData.detail, undefined);
  assert.equal(mapped.material.userData.detail, 'concrete');
  assert.equal(multi.material[0].userData.detail, 'concrete');
  assert.equal(res.patched, 5);
  assert.equal(res.byKind.concrete, 3);
  assert.equal(applySurfaceDetail(scene).patched, 1, 'second pass only picks up what was skipped');
});
