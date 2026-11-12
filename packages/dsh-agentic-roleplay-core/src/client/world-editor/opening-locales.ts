import type { Dictionaries } from '../i18n.ts'

export type OpeningLocaleKey =
  | 'plainHelp' | 'partsHelp' | 'toParts' | 'toPlain' | 'toPlainBlocked' | 'addNarration' | 'addSpeech' | 'remove' | 'up' | 'down' | 'narration' | 'speech' | 'speaker' | 'noSpeaker' | 'text'

export const dictionaries: Dictionaries<OpeningLocaleKey> = {
  en: {
    plainHelp: 'Plain text is narration only. Split it into parts to give lines to characters.', partsHelp: 'Parts are read in order: narration, and lines a character speaks.',
    toParts: 'Split into parts', toPlain: 'Make plain text', toPlainBlocked: 'Remove the lines spoken by characters first', addNarration: 'Add narration', addSpeech: 'Add a spoken line',
    remove: 'Remove', up: 'Move up', down: 'Move down', narration: 'Narration', speech: 'Spoken line', speaker: 'Who speaks', noSpeaker: 'Choose a character', text: 'Text',
  },
  zh: {
    plainHelp: '纯文本只是叙述。拆分成多个部分后，才能给角色安排台词。', partsHelp: '各部分按顺序阅读：叙述，以及角色说的话。',
    toParts: '拆分成多个部分', toPlain: '改为纯文本', toPlainBlocked: '请先移除角色的台词', addNarration: '添加叙述', addSpeech: '添加台词',
    remove: '移除', up: '上移', down: '下移', narration: '叙述', speech: '台词', speaker: '说话者', noSpeaker: '选择角色', text: '内容',
  },
  ja: {
    plainHelp: 'プレーンテキストはナレーションのみです。キャラクターのセリフを入れるにはパートに分けます。', partsHelp: 'パートは順に読まれます：ナレーションと、キャラクターのセリフ。',
    toParts: 'パートに分ける', toPlain: 'プレーンテキストにする', toPlainBlocked: '先にキャラクターのセリフを削除してください', addNarration: 'ナレーションを追加', addSpeech: 'セリフを追加',
    remove: '削除', up: '上へ', down: '下へ', narration: 'ナレーション', speech: 'セリフ', speaker: '話し手', noSpeaker: 'キャラクターを選択', text: '本文',
  },
  es: {
    plainHelp: 'El texto sin formato es solo narración. Divídelo en partes para dar líneas a los personajes.', partsHelp: 'Las partes se leen en orden: narración y líneas que dice un personaje.',
    toParts: 'Dividir en partes', toPlain: 'Convertir en texto sin formato', toPlainBlocked: 'Quita primero las líneas dichas por personajes', addNarration: 'Añadir narración', addSpeech: 'Añadir una línea hablada',
    remove: 'Quitar', up: 'Subir', down: 'Bajar', narration: 'Narración', speech: 'Línea hablada', speaker: 'Quién habla', noSpeaker: 'Elige un personaje', text: 'Texto',
  },
  fr: {
    plainHelp: 'Le texte simple n’est que de la narration. Découpez-le en parties pour donner des répliques aux personnages.', partsHelp: 'Les parties se lisent dans l’ordre : narration et répliques d’un personnage.',
    toParts: 'Découper en parties', toPlain: 'Convertir en texte simple', toPlainBlocked: 'Retirez d’abord les répliques des personnages', addNarration: 'Ajouter de la narration', addSpeech: 'Ajouter une réplique',
    remove: 'Retirer', up: 'Monter', down: 'Descendre', narration: 'Narration', speech: 'Réplique', speaker: 'Qui parle', noSpeaker: 'Choisir un personnage', text: 'Texte',
  },
  de: {
    plainHelp: 'Reiner Text ist nur Erzählung. Teile ihn in Abschnitte, um Figuren Zeilen zu geben.', partsHelp: 'Abschnitte werden der Reihe nach gelesen: Erzählung und Zeilen, die eine Figur spricht.',
    toParts: 'In Abschnitte teilen', toPlain: 'In reinen Text umwandeln', toPlainBlocked: 'Entferne zuerst die gesprochenen Zeilen der Figuren', addNarration: 'Erzählung hinzufügen', addSpeech: 'Gesprochene Zeile hinzufügen',
    remove: 'Entfernen', up: 'Nach oben', down: 'Nach unten', narration: 'Erzählung', speech: 'Gesprochene Zeile', speaker: 'Wer spricht', noSpeaker: 'Figur wählen', text: 'Text',
  },
  ru: {
    plainHelp: 'Простой текст — это только повествование. Разбейте его на части, чтобы дать персонажам реплики.', partsHelp: 'Части читаются по порядку: повествование и реплики персонажей.',
    toParts: 'Разбить на части', toPlain: 'Сделать простым текстом', toPlainBlocked: 'Сначала удалите реплики персонажей', addNarration: 'Добавить повествование', addSpeech: 'Добавить реплику',
    remove: 'Удалить', up: 'Вверх', down: 'Вниз', narration: 'Повествование', speech: 'Реплика', speaker: 'Кто говорит', noSpeaker: 'Выберите персонажа', text: 'Текст',
  },
  pt: {
    plainHelp: 'Texto simples é só narração. Divida em partes para dar falas aos personagens.', partsHelp: 'As partes são lidas em ordem: narração e falas de um personagem.',
    toParts: 'Dividir em partes', toPlain: 'Converter em texto simples', toPlainBlocked: 'Remova primeiro as falas dos personagens', addNarration: 'Adicionar narração', addSpeech: 'Adicionar uma fala',
    remove: 'Remover', up: 'Subir', down: 'Descer', narration: 'Narração', speech: 'Fala', speaker: 'Quem fala', noSpeaker: 'Escolha um personagem', text: 'Texto',
  },
}
