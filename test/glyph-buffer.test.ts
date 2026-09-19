import assert from 'node:assert/strict';
import test from 'node:test';
import { AttributeType } from 'three/src/renderers/common/Constants.js';
import { StorageInstancedBufferAttribute } from 'three/webgpu';

interface AttributesLike {
  update(attribute: unknown, type: number): void;
  delete(attribute: unknown): void;
}

// @types/three ships no declaration for three's internal `src/` modules, so load
// the real implementation by its specifier and type the small surface used here.
const attributesSpecifier = 'three/src/renderers/common/Attributes.js';
const Attributes = (
  (await import(attributesSpecifier)) as {
    default: new (backend: unknown, info: unknown) => AttributesLike;
  }
).default;

test('retiring a Glyph draw preserves shared GPU storage until its owner disposes it', () => {
  let created = 0,
    destroyed = 0;
  const attributes = new Attributes(
    { createStorageAttribute: () => created++, destroyAttribute: () => destroyed++ },
    { createStorageAttribute() {}, destroyAttribute() {} },
  );
  const buffer = new StorageInstancedBufferAttribute(new Float32Array(16), 4);
  attributes.update(buffer, AttributeType.STORAGE);
  attributes.delete(buffer); // Geometry disposal while another draw still uses the buffer.
  attributes.update(buffer, AttributeType.STORAGE);
  assert.equal(created, 1);
  assert.equal(destroyed, 0);
  buffer.dispose(); // Glyph owns and retires the shared storage explicitly.
  assert.equal(destroyed, 1);
  buffer.dispose();
  assert.equal(destroyed, 1);
});
