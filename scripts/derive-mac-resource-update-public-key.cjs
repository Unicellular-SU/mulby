const { createPrivateKey, createPublicKey } = require('crypto')

function normalizePemSecret(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error('MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM is required')
  }
  if (raw.includes('-----BEGIN')) {
    return raw.replace(/\\n/g, '\n')
  }
  return Buffer.from(raw, 'base64').toString('utf8')
}

const privateKeyPem = normalizePemSecret(process.env.MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM)
const publicKey = createPublicKey(createPrivateKey(privateKeyPem))
process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }))
