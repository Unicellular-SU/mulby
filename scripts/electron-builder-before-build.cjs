module.exports = async function beforeBuild(context) {
  if (context.platform?.nodeName !== 'win32') {
    return true
  }

  console.log('[beforeBuild] Skipping electron-builder native dependency rebuild on Windows')
  return false
}
