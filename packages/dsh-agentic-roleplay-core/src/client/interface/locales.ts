import type { Dictionaries } from '../i18n.ts'

export type InterfaceLocaleKey = 'tab' | 'notRoleplay' | 'noPack' | 'noTab' | 'problems' | 'hud' | 'dock' | 'opening' | 'backdrop' | 'sidebar' | 'sidebarTitle' | 'sidebarDescription' | 'sidebarBack' | 'sidebarNone'

export const dictionaries: Dictionaries<InterfaceLocaleKey> = {
  en: {
    tab: 'Interface',
    notRoleplay: 'This chat is not a roleplay session.',
    noPack: 'This story has no interface pack. A world can carry one in its ui folder, or you can put one in the ui folder of your roleplay folder and name it in the story\'s settings.',
    noTab: 'The interface pack of this story has no tab.',
    problems: 'The interface pack cannot be used:',
    hud: 'Status',
    dock: 'Actions',
    opening: 'Opening',
    backdrop: 'Backdrop',
    sidebar: 'Sidebar page',
    sidebarTitle: 'Interface page',
    sidebarDescription: 'A page of this story\'s interface pack',
    sidebarBack: 'Back',
    sidebarNone: 'This story\'s interface pack has no page for the sidebar.',
  },
  zh: {
    tab: '界面',
    notRoleplay: '此聊天不是角色扮演会话。',
    noPack: '此故事没有界面包。世界可以在其 ui 文件夹中携带界面包，也可以把界面包放进角色扮演目录的 ui 文件夹，并在故事设置中指定名称。',
    noTab: '此故事的界面包没有标签页。',
    problems: '无法使用界面包：',
    hud: '状态',
    dock: '操作',
    opening: '开场',
    backdrop: '背景',
    sidebar: '侧栏页面',
    sidebarTitle: '界面页面',
    sidebarDescription: '此故事界面包的一个页面',
    sidebarBack: '返回',
    sidebarNone: '此故事的界面包没有侧栏页面。',
  },
  ja: { tab: 'インターフェース', notRoleplay: 'このチャットはロールプレイセッションではありません。', noPack: 'この物語にはインターフェースパックがありません。ワールドの ui フォルダーに含めるか、ロールプレイフォルダー内の ui フォルダーに置いて物語の設定で名前を指定できます。', noTab: 'この物語のインターフェースパックにはタブがありません。', problems: 'インターフェースパックを使用できません：', hud: 'ステータス', dock: 'アクション', opening: 'オープニング', backdrop: '背景', sidebar: 'サイドバーページ', sidebarTitle: 'インターフェースページ', sidebarDescription: 'この物語のインターフェースパックに含まれるページ', sidebarBack: '戻る', sidebarNone: 'この物語のインターフェースパックにはサイドバー用のページがありません。' },
  es: { tab: 'Interfaz', notRoleplay: 'Este chat no es una sesión de juego de rol.', noPack: 'Esta historia no tiene paquete de interfaz. Un mundo puede incluir uno en su carpeta ui. También puedes ponerlo en la carpeta ui de tu carpeta de juego de rol e indicar su nombre en los ajustes de la historia.', noTab: 'El paquete de interfaz de esta historia no tiene ninguna pestaña.', problems: 'No se puede usar el paquete de interfaz:', hud: 'Estado', dock: 'Acciones', opening: 'Inicio', backdrop: 'Fondo', sidebar: 'Página de la barra lateral', sidebarTitle: 'Página de interfaz', sidebarDescription: 'Una página del paquete de interfaz de esta historia', sidebarBack: 'Atrás', sidebarNone: 'El paquete de interfaz de esta historia no tiene una página para la barra lateral.' },
  fr: { tab: 'Interface', notRoleplay: 'Cette discussion n’est pas une session de jeu de rôle.', noPack: 'Cette histoire n’a pas de pack d’interface. Un monde peut en inclure un dans son dossier ui. Vous pouvez aussi le placer dans le dossier ui de votre dossier de jeu de rôle et indiquer son nom dans les réglages de l’histoire.', noTab: 'Le pack d’interface de cette histoire ne contient aucun onglet.', problems: 'Le pack d’interface ne peut pas être utilisé :', hud: 'État', dock: 'Actions', opening: 'Ouverture', backdrop: 'Arrière-plan', sidebar: 'Page de la barre latérale', sidebarTitle: 'Page d’interface', sidebarDescription: 'Une page du pack d’interface de cette histoire', sidebarBack: 'Retour', sidebarNone: 'Le pack d’interface de cette histoire n’a pas de page pour la barre latérale.' },
  de: { tab: 'Oberfläche', notRoleplay: 'Dieser Chat ist keine Rollenspielsitzung.', noPack: 'Diese Geschichte hat kein Oberflächenpaket. Eine Welt kann eines im Ordner ui enthalten. Du kannst es auch im ui-Ordner deines Rollenspielordners ablegen und in den Einstellungen der Geschichte benennen.', noTab: 'Das Oberflächenpaket dieser Geschichte hat keinen Tab.', problems: 'Das Oberflächenpaket kann nicht verwendet werden:', hud: 'Status', dock: 'Aktionen', opening: 'Auftakt', backdrop: 'Hintergrund', sidebar: 'Seitenleisten-Seite', sidebarTitle: 'Oberflächen-Seite', sidebarDescription: 'Eine Seite aus dem Oberflächenpaket dieser Geschichte', sidebarBack: 'Zurück', sidebarNone: 'Das Oberflächenpaket dieser Geschichte enthält keine Seite für die Seitenleiste.' },
  ru: { tab: 'Интерфейс', notRoleplay: 'Этот чат не является ролевым сеансом.', noPack: 'У этой истории нет пакета интерфейса. Его можно поместить в папку ui мира или в папку ui каталога ролевой игры и указать имя в настройках истории.', noTab: 'В пакете интерфейса этой истории нет вкладки.', problems: 'Пакет интерфейса нельзя использовать:', hud: 'Состояние', dock: 'Действия', opening: 'Вступление', backdrop: 'Фон', sidebar: 'Страница боковой панели', sidebarTitle: 'Страница интерфейса', sidebarDescription: 'Страница из пакета интерфейса этой истории', sidebarBack: 'Назад', sidebarNone: 'В пакете интерфейса этой истории нет страницы для боковой панели.' },
  pt: { tab: 'Interface', notRoleplay: 'Esta conversa não é uma sessão de jogo de interpretação.', noPack: 'Esta história não tem um pacote de interface. Um mundo pode incluir um na pasta ui. Também pode colocá-lo na pasta ui da sua pasta de jogo de interpretação e indicar o nome nas definições da história.', noTab: 'O pacote de interface desta história não tem nenhum separador.', problems: 'Não é possível usar o pacote de interface:', hud: 'Estado', dock: 'Ações', opening: 'Abertura', backdrop: 'Fundo', sidebar: 'Página da barra lateral', sidebarTitle: 'Página da interface', sidebarDescription: 'Uma página do pacote de interface desta história', sidebarBack: 'Voltar', sidebarNone: 'O pacote de interface desta história não tem uma página para a barra lateral.' },
}
