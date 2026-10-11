import type { Dictionaries } from '../i18n.ts'

export type GalleryLocaleKey =
  | 'tab' | 'notRoleplay' | 'loading' | 'loadFailed' | 'empty' | 'refresh' | 'refreshing'
  | 'countOne' | 'countOther' | 'all' | 'scenes' | 'references' | 'uploaded' | 'close' | 'dialog'
  | 'description' | 'prompt' | 'subjects' | 'reusable' | 'reusableHint' | 'pending' | 'describeFailed' | 'upload' | 'uploading' | 'uploadFailed' | 'updateFailed' | 'edit' | 'editTitle' | 'editHelp' | 'tags' | 'tagsHelp' | 'save' | 'saving' | 'cancel'

export const dictionaries: Dictionaries<GalleryLocaleKey> = {
  en: {
    tab: 'Gallery', notRoleplay: 'This chat is not a roleplay session, so it has no gallery.', loading: 'Loading images…', loadFailed: 'Could not load the gallery: {message}',
    empty: 'No images yet. Scene images and portraits made in this session appear here, and you can add your own.', refresh: 'Refresh', refreshing: 'Refreshing…',
    countOne: '{count} image', countOther: '{count} images', all: 'All', scenes: 'Scenes', references: 'References', uploaded: 'Added by you', close: 'Close', dialog: 'Image',
    description: 'Description', prompt: 'Prompt', subjects: 'Subjects', reusable: 'Reusable', reusableHint: 'May be shown again in a later scene. Images you add are always reusable.',
    pending: 'Waiting to be described…', describeFailed: 'Could not be described: {message}', upload: 'Add images', uploading: 'Adding…', uploadFailed: 'Could not add {name}: {message}', updateFailed: 'Could not change the image: {message}',
    edit: 'Edit', editTitle: 'Edit description', editHelp: 'What the picture shows, in words that stand on their own. It is how the image is found for a later scene, so correct it when it is wrong.', tags: 'Tags', tagsHelp: 'Separated by commas.', save: 'Save', saving: 'Saving…', cancel: 'Cancel',
  },
  zh: {
    tab: '图库', notRoleplay: '此对话不是角色扮演存档，没有图库。', loading: '正在加载图片…', loadFailed: '无法加载图库：{message}',
    empty: '还没有图片。本存档生成的场景图和立绘会显示在这里，你也可以添加自己的图片。', refresh: '刷新', refreshing: '正在刷新…',
    countOne: '{count} 张图片', countOther: '{count} 张图片', all: '全部', scenes: '场景', references: '参考图', uploaded: '你添加的', close: '关闭', dialog: '图片',
    description: '描述', prompt: '提示词', subjects: '对象', reusable: '可复用', reusableHint: '可在之后的场景里再次展示。你添加的图片总是可复用的。',
    pending: '等待描述…', describeFailed: '无法描述：{message}', upload: '添加图片', uploading: '正在添加…', uploadFailed: '无法添加 {name}：{message}', updateFailed: '无法修改图片：{message}',
    edit: '编辑', editTitle: '编辑描述', editHelp: '用能独立成立的话说明图片画的是什么。之后的场景就是靠它找到这张图的，所以不准确时请修正。', tags: '标签', tagsHelp: '用逗号分隔。', save: '保存', saving: '正在保存…', cancel: '取消',
  },
}
