import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MandateClaims, MandateScope } from '../core/types.js'
import { addSeconds, canonicalJson, fail, nowIso, parseJson, sha256, withinPath } from '../core/util.js'

export interface KeyMaterial {
  kid: string
  privateKeyPem: string
  publicKeyPem: string
}

export function generateKeys(): KeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const kid = sha256(publicKeyPem).slice(0, 16)
  return { kid, privateKeyPem, publicKeyPem }
}

export function saveKeys(dir: string, keys: KeyMaterial): void {
  mkdirSync(join(dir, 'keys'), { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, 'keys', 'root.key'), keys.privateKeyPem, { mode: 0o600 })
  writeFileSync(join(dir, 'keys', 'root.pub'), keys.publicKeyPem, { mode: 0o644 })
  writeFileSync(join(dir, 'keys', 'root.kid'), keys.kid, { mode: 0o644 })
}

export function loadKeys(dir: string): KeyMaterial {
  const keyPath = join(dir, 'keys', 'root.key')
  if (!existsSync(keyPath)) fail('keys_missing', `No signing key at ${keyPath}. Run "teamplane init" first.`, 422)
  const privateKeyPem = readFileSync(keyPath, 'utf8')
  const publicKeyPem = readFileSync(join(dir, 'keys', 'root.pub'), 'utf8')
  const kid = readFileSync(join(dir, 'keys', 'root.kid'), 'utf8').trim()
  return { kid, privateKeyPem, publicKeyPem }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

export interface MandateTokenParts {
  header: { v: 1; kid: string; alg: 'Ed25519' }
  claims: MandateClaims
  signature: string
}

export function signMandate(claims: MandateClaims, keys: KeyMaterial): string {
  const header = { v: 1 as const, kid: keys.kid, alg: 'Ed25519' as const }
  const body = `${b64url(canonicalJson(header))}.${b64url(canonicalJson(claims))}`
  const signature = sign(null, Buffer.from(body), keys.privateKeyPem)
  return `${body}.${b64url(signature)}`
}

export function decodeMandate(token: string): MandateTokenParts {
  const parts = token.split('.')
  if (parts.length !== 3) fail('invalid_mandate', 'A mandate token must have three dot-separated parts.', 422)
  const header = parseJson<MandateTokenParts['header']>(fromB64url(parts[0]!).toString('utf8'), 'mandate header')
  const claims = parseJson<MandateClaims>(fromB64url(parts[1]!).toString('utf8'), 'mandate claims')
  return { header, claims, signature: parts[2]! }
}

export function verifyMandate(token: string, publicKeyPem: string, now = nowIso()): MandateClaims {
  const parts = token.split('.')
  if (parts.length !== 3) fail('invalid_mandate', 'A mandate token must have three dot-separated parts.', 422)
  const body = `${parts[0]!}.${parts[1]!}`
  const ok = verify(null, Buffer.from(body), publicKeyPem, fromB64url(parts[2]!))
  if (!ok) fail('invalid_mandate_signature', 'Mandate signature does not verify.', 403)
  const { claims } = decodeMandate(token)
  if (claims.exp <= now) fail('mandate_expired', `Mandate ${claims.id} expired at ${claims.exp}.`, 403)
  if (claims.iat > now) fail('mandate_not_yet_valid', `Mandate ${claims.id} is not valid before ${claims.iat}.`, 403)
  return claims
}

export interface DeriveOptions {
  subject?: string
  paths?: string[]
  actions?: string[]
  branches?: string[]
  memory?: string[]
  ttlSeconds?: number
  maxWrites?: number
}

export function deriveClaims(parent: MandateClaims, options: DeriveOptions, now = nowIso()): MandateClaims {
  const scope: MandateScope = {
    paths: options.paths ?? parent.scope.paths,
    actions: options.actions ?? parent.scope.actions,
    branches: options.branches ?? parent.scope.branches,
    memory: options.memory ?? parent.scope.memory,
  }

  const childExp = options.ttlSeconds === undefined ? parent.exp : addSeconds(now, Math.max(1, options.ttlSeconds))
  const maxWrites = options.maxWrites ?? parent.limits.maxWrites

  if (childExp > parent.exp) fail('mandate_expansion', 'A derived mandate cannot outlive its parent.', 403)
  if (maxWrites > parent.limits.maxWrites) fail('mandate_expansion', 'A derived mandate cannot raise the write limit.', 403)

  for (const path of scope.paths) {
    if (!parent.scope.paths.some((prefix) => withinPath(prefix, path))) {
      fail('mandate_expansion', `Derived path ${path} is outside the parent mandate.`, 403)
    }
  }
  for (const action of scope.actions) {
    if (parent.scope.actions.includes('*')) continue
    if (!parent.scope.actions.includes(action)) {
      fail('mandate_expansion', `Derived action ${action} is outside the parent mandate.`, 403)
    }
  }
  for (const branch of scope.branches) {
    if (!parent.scope.branches.includes(branch)) {
      fail('mandate_expansion', `Derived branch ${branch} is outside the parent mandate.`, 403)
    }
  }
  for (const namespace of scope.memory) {
    if (!parent.scope.memory.some((prefix) => withinPath(prefix, namespace))) {
      fail('mandate_expansion', `Derived memory namespace ${namespace} is outside the parent mandate.`, 403)
    }
  }

  return {
    v: 1,
    id: parent.id,
    issuer: parent.issuer,
    subject: options.subject ?? parent.subject,
    task: parent.task,
    scope,
    limits: { maxWrites, expiresAt: childExp },
    policyVersion: parent.policyVersion,
    iat: now,
    exp: childExp,
    nonce: sha256(`${parent.nonce}:${now}:${canonicalJson(scope)}:${options.subject ?? parent.subject}`).slice(0, 24),
  }
}

export function summarizeMandate(claims: MandateClaims): string {
  return [
    `mandate ${claims.id}`,
    `subject=${claims.subject}`,
    `task=${claims.task}`,
    `paths=[${claims.scope.paths.join(', ')}]`,
    `actions=[${claims.scope.actions.join(', ')}]`,
    `branches=[${claims.scope.branches.join(', ')}]`,
    `exp=${claims.exp}`,
  ].join(' ')
}
