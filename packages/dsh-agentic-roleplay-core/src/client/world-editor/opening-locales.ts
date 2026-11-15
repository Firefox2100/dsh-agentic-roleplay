import type { Dictionaries } from '../i18n.ts'

export type OpeningLocaleKey =
  | 'plainHelp' | 'partsHelp' | 'toParts' | 'toPlain' | 'toPlainBlocked' | 'addNarration' | 'addSpeech' | 'remove' | 'up' | 'down' | 'narration' | 'speech' | 'speaker' | 'noSpeaker' | 'text' | 'addImage' | 'picture' | 'choosePicture' | 'noPictures' | 'pictureMissing' | 'toPlainBlockedMore'

export const dictionaries: Dictionaries<OpeningLocaleKey> = {
  en: {
    plainHelp: 'Plain text is narration only. Split it into parts to give lines to characters.', partsHelp: 'Parts are read in order: narration, and lines a character speaks.',
    toParts: 'Split into parts', toPlain: 'Make plain text', toPlainBlocked: 'Remove the lines spoken by characters first', addNarration: 'Add narration', addSpeech: 'Add a spoken line',
    remove: 'Remove', up: 'Move up', down: 'Move down', narration: 'Narration', speech: 'Spoken line', speaker: 'Who speaks', noSpeaker: 'Choose a character', text: 'Text',
    addImage: 'Add a picture', picture: 'Picture', choosePicture: 'Choose a picture', noPictures: 'The world has no pictures yet: add some in Images first.', pictureMissing: 'This picture is not in the world\'s images any more', toPlainBlockedMore: 'A picture or a spoken line needs parts: remove them first',
  },
  zh: {
    plainHelp: '纯文本只是叙述。拆分成多个部分后，才能给角色安排台词。', partsHelp: '各部分按顺序阅读：叙述，以及角色说的话。',
    toParts: '拆分成多个部分', toPlain: '改为纯文本', toPlainBlocked: '请先移除角色的台词', addNarration: '添加叙述', addSpeech: '添加台词',
    remove: '移除', up: '上移', down: '下移', narration: '叙述', speech: '台词', speaker: '说话者', noSpeaker: '选择角色', text: '内容',
    addImage: '添加图片', picture: '图片', choosePicture: '选择图片', noPictures: '世界里还没有图片：请先在“图片”里添加。', pictureMissing: '这张图片已不在世界的图片里', toPlainBlockedMore: '图片或台词需要分成多个部分：请先移除它们',
  },
  ja: {
    plainHelp: 'プレーンテキストはナレーションのみです。キャラクターのセリフを入れるにはパートに分けます。', partsHelp: 'パートは順に読まれます：ナレーションと、キャラクターのセリフ。',
    toParts: 'パートに分ける', toPlain: 'プレーンテキストにする', toPlainBlocked: '先にキャラクターのセリフを削除してください', addNarration: 'ナレーションを追加', addSpeech: 'セリフを追加',
    remove: '削除', up: '上へ', down: '下へ', narration: 'ナレーション', speech: 'セリフ', speaker: '話し手', noSpeaker: 'キャラクターを選択', text: '本文',
    addImage: '画像を追加', picture: '画像', choosePicture: '画像を選択', noPictures: 'このワールドにはまだ画像がありません。先に「画像」で追加してください。', pictureMissing: 'この画像はワールドの画像にもうありません', toPlainBlockedMore: '画像やセリフにはパートが必要です。先に削除してください',
  },
  es: {
    plainHelp: 'El texto sin formato es solo narración. Divídelo en partes para dar líneas a los personajes.', partsHelp: 'Las partes se leen en orden: narración y líneas que dice un personaje.',
    toParts: 'Dividir en partes', toPlain: 'Convertir en texto sin formato', toPlainBlocked: 'Quita primero las líneas dichas por personajes', addNarration: 'Añadir narración', addSpeech: 'Añadir una línea hablada',
    remove: 'Quitar', up: 'Subir', down: 'Bajar', narration: 'Narración', speech: 'Línea hablada', speaker: 'Quién habla', noSpeaker: 'Elige un personaje', text: 'Texto',
    addImage: 'Añadir una imagen', picture: 'Imagen', choosePicture: 'Elige una imagen', noPictures: 'El mundo aún no tiene imágenes: añade algunas primero en Imágenes.', pictureMissing: 'Esta imagen ya no está en las imágenes del mundo', toPlainBlockedMore: 'Una imagen o una línea hablada necesita partes: quítalas primero',
  },
  fr: {
    plainHelp: 'Le texte simple n’est que de la narration. Découpez-le en parties pour donner des répliques aux personnages.', partsHelp: 'Les parties se lisent dans l’ordre : narration et répliques d’un personnage.',
    toParts: 'Découper en parties', toPlain: 'Convertir en texte simple', toPlainBlocked: 'Retirez d’abord les répliques des personnages', addNarration: 'Ajouter de la narration', addSpeech: 'Ajouter une réplique',
    remove: 'Retirer', up: 'Monter', down: 'Descendre', narration: 'Narration', speech: 'Réplique', speaker: 'Qui parle', noSpeaker: 'Choisir un personnage', text: 'Texte',
    addImage: 'Ajouter une image', picture: 'Image', choosePicture: 'Choisissez une image', noPictures: 'Le monde n’a pas encore d’images : ajoutez-en d’abord dans Images.', pictureMissing: 'Cette image n’est plus dans les images du monde', toPlainBlockedMore: 'Une image ou une réplique demande des parties : retirez-les d’abord',
  },
  de: {
    plainHelp: 'Reiner Text ist nur Erzählung. Teile ihn in Abschnitte, um Figuren Zeilen zu geben.', partsHelp: 'Abschnitte werden der Reihe nach gelesen: Erzählung und Zeilen, die eine Figur spricht.',
    toParts: 'In Abschnitte teilen', toPlain: 'In reinen Text umwandeln', toPlainBlocked: 'Entferne zuerst die gesprochenen Zeilen der Figuren', addNarration: 'Erzählung hinzufügen', addSpeech: 'Gesprochene Zeile hinzufügen',
    remove: 'Entfernen', up: 'Nach oben', down: 'Nach unten', narration: 'Erzählung', speech: 'Gesprochene Zeile', speaker: 'Wer spricht', noSpeaker: 'Figur wählen', text: 'Text',
    addImage: 'Bild hinzufügen', picture: 'Bild', choosePicture: 'Bild wählen', noPictures: 'Die Welt hat noch keine Bilder: Füge zuerst unter Bilder welche hinzu.', pictureMissing: 'Dieses Bild ist nicht mehr in den Bildern der Welt', toPlainBlockedMore: 'Ein Bild oder eine gesprochene Zeile braucht Teile: Entferne sie zuerst',
  },
  ru: {
    plainHelp: 'Простой текст — это только повествование. Разбейте его на части, чтобы дать персонажам реплики.', partsHelp: 'Части читаются по порядку: повествование и реплики персонажей.',
    toParts: 'Разбить на части', toPlain: 'Сделать простым текстом', toPlainBlocked: 'Сначала удалите реплики персонажей', addNarration: 'Добавить повествование', addSpeech: 'Добавить реплику',
    remove: 'Удалить', up: 'Вверх', down: 'Вниз', narration: 'Повествование', speech: 'Реплика', speaker: 'Кто говорит', noSpeaker: 'Выберите персонажа', text: 'Текст',
    addImage: 'Добавить изображение', picture: 'Изображение', choosePicture: 'Выберите изображение', noPictures: 'В мире пока нет изображений: сначала добавьте их в разделе «Изображения».', pictureMissing: 'Этого изображения больше нет среди изображений мира', toPlainBlockedMore: 'Изображение или реплика требуют частей: сначала удалите их',
  },
  pt: {
    plainHelp: 'Texto simples é só narração. Divida em partes para dar falas aos personagens.', partsHelp: 'As partes são lidas em ordem: narração e falas de um personagem.',
    toParts: 'Dividir em partes', toPlain: 'Converter em texto simples', toPlainBlocked: 'Remova primeiro as falas dos personagens', addNarration: 'Adicionar narração', addSpeech: 'Adicionar uma fala',
    remove: 'Remover', up: 'Subir', down: 'Descer', narration: 'Narração', speech: 'Fala', speaker: 'Quem fala', noSpeaker: 'Escolha um personagem', text: 'Texto',
    addImage: 'Adicionar uma imagem', picture: 'Imagem', choosePicture: 'Escolha uma imagem', noPictures: 'O mundo ainda não tem imagens: adicione algumas primeiro em Imagens.', pictureMissing: 'Esta imagem já não está nas imagens do mundo', toPlainBlockedMore: 'Uma imagem ou uma fala precisa de partes: remova-as primeiro',
  },
}
