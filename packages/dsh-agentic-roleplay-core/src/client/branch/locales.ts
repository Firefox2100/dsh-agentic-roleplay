import type { Dictionaries } from '../i18n.ts'

export type BranchLocaleKey = 'title' | 'description' | 'name' | 'save' | 'saving' | 'keep' | 'close' | 'failed'

export const dictionaries: Dictionaries<BranchLocaleKey> = {
  en: {
    title: 'Name the branch',
    description: 'A new session was made from the story at this point; the first one is as it was.',
    name: 'Name',
    save: 'Save',
    saving: 'Saving…',
    keep: 'Keep this name',
    close: 'Close',
    failed: 'Could not rename the session: {message}',
  },
  zh: {
    title: '为分支命名',
    description: '已从故事的这一刻另存为新的会话，原会话保持不变。',
    name: '名称',
    save: '保存',
    saving: '正在保存…',
    keep: '保留此名称',
    close: '关闭',
    failed: '无法重命名会话：{message}',
  },
  ja: { title: '分岐に名前を付ける', description: '物語のこの時点から新しいセッションを作成しました。元のセッションはそのまま残ります。', name: '名前', save: '保存', saving: '保存中…', keep: 'この名前を使う', close: '閉じる', failed: 'セッション名を変更できませんでした：{message}' },
  es: { title: 'Ponle nombre a la bifurcación', description: 'Se ha creado una sesión desde este punto de la historia. La original no ha cambiado.', name: 'Nombre', save: 'Guardar', saving: 'Guardando…', keep: 'Conservar este nombre', close: 'Cerrar', failed: 'No se ha podido cambiar el nombre de la sesión: {message}' },
  fr: { title: 'Nommer la branche', description: 'Une nouvelle session a été créée à partir de ce point de l’histoire. La session d’origine reste inchangée.', name: 'Nom', save: 'Enregistrer', saving: 'Enregistrement…', keep: 'Garder ce nom', close: 'Fermer', failed: 'Impossible de renommer la session : {message}' },
  de: { title: 'Abzweigung benennen', description: 'Ab diesem Punkt der Geschichte wurde eine neue Sitzung erstellt. Die ursprüngliche Sitzung bleibt unverändert.', name: 'Name', save: 'Speichern', saving: 'Wird gespeichert…', keep: 'Diesen Namen behalten', close: 'Schließen', failed: 'Die Sitzung konnte nicht umbenannt werden: {message}' },
  ru: { title: 'Назвать ветку', description: 'С этого места истории создан новый сеанс. Исходный сеанс остался без изменений.', name: 'Название', save: 'Сохранить', saving: 'Сохранение…', keep: 'Оставить это название', close: 'Закрыть', failed: 'Не удалось переименовать сеанс: {message}' },
  pt: { title: 'Dê um nome à ramificação', description: 'Foi criada uma nova sessão a partir deste ponto da história. A sessão original não foi alterada.', name: 'Nome', save: 'Guardar', saving: 'A guardar…', keep: 'Manter este nome', close: 'Fechar', failed: 'Não foi possível mudar o nome da sessão: {message}' },
}
