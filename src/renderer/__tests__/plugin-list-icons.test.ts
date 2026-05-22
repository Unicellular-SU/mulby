import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSystemIconBatch,
  getSystemFileIconSvg,
  getSystemIconCacheKey,
  resolveSystemFileIconCategory
} from '../components/plugin-list-icons'

describe('PluginList system icon batch', () => {
  it('does not request native icons for file search results', () => {
    const batch = buildSystemIconBatch({
      appItems: [],
      fileItems: [
        { path: 'C:\\Users\\73221\\CrossDevice\\OPPO Find X8 Pro\\storage\\Music\\Recordings\\微信-孙锡.mp3' },
        { path: 'D:\\Local Disk E_20260302001935\\backup\\微信文件\\孙锡简历.pdf' }
      ],
      iconCache: new Set(),
      pendingKeys: new Set()
    })

    assert.deepEqual(batch.requests, [])
    assert.deepEqual(batch.neededKeys, [
      getSystemIconCacheKey('file', 'C:\\Users\\73221\\CrossDevice\\OPPO Find X8 Pro\\storage\\Music\\Recordings\\微信-孙锡.mp3'),
      getSystemIconCacheKey('file', 'D:\\Local Disk E_20260302001935\\backup\\微信文件\\孙锡简历.pdf')
    ])
  })

  it('still requests icons for system app results', () => {
    const batch = buildSystemIconBatch({
      appItems: [
        { path: 'C:\\Program Files\\Mulby\\Mulby.exe' },
        { path: 'C:\\Program Files\\WPS\\wps.exe', iconPath: 'C:\\Program Files\\WPS\\wps.ico' }
      ],
      fileItems: [],
      iconCache: new Set(),
      pendingKeys: new Set()
    })

    assert.deepEqual(batch.requests, [
      {
        key: getSystemIconCacheKey('app', 'C:\\Program Files\\Mulby\\Mulby.exe'),
        path: 'C:\\Program Files\\Mulby\\Mulby.exe',
        kind: 'app'
      },
      {
        key: getSystemIconCacheKey('app', 'C:\\Program Files\\WPS\\wps.exe'),
        path: 'C:\\Program Files\\WPS\\wps.ico',
        kind: 'file'
      }
    ])
  })

  it('classifies folder and common file extensions for default icons', () => {
    assert.equal(resolveSystemFileIconCategory({ name: '项目资料', path: 'D:\\项目资料', isDirectory: true }), 'folder')
    assert.equal(resolveSystemFileIconCategory({ name: '方案.PDF', path: 'D:\\方案.PDF', isDirectory: false }), 'pdf')
    assert.equal(resolveSystemFileIconCategory({ name: '报表.xlsx', path: 'D:\\报表.xlsx', isDirectory: false }), 'spreadsheet')
    assert.equal(resolveSystemFileIconCategory({ name: '演示.pptx', path: 'D:\\演示.pptx', isDirectory: false }), 'presentation')
    assert.equal(resolveSystemFileIconCategory({ name: '录音.mp3', path: 'D:\\录音.mp3', isDirectory: false }), 'audio')
    assert.equal(resolveSystemFileIconCategory({ name: '照片.heic', path: 'D:\\照片.heic', isDirectory: false }), 'image')
    assert.equal(resolveSystemFileIconCategory({ name: 'archive.7z', path: 'D:\\archive.7z', isDirectory: false }), 'archive')
  })

  it('returns distinct safe svg defaults for folders and files', () => {
    const folderIcon = getSystemFileIconSvg({ name: 'Downloads', path: 'C:\\Users\\me\\Downloads', isDirectory: true })
    const fileIcon = getSystemFileIconSvg({ name: 'notes.txt', path: 'C:\\Users\\me\\notes.txt', isDirectory: false })

    assert.notEqual(folderIcon, fileIcon)
    assert.match(folderIcon, /data-file-icon="folder"/)
    assert.match(fileIcon, /data-file-icon="text"/)
  })
})
