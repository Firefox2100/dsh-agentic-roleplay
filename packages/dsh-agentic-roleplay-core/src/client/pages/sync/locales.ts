import type { Dictionaries } from '../../i18n.ts'

export type SyncLocaleKey =
  | 'nav' | 'loading' | 'loadFailed' | 'refresh' | 'run' | 'running' | 'runOne' | 'never' | 'lastRun' | 'dateLocale' | 'empty' | 'problem' | 'failed'
  | 'unit' | 'kind' | 'state' | 'synced' | 'details' | 'actions' | 'tableCaption'
  | 'kind_world' | 'kind_session' | 'kind_shared'
  | 'state_synced' | 'state_changed' | 'state_new' | 'state_conflict' | 'state_busy' | 'state_failed' | 'state_ignored'
  | 'ignoredDetail' | 'restore' | 'removedDetail' | 'deleteEverywhere' | 'keepOnRemote' | 'getBack' | 'deletedDetail' | 'keepMine' | 'deleteHere'
  | 'conflictWhole' | 'conflictFiles' | 'keepLocal' | 'keepRemote'
  | 'confirmEverywhereTitle' | 'confirmEverywhere' | 'confirmHereTitle' | 'confirmHere' | 'cancel' | 'close'

export const dictionaries: Dictionaries<SyncLocaleKey> = {
  en: {
    nav: 'Sync', loading: 'Reading the sync state…', loadFailed: 'Could not read the sync state: {message}', refresh: 'Refresh',
    run: 'Sync now', running: 'Syncing…', runOne: 'Sync', never: 'never', lastRun: 'Last run: {when}',
    dateLocale: 'en-GB',
    empty: 'Nothing to sync yet. Worlds, sessions and the shared folders (prompts, presets, lorebooks, avatars, interface packs) appear here once there are some.',
    problem: 'Sync cannot run: {message}. Set it up in Settings, under Role Play.', failed: 'The last action failed: {message}',
    unit: 'Unit', kind: 'Kind', state: 'State', synced: 'Last synced', details: 'Details', actions: 'Actions', tableCaption: 'Roleplay content sync status',
    kind_world: 'World', kind_session: 'Session', kind_shared: 'Shared folder',
    state_synced: 'In step', state_changed: 'Changed here', state_new: 'Not synced yet', state_conflict: 'Needs a choice', state_busy: 'Syncing', state_failed: 'Failed', state_ignored: 'Kept on the remote',
    conflictWhole: 'Both sides changed this. Keep one: the other is replaced.',
    conflictFiles: 'Both sides changed these files, so both copies were kept side by side: {files}. Choose which copy to keep.',
    keepLocal: 'Keep this device\'s', keepRemote: 'Keep the remote\'s',
    ignoredDetail: 'Deleted here only. The remote still has it and it is not synced back.', restore: 'Sync it again',
    removedDetail: 'This was removed on this device, and the remote still has it. Delete it everywhere, keep it on the remote and stop syncing it here, or get it back.',
    deleteEverywhere: 'Delete everywhere', keepOnRemote: 'Keep on the remote', getBack: 'Get it back',
    deletedDetail: 'Another device deleted this, but it was changed here since, so it was not removed. Keep this copy and sync it again, or delete it here too.',
    keepMine: 'Keep this copy', deleteHere: 'Delete it here too',
    confirmEverywhereTitle: 'Delete synced content everywhere?',
    confirmEverywhere: 'Delete "{unit}" from this device and the remote? Other devices will delete their copies when they next sync.',
    confirmHereTitle: 'Delete this device\'s copy?',
    confirmHere: 'Delete "{unit}" from this device too? This matches the deletion already recorded on the remote.',
    cancel: 'Cancel', close: 'Close',
  },
  zh: {
    nav: '同步', loading: '正在读取同步状态…', loadFailed: '无法读取同步状态：{message}', refresh: '刷新',
    run: '立即同步', running: '同步中…', runOne: '同步', never: '从未', lastRun: '上次运行：{when}',
    dateLocale: 'zh-CN',
    empty: '还没有可同步的内容。世界、会话和共享文件夹（提示词、预设、世界书、头像、界面包）一旦有内容就会出现在这里。',
    problem: '无法同步：{message}。请在“设置”的“角色扮演”中配置。', failed: '上一次操作失败：{message}',
    unit: '单元', kind: '类型', state: '状态', synced: '上次同步', details: '详情', actions: '操作', tableCaption: '角色扮演内容同步状态',
    kind_world: '世界', kind_session: '会话', kind_shared: '共享文件夹',
    state_synced: '已一致', state_changed: '本机已改动', state_new: '尚未同步', state_conflict: '需要选择', state_busy: '同步中', state_failed: '失败', state_ignored: '仅保留在远端',
    conflictWhole: '两边都改动了它。请保留其中一份，另一份会被替换。',
    conflictFiles: '两边都改动了这些文件，所以两份都保留了下来：{files}。请选择保留哪一份。',
    keepLocal: '保留本机的', keepRemote: '保留远端的',
    ignoredDetail: '只在本机删除了。远端仍有它，且不会同步回来。', restore: '重新同步',
    removedDetail: '它在本机被移除了，远端仍有它。可以在所有设备上删除，也可以保留在远端并停止在本机同步，或把它取回来。',
    deleteEverywhere: '在所有设备上删除', keepOnRemote: '保留在远端', getBack: '取回',
    deletedDetail: '另一台设备删除了它，但本机之后又改动过，所以没有移除。可以保留这一份并重新同步，也可以在本机一并删除。',
    keepMine: '保留这一份', deleteHere: '在本机一并删除',
    confirmEverywhereTitle: '在所有设备上删除同步内容？',
    confirmEverywhere: '要从本机和远端删除“{unit}”吗？其他设备下次同步时也会删除各自的副本。',
    confirmHereTitle: '删除本机副本？',
    confirmHere: '也要从本机删除“{unit}”吗？这会与远端已经记录的删除保持一致。',
    cancel: '取消', close: '关闭',
  },
  ja: {
    nav: '同期', loading: '同期状態を確認中…', loadFailed: '同期状態を確認できませんでした：{message}', refresh: '更新', run: '今すぐ同期', running: '同期中…', runOne: '同期', never: 'なし', lastRun: '前回の実行：{when}', dateLocale: 'ja-JP',
    empty: '同期するものはまだありません。ワールド、セッション、共有フォルダー（プロンプト、プリセット、ロアブック、アバター、インターフェースパック）は、内容ができるとここに表示されます。', problem: '同期を実行できません：{message}。「設定」の「ロールプレイ」で構成してください。', failed: '前回の操作に失敗しました：{message}', unit: '項目', kind: '種類', state: '状態', synced: '最終同期', details: '詳細', actions: '操作', tableCaption: 'ロールプレイ内容の同期状態',
    kind_world: 'ワールド', kind_session: 'セッション', kind_shared: '共有フォルダー', state_synced: '同期済み', state_changed: 'この端末で変更済み', state_new: '未同期', state_conflict: '選択が必要', state_busy: '同期中', state_failed: '失敗', state_ignored: 'リモートだけに保持', conflictWhole: '両方で変更されています。残す側を選んでください。もう一方は置き換えられます。', conflictFiles: '両方で変更されたため、次のファイルは二つのコピーを並べて保存しました：{files}。残すコピーを選んでください。', keepLocal: 'この端末のものを残す', keepRemote: 'リモートのものを残す',
    ignoredDetail: 'この端末だけで削除されています。リモートには残り、この端末へ再同期されません。', restore: '同期を再開', removedDetail: 'この端末から削除されましたが、リモートには残っています。すべての場所から削除するか、リモートだけに残してこの端末との同期を止めるか、もう一度取得してください。', deleteEverywhere: 'すべての場所から削除', keepOnRemote: 'リモートに残す', getBack: 'もう一度取得', deletedDetail: '別の端末で削除されましたが、その後この端末で変更されたため削除していません。このコピーを残して再同期するか、この端末でも削除してください。', keepMine: 'このコピーを残す', deleteHere: 'この端末でも削除',
    confirmEverywhereTitle: '同期内容をすべての場所から削除しますか？', confirmEverywhere: '「{unit}」をこの端末とリモートから削除しますか？ほかの端末のコピーも、次回の同期時に削除されます。', confirmHereTitle: 'この端末のコピーを削除しますか？', confirmHere: '「{unit}」をこの端末からも削除しますか？リモートに記録済みの削除と一致させます。', cancel: 'キャンセル', close: '閉じる',
  },
  es: {
    nav: 'Sincronización', loading: 'Leyendo el estado de sincronización…', loadFailed: 'No se ha podido leer el estado de sincronización: {message}', refresh: 'Actualizar', run: 'Sincronizar ahora', running: 'Sincronizando…', runOne: 'Sincronizar', never: 'nunca', lastRun: 'Última ejecución: {when}', dateLocale: 'es-ES',
    empty: 'Aún no hay nada que sincronizar. Los mundos, las sesiones y las carpetas compartidas (prompts, preajustes, libros de trasfondo, avatares y paquetes de interfaz) aparecerán aquí cuando tengan contenido.', problem: 'No se puede sincronizar: {message}. Configúralo en Juego de rol, dentro de Ajustes.', failed: 'La última acción ha fallado: {message}', unit: 'Elemento', kind: 'Tipo', state: 'Estado', synced: 'Última sincronización', details: 'Detalles', actions: 'Acciones', tableCaption: 'Estado de sincronización del contenido de juego de rol',
    kind_world: 'Mundo', kind_session: 'Sesión', kind_shared: 'Carpeta compartida', state_synced: 'Al día', state_changed: 'Modificado aquí', state_new: 'Aún sin sincronizar', state_conflict: 'Hay que elegir', state_busy: 'Sincronizando', state_failed: 'Fallido', state_ignored: 'Conservado en el servidor remoto', conflictWhole: 'Se ha modificado en ambos lados. Elige cuál conservar; el otro se sustituirá.', conflictFiles: 'Estos archivos cambiaron en ambos lados, por lo que se conservaron las dos copias: {files}. Elige cuál quieres mantener.', keepLocal: 'Conservar la de este dispositivo', keepRemote: 'Conservar la remota',
    ignoredDetail: 'Solo se ha eliminado en este dispositivo. Sigue en el servidor remoto y no se volverá a sincronizar aquí.', restore: 'Volver a sincronizar', removedDetail: 'Se eliminó en este dispositivo, pero sigue en el servidor remoto. Puedes eliminarlo de todas partes, conservarlo solo en el servidor remoto o recuperarlo.', deleteEverywhere: 'Eliminar de todas partes', keepOnRemote: 'Conservar en el servidor remoto', getBack: 'Recuperar', deletedDetail: 'Otro dispositivo lo eliminó, pero después se modificó aquí, por eso no se ha borrado. Conserva esta copia y vuelve a sincronizarla, o elimínala también aquí.', keepMine: 'Conservar esta copia', deleteHere: 'Eliminar también aquí',
    confirmEverywhereTitle: '¿Eliminar el contenido sincronizado de todas partes?', confirmEverywhere: '¿Eliminar «{unit}» de este dispositivo y del servidor remoto? Los demás dispositivos eliminarán sus copias la próxima vez que se sincronicen.', confirmHereTitle: '¿Eliminar la copia de este dispositivo?', confirmHere: '¿Eliminar también «{unit}» de este dispositivo? Así coincidirá con la eliminación ya registrada en el servidor remoto.', cancel: 'Cancelar', close: 'Cerrar',
  },
  fr: {
    nav: 'Synchronisation', loading: 'Lecture de l’état de synchronisation…', loadFailed: 'Impossible de lire l’état de synchronisation : {message}', refresh: 'Actualiser', run: 'Synchroniser maintenant', running: 'Synchronisation…', runOne: 'Synchroniser', never: 'jamais', lastRun: 'Dernière exécution : {when}', dateLocale: 'fr-FR',
    empty: 'Rien à synchroniser pour le moment. Les mondes, sessions et dossiers partagés (prompts, préréglages, recueils de connaissances, avatars et packs d’interface) apparaîtront ici dès qu’ils contiendront quelque chose.', problem: 'Impossible de synchroniser : {message}. Configurez la synchronisation dans Jeu de rôle, sous Paramètres.', failed: 'La dernière action a échoué : {message}', unit: 'Élément', kind: 'Type', state: 'État', synced: 'Dernière synchronisation', details: 'Détails', actions: 'Actions', tableCaption: 'État de synchronisation du contenu de jeu de rôle',
    kind_world: 'Monde', kind_session: 'Session', kind_shared: 'Dossier partagé', state_synced: 'À jour', state_changed: 'Modifié ici', state_new: 'Pas encore synchronisé', state_conflict: 'Choix nécessaire', state_busy: 'Synchronisation', state_failed: 'Échec', state_ignored: 'Conservé à distance', conflictWhole: 'Cet élément a été modifié des deux côtés. Choisissez la version à conserver ; l’autre sera remplacée.', conflictFiles: 'Ces fichiers ont été modifiés des deux côtés. Les deux copies ont donc été conservées côte à côte : {files}. Choisissez celle à garder.', keepLocal: 'Garder celle de cet appareil', keepRemote: 'Garder celle à distance',
    ignoredDetail: 'Supprimé uniquement sur cet appareil. L’élément existe toujours à distance et ne sera pas resynchronisé ici.', restore: 'Reprendre la synchronisation', removedDetail: 'Cet élément a été supprimé sur cet appareil, mais existe encore à distance. Supprimez-le partout, gardez-le uniquement à distance ou récupérez-le.', deleteEverywhere: 'Supprimer partout', keepOnRemote: 'Garder à distance', getBack: 'Récupérer', deletedDetail: 'Un autre appareil a supprimé cet élément, mais il a ensuite été modifié ici. Il n’a donc pas été effacé. Gardez cette copie et resynchronisez-la, ou supprimez-la également ici.', keepMine: 'Garder cette copie', deleteHere: 'Supprimer ici aussi',
    confirmEverywhereTitle: 'Supprimer le contenu synchronisé partout ?', confirmEverywhere: 'Supprimer « {unit} » de cet appareil et du stockage distant ? Les autres appareils supprimeront leur copie à leur prochaine synchronisation.', confirmHereTitle: 'Supprimer la copie de cet appareil ?', confirmHere: 'Supprimer également « {unit} » de cet appareil ? Cela correspondra à la suppression déjà enregistrée à distance.', cancel: 'Annuler', close: 'Fermer',
  },
  de: {
    nav: 'Synchronisierung', loading: 'Synchronisierungsstatus wird gelesen…', loadFailed: 'Der Synchronisierungsstatus konnte nicht gelesen werden: {message}', refresh: 'Aktualisieren', run: 'Jetzt synchronisieren', running: 'Wird synchronisiert…', runOne: 'Synchronisieren', never: 'nie', lastRun: 'Letzter Lauf: {when}', dateLocale: 'de-DE',
    empty: 'Noch nichts zu synchronisieren. Welten, Sitzungen und gemeinsame Ordner (Prompts, Vorlagen, Wissensbücher, Avatare und Oberflächenpakete) erscheinen hier, sobald sie Inhalte enthalten.', problem: 'Synchronisierung nicht möglich: {message}. Richte sie unter Einstellungen → Rollenspiel ein.', failed: 'Die letzte Aktion ist fehlgeschlagen: {message}', unit: 'Einheit', kind: 'Art', state: 'Status', synced: 'Zuletzt synchronisiert', details: 'Details', actions: 'Aktionen', tableCaption: 'Synchronisierungsstatus der Rollenspielinhalte',
    kind_world: 'Welt', kind_session: 'Sitzung', kind_shared: 'Gemeinsamer Ordner', state_synced: 'Aktuell', state_changed: 'Hier geändert', state_new: 'Noch nicht synchronisiert', state_conflict: 'Auswahl nötig', state_busy: 'Wird synchronisiert', state_failed: 'Fehlgeschlagen', state_ignored: 'Nur im Remotespeicher behalten', conflictWhole: 'Beide Seiten haben dieses Element geändert. Wähle eine Fassung; die andere wird ersetzt.', conflictFiles: 'Diese Dateien wurden auf beiden Seiten geändert. Daher wurden beide Kopien nebeneinander behalten: {files}. Wähle die Kopie, die bleiben soll.', keepLocal: 'Fassung dieses Geräts behalten', keepRemote: 'Remote-Fassung behalten',
    ignoredDetail: 'Nur auf diesem Gerät gelöscht. Im Remotespeicher ist das Element noch vorhanden und wird nicht zurücksynchronisiert.', restore: 'Wieder synchronisieren', removedDetail: 'Auf diesem Gerät wurde das Element entfernt, im Remotespeicher ist es noch vorhanden. Du kannst es überall löschen, nur im Remotespeicher behalten oder zurückholen.', deleteEverywhere: 'Überall löschen', keepOnRemote: 'Im Remotespeicher behalten', getBack: 'Zurückholen', deletedDetail: 'Ein anderes Gerät hat dieses Element gelöscht, danach wurde es hier geändert. Deshalb wurde es nicht entfernt. Behalte und synchronisiere diese Kopie erneut oder lösche sie auch hier.', keepMine: 'Diese Kopie behalten', deleteHere: 'Auch hier löschen',
    confirmEverywhereTitle: 'Synchronisierte Inhalte überall löschen?', confirmEverywhere: '„{unit}“ von diesem Gerät und aus dem Remotespeicher löschen? Andere Geräte löschen ihre Kopien bei der nächsten Synchronisierung.', confirmHereTitle: 'Kopie auf diesem Gerät löschen?', confirmHere: '„{unit}“ auch von diesem Gerät löschen? Das entspricht der bereits im Remotespeicher vermerkten Löschung.', cancel: 'Abbrechen', close: 'Schließen',
  },
  ru: {
    nav: 'Синхронизация', loading: 'Чтение состояния синхронизации…', loadFailed: 'Не удалось прочитать состояние синхронизации: {message}', refresh: 'Обновить', run: 'Синхронизировать сейчас', running: 'Синхронизация…', runOne: 'Синхронизировать', never: 'никогда', lastRun: 'Последний запуск: {when}', dateLocale: 'ru-RU',
    empty: 'Синхронизировать пока нечего. Миры, сеансы и общие папки (промпты, пресеты, книги знаний, аватары и пакеты интерфейса) появятся здесь, когда в них будут данные.', problem: 'Синхронизацию нельзя запустить: {message}. Настройте её в разделе «Ролевая игра» настроек.', failed: 'Последнее действие завершилось ошибкой: {message}', unit: 'Объект', kind: 'Тип', state: 'Состояние', synced: 'Последняя синхронизация', details: 'Подробности', actions: 'Действия', tableCaption: 'Состояние синхронизации ролевых данных',
    kind_world: 'Мир', kind_session: 'Сеанс', kind_shared: 'Общая папка', state_synced: 'Синхронизировано', state_changed: 'Изменено здесь', state_new: 'Ещё не синхронизировано', state_conflict: 'Нужно выбрать', state_busy: 'Синхронизация', state_failed: 'Ошибка', state_ignored: 'Сохранено только удалённо', conflictWhole: 'Объект изменён с обеих сторон. Выберите версию, которую нужно оставить; другая будет заменена.', conflictFiles: 'Эти файлы изменены с обеих сторон, поэтому обе копии сохранены рядом: {files}. Выберите, какую оставить.', keepLocal: 'Оставить версию с этого устройства', keepRemote: 'Оставить удалённую версию',
    ignoredDetail: 'Удалено только на этом устройстве. Удалённая копия сохраняется и не будет загружена обратно.', restore: 'Снова синхронизировать', removedDetail: 'Объект удалён на этом устройстве, но сохранился удалённо. Удалите его везде, оставьте только удалённо или восстановите здесь.', deleteEverywhere: 'Удалить везде', keepOnRemote: 'Оставить удалённо', getBack: 'Восстановить', deletedDetail: 'Другое устройство удалило объект, но после этого он был изменён здесь, поэтому локальную копию не удалили. Оставьте её и синхронизируйте заново либо удалите и здесь.', keepMine: 'Оставить эту копию', deleteHere: 'Удалить и здесь',
    confirmEverywhereTitle: 'Удалить синхронизированные данные везде?', confirmEverywhere: 'Удалить «{unit}» с этого устройства и из удалённого хранилища? Другие устройства удалят свои копии при следующей синхронизации.', confirmHereTitle: 'Удалить копию с этого устройства?', confirmHere: 'Также удалить «{unit}» с этого устройства? Это приведёт его в соответствие с удалением, уже записанным в удалённом хранилище.', cancel: 'Отмена', close: 'Закрыть',
  },
  pt: {
    nav: 'Sincronização', loading: 'A ler o estado da sincronização…', loadFailed: 'Não foi possível ler o estado da sincronização: {message}', refresh: 'Atualizar', run: 'Sincronizar agora', running: 'A sincronizar…', runOne: 'Sincronizar', never: 'nunca', lastRun: 'Última execução: {when}', dateLocale: 'pt-PT',
    empty: 'Ainda não há nada para sincronizar. Os mundos, as sessões e as pastas partilhadas (prompts, predefinições, livros de conhecimento, avatares e pacotes de interface) aparecem aqui quando tiverem conteúdo.', problem: 'Não é possível sincronizar: {message}. Configure a sincronização em Jogo de interpretação, nas Definições.', failed: 'A última ação falhou: {message}', unit: 'Elemento', kind: 'Tipo', state: 'Estado', synced: 'Última sincronização', details: 'Detalhes', actions: 'Ações', tableCaption: 'Estado da sincronização do conteúdo de jogo de interpretação',
    kind_world: 'Mundo', kind_session: 'Sessão', kind_shared: 'Pasta partilhada', state_synced: 'Atualizado', state_changed: 'Alterado aqui', state_new: 'Ainda não sincronizado', state_conflict: 'É preciso escolher', state_busy: 'A sincronizar', state_failed: 'Falhou', state_ignored: 'Mantido remotamente', conflictWhole: 'Este elemento foi alterado dos dois lados. Escolha qual manter; o outro será substituído.', conflictFiles: 'Estes ficheiros foram alterados dos dois lados, por isso as duas cópias foram mantidas lado a lado: {files}. Escolha qual pretende manter.', keepLocal: 'Manter a deste dispositivo', keepRemote: 'Manter a remota',
    ignoredDetail: 'Eliminado apenas neste dispositivo. Continua disponível remotamente e não voltará a ser sincronizado para cá.', restore: 'Voltar a sincronizar', removedDetail: 'Foi removido deste dispositivo, mas continua disponível remotamente. Elimine-o em todo o lado, mantenha-o apenas remotamente ou recupere-o.', deleteEverywhere: 'Eliminar em todo o lado', keepOnRemote: 'Manter remotamente', getBack: 'Recuperar', deletedDetail: 'Outro dispositivo eliminou este elemento, mas ele foi alterado aqui entretanto, por isso não foi removido. Mantenha esta cópia e volte a sincronizá-la, ou elimine-a também aqui.', keepMine: 'Manter esta cópia', deleteHere: 'Eliminar também aqui',
    confirmEverywhereTitle: 'Eliminar conteúdo sincronizado em todo o lado?', confirmEverywhere: 'Eliminar «{unit}» deste dispositivo e do armazenamento remoto? Os outros dispositivos eliminarão as suas cópias na próxima sincronização.', confirmHereTitle: 'Eliminar a cópia deste dispositivo?', confirmHere: 'Eliminar também «{unit}» deste dispositivo? Isto corresponde à eliminação já registada remotamente.', cancel: 'Cancelar', close: 'Fechar',
  },
}
