#!/usr/bin/env node
/**
 * Packs a Chrome extension directory into CRX3 format.
 * Usage: node pack-extension.mjs <extension-dir> <output-crx> <output-id-file>
 */
import { createHash, createSign, generateKeyPairSync } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const extDir = process.argv[2];
const outCrx = process.argv[3];
const outIdFile = process.argv[4];

if (!extDir || !outCrx) {
  console.error('Usage: node pack-extension.mjs <ext-dir> <out.crx> [out-id.txt]');
  process.exit(1);
}

// --- Generate RSA 2048 key pair ---
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });

// --- Compute extension ID (first 16 bytes of SHA256(pubkey), mapped to a-p) ---
const hash = createHash('sha256').update(pubKeyDer).digest();
const extId = Array.from(hash.subarray(0, 16))
  .map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 0xf)))
  .join('');

console.log('Extension ID:', extId);
if (outIdFile) writeFileSync(outIdFile, extId);

// --- Create ZIP of extension directory ---
execSync(`cd "${extDir}" && zip -qr /tmp/_ext.zip .`);
const zipData = readFileSync('/tmp/_ext.zip');

// --- Protobuf helpers ---
function encodeVarint(n) {
  const bytes = [];
  while (n > 0x7f) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; }
  bytes.push(n);
  return Buffer.from(bytes);
}
function encodeLenDelim(fieldNum, data) {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

// --- Build CRX3 ---
// SignedData { crx_id: first 16 bytes of hash }
const crxId = hash.subarray(0, 16);
const signedData = encodeLenDelim(1, crxId);

// Data to sign: "CRX3 SignedData\x00" + uint32le(signedData.length) + signedData + zip
const prefix = Buffer.from('CRX3 SignedData\x00');
const lenBuf = Buffer.alloc(4);
lenBuf.writeUInt32LE(signedData.length, 0);
const toBeSigned = Buffer.concat([prefix, lenBuf, signedData, zipData]);

// RSA-SHA256 signature
const sign = createSign('SHA256');
sign.update(toBeSigned);
const signature = sign.sign(privateKey);

// AsymmetricKeyProof { public_key, signature }
const proof = Buffer.concat([
  encodeLenDelim(1, pubKeyDer),
  encodeLenDelim(2, signature),
]);

// CrxFileHeader { sha256_with_rsa: [proof], signed_header_data: signedData }
const header = Buffer.concat([
  encodeLenDelim(2, proof),
  encodeLenDelim(10000, signedData),
]);

// Final CRX3 binary: magic + version(3) + headerLen + header + zip
const magic = Buffer.from('Cr24');
const version = Buffer.alloc(4); version.writeUInt32LE(3, 0);
const headerLen = Buffer.alloc(4); headerLen.writeUInt32LE(header.length, 0);

const crx = Buffer.concat([magic, version, headerLen, header, zipData]);
writeFileSync(outCrx, crx);
console.log(`CRX3 written: ${outCrx} (${crx.length} bytes)`);
