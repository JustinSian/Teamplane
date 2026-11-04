import { sign, verify } from 'node:crypto'
import type { KeyMaterial } from './mandate.js'
import { canonicalJson } from '../core/util.js'

/**
 * A signed head of the event chain. The signature uses the Ed25519 key that
 * lives outside the workspace, so a copy of `.teamplane/` cannot be re-signed
 * without the private key. Publish the checkpoint to a place an attacker who
 * can rewrite the chain does not control.
 */
export interface AuditCheckpoint {
  v: 1
  seq: number
  hash: string
  at: string
  sig: string
}

export function signCheckpoint(seq: number, hash: string, keys: KeyMaterial, at = new Date().toISOString()): AuditCheckpoint {
  const payload = { v: 1 as const, seq, hash, at }
  const sig = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), keys.privateKeyPem)
  return { ...payload, sig: sig.toString('base64url') }
}

export function verifyCheckpoint(checkpoint: AuditCheckpoint, publicKeyPem: string): boolean {
  const { sig, ...payload } = checkpoint
  return verify(null, Buffer.from(canonicalJson(payload), 'utf8'), publicKeyPem, Buffer.from(sig, 'base64url'))
}
