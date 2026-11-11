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
  ja: { nav: 'アバター', avatarsLoading: 'アバターを読み込み中…', avatarsLoadFailed: 'アバターを読み込めませんでした：{message}', avatarsEmpty: 'アバターはまだありません。アバターは、どのワールドでも操作できるキャラクターです。作成してワールドに加えるか、新しいセッションへ連れていけます。', avatarsCountOne: '{count} 件のアバター', avatarsCountOther: '{count} 件のアバター', avatarsRefresh: '更新', avatarsRefreshing: '更新中…', avatarsBack: '戻る', avatarsCancel: 'キャンセル', avatarsClose: '閉じる', avatarsMissing: 'このアバターはもう存在しません。', avatarCreate: '新しいアバター', avatarCreateTitle: '新しいアバター', avatarCreateHelp: 'アバターは特定のワールドに属さない、操作可能なキャラクターです。まず名前を付け、残りはエディターで設定できます。', avatarName: '名前', avatarCreating: '作成中…', avatarCreateFailed: 'アバターを作成できませんでした：{message}', avatarDelete: '削除', avatarDeleteTitle: 'アバターを削除', avatarDeleteHelp: '{name} を削除しますか？すでに追加済みのワールドやセッションには、それぞれのコピーが残ります。アバターはごみ箱フォルダーへ移動します。', avatarDeleting: '削除中…', avatarDeleteFailed: 'アバターを削除できませんでした：{message}', avatarEdit: '編集' },
  es: { nav: 'Avatares', avatarsLoading: 'Cargando avatares…', avatarsLoadFailed: 'No se han podido cargar los avatares: {message}', avatarsEmpty: 'Aún no hay avatares. Un avatar es un personaje que puedes interpretar en cualquier mundo: créalo y añádelo a un mundo o llévalo a una sesión nueva.', avatarsCountOne: '{count} avatar', avatarsCountOther: '{count} avatares', avatarsRefresh: 'Actualizar', avatarsRefreshing: 'Actualizando…', avatarsBack: 'Atrás', avatarsCancel: 'Cancelar', avatarsClose: 'Cerrar', avatarsMissing: 'Este avatar ya no existe.', avatarCreate: 'Nuevo avatar', avatarCreateTitle: 'Nuevo avatar', avatarCreateHelp: 'Un avatar es un personaje jugable que no pertenece a ningún mundo. Ponle un nombre; puedes completar el resto en el editor.', avatarName: 'Nombre', avatarCreating: 'Creando…', avatarCreateFailed: 'No se ha podido crear el avatar: {message}', avatarDelete: 'Eliminar', avatarDeleteTitle: 'Eliminar avatar', avatarDeleteHelp: '¿Eliminar {name}? Los mundos y las sesiones que ya lo tengan conservarán su propia copia. El avatar se moverá a la papelera.', avatarDeleting: 'Eliminando…', avatarDeleteFailed: 'No se ha podido eliminar el avatar: {message}', avatarEdit: 'Editar' },
  fr: { nav: 'Avatars', avatarsLoading: 'Chargement des avatars…', avatarsLoadFailed: 'Impossible de charger les avatars : {message}', avatarsEmpty: 'Aucun avatar pour le moment. Un avatar est un personnage que vous pouvez incarner dans n’importe quel monde : créez-en un, puis ajoutez-le à un monde ou emportez-le dans une nouvelle session.', avatarsCountOne: '{count} avatar', avatarsCountOther: '{count} avatars', avatarsRefresh: 'Actualiser', avatarsRefreshing: 'Actualisation…', avatarsBack: 'Retour', avatarsCancel: 'Annuler', avatarsClose: 'Fermer', avatarsMissing: 'Cet avatar n’existe plus.', avatarCreate: 'Nouvel avatar', avatarCreateTitle: 'Nouvel avatar', avatarCreateHelp: 'Un avatar est un personnage jouable qui n’est lié à aucun monde. Donnez-lui un nom ; le reste peut être renseigné dans l’éditeur.', avatarName: 'Nom', avatarCreating: 'Création…', avatarCreateFailed: 'Impossible de créer l’avatar : {message}', avatarDelete: 'Supprimer', avatarDeleteTitle: 'Supprimer l’avatar', avatarDeleteHelp: 'Supprimer {name} ? Les mondes et sessions qui l’utilisent déjà garderont leur propre copie. L’avatar sera placé dans la corbeille.', avatarDeleting: 'Suppression…', avatarDeleteFailed: 'Impossible de supprimer l’avatar : {message}', avatarEdit: 'Modifier' },
  de: { nav: 'Avatare', avatarsLoading: 'Avatare werden geladen…', avatarsLoadFailed: 'Die Avatare konnten nicht geladen werden: {message}', avatarsEmpty: 'Noch keine Avatare. Ein Avatar ist eine Figur, die du in jeder Welt spielen kannst. Erstelle einen und füge ihn einer Welt oder einer neuen Sitzung hinzu.', avatarsCountOne: '{count} Avatar', avatarsCountOther: '{count} Avatare', avatarsRefresh: 'Aktualisieren', avatarsRefreshing: 'Wird aktualisiert…', avatarsBack: 'Zurück', avatarsCancel: 'Abbrechen', avatarsClose: 'Schließen', avatarsMissing: 'Dieser Avatar ist nicht mehr vorhanden.', avatarCreate: 'Neuer Avatar', avatarCreateTitle: 'Neuer Avatar', avatarCreateHelp: 'Ein Avatar ist eine spielbare Figur, die an keine Welt gebunden ist. Gib ihr einen Namen; alles Weitere kannst du im Editor eintragen.', avatarName: 'Name', avatarCreating: 'Wird erstellt…', avatarCreateFailed: 'Der Avatar konnte nicht erstellt werden: {message}', avatarDelete: 'Löschen', avatarDeleteTitle: 'Avatar löschen', avatarDeleteHelp: '{name} löschen? Welten und Sitzungen, die den Avatar bereits enthalten, behalten ihre eigene Kopie. Der Avatar wird in den Papierkorb verschoben.', avatarDeleting: 'Wird gelöscht…', avatarDeleteFailed: 'Der Avatar konnte nicht gelöscht werden: {message}', avatarEdit: 'Bearbeiten' },
  ru: { nav: 'Аватары', avatarsLoading: 'Загрузка аватаров…', avatarsLoadFailed: 'Не удалось загрузить аватары: {message}', avatarsEmpty: 'Аватаров пока нет. Аватар — это персонаж, которым можно играть в любом мире. Создайте его, затем добавьте в мир или возьмите в новый сеанс.', avatarsCountOne: '{count} аватар', avatarsCountOther: 'Аватаров: {count}', avatarsRefresh: 'Обновить', avatarsRefreshing: 'Обновление…', avatarsBack: 'Назад', avatarsCancel: 'Отмена', avatarsClose: 'Закрыть', avatarsMissing: 'Этого аватара больше нет.', avatarCreate: 'Новый аватар', avatarCreateTitle: 'Новый аватар', avatarCreateHelp: 'Аватар — игровой персонаж, не привязанный к определённому миру. Задайте имя; остальное можно заполнить в редакторе.', avatarName: 'Имя', avatarCreating: 'Создание…', avatarCreateFailed: 'Не удалось создать аватар: {message}', avatarDelete: 'Удалить', avatarDeleteTitle: 'Удалить аватар', avatarDeleteHelp: 'Удалить {name}? Миры и сеансы, где он уже есть, сохранят собственные копии. Аватар будет перемещён в корзину.', avatarDeleting: 'Удаление…', avatarDeleteFailed: 'Не удалось удалить аватар: {message}', avatarEdit: 'Изменить' },
  pt: { nav: 'Avatares', avatarsLoading: 'A carregar avatares…', avatarsLoadFailed: 'Não foi possível carregar os avatares: {message}', avatarsEmpty: 'Ainda não há avatares. Um avatar é uma personagem que pode interpretar em qualquer mundo: crie um e adicione-o a um mundo ou leve-o para uma nova sessão.', avatarsCountOne: '{count} avatar', avatarsCountOther: '{count} avatares', avatarsRefresh: 'Atualizar', avatarsRefreshing: 'A atualizar…', avatarsBack: 'Voltar', avatarsCancel: 'Cancelar', avatarsClose: 'Fechar', avatarsMissing: 'Este avatar já não existe.', avatarCreate: 'Novo avatar', avatarCreateTitle: 'Novo avatar', avatarCreateHelp: 'Um avatar é uma personagem jogável que não está ligada a nenhum mundo. Dê-lhe um nome; pode preencher o resto no editor.', avatarName: 'Nome', avatarCreating: 'A criar…', avatarCreateFailed: 'Não foi possível criar o avatar: {message}', avatarDelete: 'Eliminar', avatarDeleteTitle: 'Eliminar avatar', avatarDeleteHelp: 'Eliminar {name}? Os mundos e as sessões que já o têm mantêm as suas próprias cópias. O avatar será movido para a pasta de lixo.', avatarDeleting: 'A eliminar…', avatarDeleteFailed: 'Não foi possível eliminar o avatar: {message}', avatarEdit: 'Editar' },
}

export const dictionaries = withDictionaries(own, editor)
