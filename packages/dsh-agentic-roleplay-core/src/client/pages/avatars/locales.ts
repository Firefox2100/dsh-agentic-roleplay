import { withDictionaries, type Dictionaries } from '../../i18n.ts'
import { dictionaries as editor, type WorldLocaleKey } from '../../world-editor/locales.ts'

export type AvatarsLocaleKey =
  | WorldLocaleKey
  | 'nav' | 'avatarsLoading' | 'avatarsLoadFailed' | 'avatarsEmpty' | 'avatarsCountOne' | 'avatarsCountOther' | 'avatarsRefresh' | 'avatarsRefreshing'
  | 'avatarsBack' | 'avatarsCancel' | 'avatarsClose' | 'avatarsMissing'
  | 'avatarCreate' | 'avatarCreateTitle' | 'avatarCreateHelp' | 'avatarName' | 'avatarCreating' | 'avatarCreateFailed'
  | 'avatarDelete' | 'avatarDeleteTitle' | 'avatarDeleteHelp' | 'avatarDeleting' | 'avatarDeleteFailed' | 'avatarEdit'

const own: Dictionaries<Exclude<AvatarsLocaleKey, WorldLocaleKey>> = {
  en: {
    nav: 'Avatars',
    avatarsLoading: 'Loading avatars…',
    avatarsLoadFailed: 'Could not load the avatars: {message}',
    avatarsEmpty: 'No avatars yet. An avatar is a character you can play in any world: make one, then add it to a world or bring it into a new session.',
    avatarsCountOne: '{count} avatar',
    avatarsCountOther: '{count} avatars',
    avatarsRefresh: 'Refresh',
    avatarsRefreshing: 'Refreshing…',
    avatarsBack: 'Back',
    avatarsCancel: 'Cancel',
    avatarsClose: 'Close',
    avatarsMissing: 'This avatar is no longer there.',
    avatarCreate: 'New avatar',
    avatarCreateTitle: 'New avatar',
    avatarCreateHelp: 'An avatar is a playable character that is not tied to a world. Give it a name; everything else can be written in the editor.',
    avatarName: 'Name',
    avatarCreating: 'Creating…',
    avatarCreateFailed: 'Could not create the avatar: {message}',
    avatarDelete: 'Delete',
    avatarDeleteTitle: 'Delete avatar',
    avatarDeleteHelp: 'Delete {name}? Worlds and sessions that already have it keep their own copy. The avatar is moved to the trash folder.',
    avatarDeleting: 'Deleting…',
    avatarDeleteFailed: 'Could not delete the avatar: {message}',
    avatarEdit: 'Edit',
  },
  zh: {
    nav: '角色形象',
    avatarsLoading: '正在加载角色形象…',
    avatarsLoadFailed: '无法加载角色形象：{message}',
    avatarsEmpty: '还没有角色形象。角色形象是可在任何世界里扮演的角色：先创建一个，再把它加入世界，或在新存档中带上它。',
    avatarsCountOne: '{count} 个角色形象',
    avatarsCountOther: '{count} 个角色形象',
    avatarsRefresh: '刷新',
    avatarsRefreshing: '正在刷新…',
    avatarsBack: '返回',
    avatarsCancel: '取消',
    avatarsClose: '关闭',
    avatarsMissing: '这个角色形象已不存在。',
    avatarCreate: '新建角色形象',
    avatarCreateTitle: '新建角色形象',
    avatarCreateHelp: '角色形象是不属于任何世界的可扮演角色。先起个名字，其余内容可在编辑器中填写。',
    avatarName: '名称',
    avatarCreating: '正在创建…',
    avatarCreateFailed: '无法创建角色形象：{message}',
    avatarDelete: '删除',
    avatarDeleteTitle: '删除角色形象',
    avatarDeleteHelp: '删除{name}？已经带有它的世界和存档会保留各自的副本。该角色形象会被移到回收文件夹。',
    avatarDeleting: '正在删除…',
    avatarDeleteFailed: '无法删除角色形象：{message}',
    avatarEdit: '编辑',
  },
}

export const dictionaries = withDictionaries(own, editor)
