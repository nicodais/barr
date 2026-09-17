import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();
/** Shared, locally served CC0 scans. Colour maps alone use the sRGB transfer. */
export function surfaceTexture(asset: string, kind: 'color' | 'normal' | 'roughness'): THREE.Texture {
  const key = asset + '-' + kind;
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = typeof document === 'undefined'
    ? new THREE.Texture()
    : new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'textures/' + key + '.jpg');
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, texture);
  return texture;
}
