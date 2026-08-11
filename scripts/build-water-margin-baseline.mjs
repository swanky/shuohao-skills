#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'testdata', 'corpora', 'classic-chinese-novels', '水滸傳.txt');
const outDir = path.join(root, 'testdata', 'benchmarks', 'novel-characters', 'classic-chinese-novels', '水滸傳-主要角色');
const source = fs.readFileSync(sourcePath, 'utf8');

const photoreal = {
  render: 'Live-action photography, not illustration: a real wardrobe camera-test photograph of a real human being on a film production, shot on a full-frame cinema camera with a 50-85mm lens at a moderate aperture against a neutral warm-gray seamless studio backdrop, the finish and honesty of a costume-department test still',
  surface: 'True photographic skin: real visible pores, fine vellus hair, uneven natural tone, faint capillaries at the nostrils and ear rims, genuine subsurface scattering, moles and freckles left in place, no beauty retouching and no skin smoothing; eyes with a real catchlight from the key light, moist lower lid, resolvable iris fibres and a limbal ring; eyebrows and eyelids honestly asymmetric; loose individual hair strands catching the light and breaking the silhouette. Real garments with true cloth weight, visible weave, stitched seams and hems, natural drape, self-shadowing folds and honest wear at cuffs, elbows and knees',
  negative: 'illustration, painting, drawing, sketch, anime, manga, cartoon, cel shading, CGI, 3d game render, plastic skin, waxy skin, poreless doll face, beauty-filter retouching, perfectly symmetrical face, dead eyes, helmet hair, flat fabric, cheap cosplay, modern clothing, Qing dynasty queue, fantasy armour unrelated to the source, extra fingers, malformed hands, text, watermark, signature, busy background',
  tags: ['live-action', 'photographic', 'wardrobe camera test', 'character sheet', 'real skin texture', 'historical drama'],
};

function evidenceFor(spec) {
  const needles = spec.evidenceNames ?? [spec.name, ...spec.aliases];
  const lines = source.replaceAll('\r\n', '\n').split('\n').map((line) => line.trim());
  const candidates = [...new Set(lines.filter((line) => line.length >= 12 && !/^第.{1,12}回/.test(line) && needles.some((name) => line.includes(name))))];
  if (!candidates.length) throw new Error(`找不到原文證據：${spec.name}`);
  if (candidates.length <= 4) return candidates;
  return [0, 0.33, 0.67, 1].map((ratio) => candidates[Math.round((candidates.length - 1) * ratio)]);
}

function makeCard(spec) {
  const visual = `${spec.visualEn} ${spec.costumeEn}`;
  const prompt = `${photoreal.render}. ${visual} Three-quarter waist-up portrait, face in sharpest focus, soft-box key from upper left and gentle cool fill. ${photoreal.surface}. No illustration, CGI, text or watermark.`;
  const sheet = `Use case: historical-scene. Asset type: live-action production character model sheet. Create ONE 16:9 landscape canvas. CHARACTER: ${visual} Divide the canvas into three zones with thin hairline rules. LEFT ZONE, about 34% of the width: one large front-facing head-and-shoulders bust, centred like an ID photograph, both shoulders fully visible with clear side margins, clean straight horizontal bottom cut. This is the facial identity anchor. LIGHTING IN THE LEFT ZONE ONLY: soft-box key from upper left, gentle bounce fill and real ambient occlusion under chin, in eye sockets and at the collar. RIGHT-TOP ZONE: exactly three equal-height FULL-BODY views of the SAME actor, true front, strict 90-degree left profile and true back, on a shared ground line. They must match the bust exactly in face, age, body, hair, garments, colours and footwear. PROPORTIONS ARE CRITICAL: correct anatomy and limb lengths, clear margins above head and below feet, no stretching, squashing or foreshortening. LIGHTING IN THE RIGHT ZONES: flat even orthographic frontal studio light, no cast shadow on backdrop. RIGHT-BOTTOM ZONE: four to five small isolated detail studies: ${spec.detailsEn}. Details are smaller than figures; if space is tight extend them down the right edge; the detail studies give way, not the figures. Plain pure white background, generous even margins, no scenery, no written labels, no text, no watermark, no extra people. ${photoreal.render}. ${photoreal.surface}.`;
  return {
    name: spec.name,
    aliases: spec.aliases,
    importance: spec.importance ?? 'major',
    oneLiner: spec.oneLiner,
    persona: {
      gender: spec.gender,
      ageRange: spec.age,
      identity: spec.identity,
      appearance: `${spec.visualLocal}${spec.costumeLocal}（推斷）`,
      personality: spec.traits,
      temperament: spec.temperament,
      motivation: spec.motivation,
      arc: spec.arc,
      relationships: spec.relationships.map(([name, relation]) => ({name, relation})),
      evidence: evidenceFor(spec),
    },
    image: {
      style: `擬真實拍宋代末年江湖歷史劇試裝定妝照，${spec.palette}`,
      prompt,
      promptLocal: `擬真實拍宋代末年江湖歷史劇試裝定妝照：${spec.visualLocal}${spec.costumeLocal}四分之三半身視角，暖灰棚拍背景，左上柔光箱主光，保留自然皮膚、髮絲與衣料織紋。`,
      negativePrompt: `${photoreal.negative}, ${spec.negativeEn ?? 'glamour pose, pristine ceremonial costume, generic wuxia fantasy'}`,
      tags: photoreal.tags,
      sheet,
    },
    voice: {
      timbre: spec.voice.timbre,
      pitch: spec.voice.pitch,
      pace: spec.voice.pace,
      accent: spec.voice.accent,
      emotion: spec.voice.emotion,
      referenceHint: spec.voice.hint,
      prompt: spec.voice.en,
      promptLocal: spec.voice.local,
    },
  };
}

const specs = [
  {
    name:'扈三娘', aliases:['一丈青'], gender:'女', age:'約二十至二十五歲（推斷）', identity:'獨龍岡扈家莊女將，後成為梁山馬軍頭領',
    oneLiner:'善使雙刀、能在馬上擒將的年輕女將，在家族覆滅與被安排婚姻後仍以戰技取得梁山席位。', traits:['勇猛','冷靜','技藝純熟','寡言','堅忍'],
    temperament:'臨陣判斷迅速，面對強敵不亂；私人情緒在梁山秩序中多被壓住，行動比言語更清楚。', motivation:'保全自身並以武藝建立不可忽視的位置，在失去原有家族後維持戰士尊嚴。',
    arc:'從扈家莊守將成為梁山俘虜，家族崩解後被納入新的婚姻與軍事秩序；她的沉默凸顯武勇與自主之間的裂縫。',
    relationships:[['王英','被宋江安排成婚的丈夫'],['宋江','決定她梁山身分與婚姻的領袖'],['林沖','交戰後擒住她的梁山將領']], evidenceNames:['扈三娘','一丈青'],
    visualLocal:'北宋山東約二十三歲的漢族女將，長圓臉、目光銳利，體格精實，長期騎戰形成挺直而平衡的站姿。', costumeLocal:'穿暗紅短戰袍、靛青窄袖內衣與低調札甲，束皮革護腰，配雙刀、護腕與黑色騎戰靴。',
    visualEn:'a twenty-three-year-old Han Chinese cavalrywoman in early-12th-century Shandong, long-round face, sharp steady eyes, lean athletic build and balanced horse-fighter posture', costumeEn:'She wears a dark-red short battle robe over indigo narrow sleeves, restrained lamellar protection, leather waist guard, paired sabres, wrist guards and black riding boots.', palette:'暗紅、靛青與鐵黑配色', detailsEn:'paired sabre hilts, leather wrist guard, restrained lamellar plates, battle sash, black riding boot', negativeEn:'sexualized armour, exposed thighs, fragile dancer body, ornate palace dress',
    voice:{timbre:'清冷結實的年輕女中音',pitch:'中音',pace:'短句、節拍明確',accent:'山東地方語感（推斷）',emotion:'克制而警醒',hint:'像一位在馬背上用最少口令完成換陣的女將',en:'A young adult female mezzo voice, mid pitch, firm clear tone, restrained Shandong colouring, short tactical phrases and controlled alertness without flirtation.',local:'約二十三歲的女中音，音高居中、聲線清冷結實；帶山東語感，句子短而有戰術節拍，情緒克制警醒。'}
  },
  {
    name:'孫二娘', aliases:['母夜叉'], gender:'女', age:'約三十至四十歲（推斷）', identity:'十字坡酒店女店主、張青之妻，後為梁山頭領',
    oneLiner:'在十字坡經營黑店、能獨立判斷來客與出手時機的江湖店主，粗獷外表下有自己的行業規矩。', traits:['強悍','機警','務實','潑辣','重義氣'],
    temperament:'招呼客人時熱絡而試探，識破行家後能立刻改變態度；動手果斷，認可同道後也爽快收手。', motivation:'與張青守住十字坡營生和江湖人脈，加入梁山後以店務、情報與武力取得位置。',
    arc:'從試圖麻倒武松的黑店主人轉為結義同道，最後把地方性的生存手段帶入梁山體系。', relationships:[['張青','共同經營酒店的丈夫'],['武松','由衝突轉為互相承認的江湖同道'],['魯智深','曾在十字坡落入其店中的頭領']], evidenceNames:['孫二娘','母夜叉'],
    visualLocal:'北宋孟州十字坡約三十五歲的漢族女店主，寬顴方臉、眼神銳利，肩背厚實、手臂強壯，帶長年勞作與搏鬥痕跡。', costumeLocal:'穿油煙磨舊的暗赭短襖、深青圍裙與寬腿褲，腰藏短刀，戴布頭巾與耐磨黑鞋。',
    visualEn:'a thirty-five-year-old Han Chinese woman, a roadside innkeeper and fighter in early-12th-century Mengzhou, broad cheekbones, square face, sharp appraising eyes, thick shoulders and strong work-worn arms', costumeEn:'She wears a smoke-stained dark-russet short jacket, deep-teal apron, wide trousers, concealed utility knife, tied cloth headscarf and durable black shoes.', palette:'暗赭、深青與煙黑配色', detailsEn:'cloth headscarf knot, smoke-stained cuff, concealed utility knife, apron pocket, durable black shoe', negativeEn:'male actor, beard, slim glamorous beauty, exposed costume, butcher gore, modern chef uniform',
    voice:{timbre:'粗亮有穿透力的成年女低音',pitch:'中低音',pace:'招呼快，試探時忽然放慢',accent:'北方驛路市井口音（推斷）',emotion:'爽利、戒備、帶黑色幽默',hint:'像一位隔著酒案便能判斷客人斤兩的老練店主',en:'A mature female contralto, low-mid pitch, rough bright projection, northern roadside vernacular, brisk hospitality that slows into appraisal, guarded humour and decisive authority.',local:'約三十五歲的女低音，粗亮有穿透力，帶北方驛路市井口音；招呼時快，盤問時突然放慢，爽利中帶戒備與黑色幽默。'}
  },
  {
    name:'顧大嫂', aliases:['母大蟲'], gender:'女', age:'約三十五至四十五歲（推斷）', identity:'登州酒店女店主、孫新之妻，策動劫牢並加入梁山',
    oneLiner:'能把親族、酒店與武力迅速組織成營救網路的強悍女頭領，行事比孫二娘更直接、更具號召力。', traits:['豪爽','有組織力','勇決','護親','直率'],
    temperament:'談妥便立即分工，遇到拖延會以強勢逼人表態；情緒外放，但不是盲目衝動。', motivation:'營救受陷害的解珍、解寶，保護親族並讓自己的行動能力在梁山得到延續。',
    arc:'她以劫牢行動把家庭關係轉成武裝協作，從登州店主成為梁山少數能直接領隊的女性頭領。', relationships:[['孫新','共同策畫營救的丈夫'],['解珍','被她組織營救的親族'],['解寶','與解珍同遭囚禁的親族']], evidenceNames:['顧大嫂','母大蟲'],
    visualLocal:'北宋登州約四十歲的漢族女店主，圓方臉、濃眉、目光坦直，身形高壯結實，站姿有壓場的領隊感。', costumeLocal:'穿深靛厚布對襟短襖、土黃護腰與磚紅長褲裙，配寬皮帶、長柄朴刀與硬底短靴。',
    visualEn:'a forty-year-old Han Chinese woman, an innkeeper and militia organizer in early-12th-century Dengzhou, round-square face, heavy brows, direct eyes, tall powerful build and commanding stance', costumeEn:'She wears a deep-indigo heavy-cloth front-fastened jacket, ochre waist guard, brick-red divided lower garment, broad leather belt, long pole sabre and hard-soled ankle boots.', palette:'深靛、土黃與磚紅配色', detailsEn:'broad leather belt, heavy jacket fastening, pole-sabre grip, reinforced cuff, hard-soled boot', negativeEn:'male actor, beard, delicate slim body, glamour makeup, exposed armour, identical design to a roadside innkeeper',
    voice:{timbre:'厚實洪亮的中年女低音',pitch:'低音',pace:'乾脆快速，分派任務有節奏',accent:'登州地方口音（推斷）',emotion:'豪爽、急切而有號召力',hint:'像一位在吵雜酒店裡一句話就能讓全桌開始分工的女主人',en:'A mature female contralto, low pitch, broad resonant tone, Dengzhou regional colouring, fast decisive task-giving rhythm, open emotion and strong organizing authority.',local:'約四十歲的厚實女低音，音域偏低、聲量洪亮，帶登州地方語感；語速乾脆，分派任務有節奏，豪爽而具號召力。'}
  },
  {
    name:'潘金蓮', aliases:['金蓮'], gender:'女', age:'約二十五至三十歲（推斷）', identity:'武大之妻，武松陽穀縣故事中的核心人物',
    oneLiner:'在不對等婚姻、被拒的慾望與王婆操弄中選擇越過道德與法律界線，最終引爆武家悲劇。', traits:['敏感','機變','好勝','敢冒險','報復心強'],
    temperament:'對被輕視和拒絕反應尖銳，能快速切換示好、譏刺與逼迫；她有行動能力，也須為共同策畫的犯罪承擔責任。', motivation:'擺脫令她不滿的婚姻與生活位置，取得慾望、財物和被重視的感受。',
    arc:'她從向武松示好被拒，轉而與西門慶私通並參與殺害武大；個人慾望與外部操弄互相加速，最終迎來武松復仇。', relationships:[['武植','婚姻中的丈夫與受害者'],['武松','被她試探、拒絕並最終復仇的人'],['王婆','撮合私情並共同策畫犯罪者']], evidenceNames:['潘金蓮','金蓮'],
    visualLocal:'北宋山東陽穀縣約二十七歲的漢族市井女性，長橢圓臉、眼神敏銳，身形窈窕但帶家務勞動痕跡，表情有壓住的不滿。', costumeLocal:'穿較整潔的桃褐交領短襖、墨藍長裙與灰白內領，梳高髻配一支銅簪，穿暗紅繡鞋。',
    visualEn:'a twenty-seven-year-old Han Chinese townswoman in early-12th-century Yanggu County, long oval face, alert expressive eyes, slender body marked by household labour and a guarded dissatisfied expression', costumeEn:'She wears a relatively neat peach-brown crossed jacket, ink-blue long skirt, gray-white inner collar, high bun with one brass pin and dark-red embroidered shoes.', palette:'桃褐、墨藍與暗紅配色', detailsEn:'single brass hairpin, crossed collar, work-worn hand, skirt fastening, dark-red embroidered shoe', negativeEn:'sexualized pose, exposed cleavage, luxurious courtesan costume, victim-blaming caricature',
    voice:{timbre:'柔亮中帶鋒利邊緣的成年女中音',pitch:'中高音',pace:'試探時放柔，受拒時迅速加快',accent:'山東縣城市井口音（推斷）',emotion:'不滿、渴望與防衛快速切換',hint:'像一位一句話內便能從示好轉為冷刺的市井女子',en:'An adult female mezzo voice, mid-high pitch, soft brightness with a sharp edge, Yanggu urban vernacular, seductive testing slows the pace while rejection triggers fast cutting speech.',local:'約二十七歲的成年女中音，音高偏中高，柔亮聲線帶鋒利邊緣；陽穀縣城市井語感，試探時放柔，受拒時迅速轉快。'}
  },
  {
    name:'閻婆惜', aliases:['婆惜'], gender:'女', age:'約十八至二十二歲（推斷）', identity:'受宋江資助安葬父親後成為其外室的年輕女性',
    oneLiner:'以書信祕密與宋江談判、要求掌握自身利益的年輕女性，強硬選擇把兩人推向致命衝突。', traits:['聰明','強硬','善談判','現實','不服輸'],
    temperament:'口齒快、抓住把柄便反覆加碼，不願以感恩抵銷自己的要求；在危險升高時仍不肯退讓。', motivation:'擺脫不滿的依附關係，取得財物與選擇情感對象的自由。',
    arc:'她從接受宋江安置的外室變成掌握梁山書信的談判者，雙方互不退讓使私人衝突迅速變成命案。', relationships:[['宋江','資助並安置她、後因書信衝突殺死她的人'],['閻婆','依賴宋江並逼迫兩人維持關係的母親'],['張文遠','她另有情意往來的人']], evidenceNames:['閻婆惜','婆惜'],
    visualLocal:'北宋鄆城約二十歲的漢族年輕女性，小巧尖圓臉、眼神精明，身形輕盈，帶靠歌舞與交際求生的都市感。', costumeLocal:'穿石榴紅窄袖短襖、淺杏褶裙與黑色腰帶，配小銀耳環、簡潔高髻與紅黑繡鞋。',
    visualEn:'a twenty-year-old Han Chinese young woman in early-12th-century Yuncheng, small pointed-round face, quick calculating eyes, light build and urban survival poise shaped by music and social performance', costumeEn:'She wears a pomegranate-red narrow-sleeved jacket, pale-apricot pleated skirt, black sash, small silver earrings, compact high bun and red-black embroidered shoes.', palette:'石榴紅、淺杏與黑色配色', detailsEn:'small silver earring, compact bun, narrow cuff, black sash knot, red-black embroidered shoe', negativeEn:'child body, sexualized courtesan pose, palace gown, helpless passive expression',
    voice:{timbre:'清脆偏尖的年輕女聲',pitch:'高音',pace:'談判時快而緊密',accent:'鄆城市井口音（推斷）',emotion:'自信、戒備、寸步不讓',hint:'像一位抓住書信把柄後不肯讓對方改變議題的談判者',en:'A young female voice, high pitch, crisp slightly sharp timbre, Yuncheng urban vernacular, fast tightly linked bargaining phrases, confident vigilance and refusal to yield.',local:'約二十歲的清脆年輕女聲，音高偏高、略帶尖銳感；鄆城市井語感，談判時語句快速緊密，自信而寸步不讓。'}
  },
  {
    name:'潘巧雲', aliases:['巧雲'], gender:'女', age:'約二十五至三十歲（推斷）', identity:'楊雄之妻，薊州故事中與裴如海私通的核心人物',
    oneLiner:'在疏離婚姻中尋求情感與欲望、又以謊言維持雙重生活的女性，最終被捲入極端私刑。', traits:['善應變','隱祕','情感強烈','自我保護','矛盾'],
    temperament:'平時能維持家中禮數，被質疑時迅速編造說詞；她的恐懼與執拗並存，分析不替後續暴力合理化。', motivation:'在不滿的婚姻生活中尋找情感滿足，同時保住家庭身分與秘密。',
    arc:'私情被石秀察覺後，她以辯解挑動楊雄與石秀決裂；真相揭開後，男性結義與私刑把她推向暴力結局。', relationships:[['楊雄','婚姻疏離並最終施以私刑的丈夫'],['石秀','察覺私情並追查證據的人'],['裴如海','祕密往來的僧人']], evidenceNames:['潘巧雲','巧雲'],
    visualLocal:'北宋薊州約二十八歲的漢族城市女性，柔方臉、眉眼緊張，成年身形端整，神情同時帶防衛與疲憊。', costumeLocal:'穿灰紫交領襖、暗青長裙與米色內領，髮髻插素銀梳，配布香囊與深色平底鞋。',
    visualEn:'a twenty-eight-year-old Han Chinese townswoman in early-12th-century Jizhou, soft square face, tense eyes, composed adult build and an expression mixing defensiveness with fatigue', costumeEn:'She wears a gray-purple crossed jacket, dark-cyan long skirt, cream inner collar, plain silver comb in a tidy bun, cloth sachet and dark flat shoes.', palette:'灰紫、暗青與米色配色', detailsEn:'plain silver comb, cloth sachet, crossed collar, sleeve seam, dark flat shoe', negativeEn:'sexualized victim scene, exposed body, glamour styling, graphic violence',
    voice:{timbre:'柔暗而緊繃的成年女中音',pitch:'中音',pace:'日常克制，辯解時變快',accent:'薊州城市口音（推斷）',emotion:'防衛、焦慮、偶爾強硬',hint:'像一位努力讓每句辯解聽起來仍屬日常家務的妻子',en:'An adult female mezzo voice, mid pitch, soft dark timbre under tension, Jizhou urban colouring, controlled domestic cadence that accelerates under accusation, defensive anxiety with flashes of resolve.',local:'約二十八歲的柔暗女中音，音高居中而聲線緊繃；帶薊州城市語感，平時克制，受到質問時加快，防衛焦慮中偶爾強硬。'}
  },
  {
    name:'王婆', aliases:[], gender:'女', age:'約五十五至六十五歲（推斷）', identity:'陽穀縣賣茶老婦與媒合者，策動西門慶、潘金蓮私情',
    oneLiner:'熟悉街坊欲望與弱點的茶坊老婦，把媒合、試探和勒索拆成一套可執行步驟。', traits:['世故','善算計','口才好','觀察敏銳','逐利'],
    temperament:'先用閒談探底，再以看似幫忙的方式提高依賴；危機來臨時仍試圖靠話術改寫責任。', motivation:'把街坊祕密與人情轉成收入和影響力，確保自己在地方關係網中的位置。',
    arc:'她從茶坊旁觀者變成私情與謀殺的策畫者，精密安排也留下足以追究的共同責任。', relationships:[['潘金蓮','被她觀察、撮合並利用的鄰婦'],['西門慶','支付報酬並依賴她安排的人'],['武松','追查兄長死因並逼問她的人']], evidenceNames:['王婆'],
    visualLocal:'北宋陽穀縣約六十歲的漢族茶坊老婦，窄長風霜臉、深法令紋與會估量人的眼睛，身形瘦韌、站姿微前傾。', costumeLocal:'穿煙褐交領布襖、褪靛圍裙與黑灰長裙，灰髮緊束低髻，腰掛錢袋與茶匙，穿磨舊黑布鞋。',
    visualEn:'a sixty-year-old Han Chinese woman, a tea-stall keeper and matchmaker in early-12th-century Yanggu County, narrow weathered face, deep expression lines, appraising eyes, wiry build and slightly forward bargaining posture', costumeEn:'She wears a smoke-brown cloth jacket, faded-indigo apron, charcoal skirt, gray hair in a tight low bun, coin pouch and tea scoop at the waist, and worn black cloth shoes.', palette:'煙褐、褪靛與黑灰配色', detailsEn:'coin pouch, tea scoop, low-bun hairpin, apron tie, worn black cloth shoe', negativeEn:'male actor, beard, glamorous old lady, luxurious silk, generic witch, exaggerated evil grin',
    voice:{timbre:'乾啞靈活的老年女低音',pitch:'中低音',pace:'閒聊鬆散，算計時字字清楚',accent:'陽穀縣市井口音（推斷）',emotion:'熱絡表面下持續估價',hint:'像一位端茶時已把客人的慾望算成價錢的街坊老人',en:'An elderly female contralto, low-mid pitch, dry agile timbre, Yanggu street vernacular, loose gossip rhythm that becomes exact when bargaining, sociable surface over constant appraisal.',local:'約六十歲的乾啞女低音，音高偏中低，帶陽穀縣市井口音；閒聊時鬆散，談條件時字字清楚，熱絡表面下持續估價。'}
  },
  {
    name:'林娘子', aliases:['林沖娘子'], gender:'女', age:'約二十五至三十五歲（推斷）', identity:'林沖之妻，高衙內逼迫事件中的核心受害者',
    oneLiner:'在權勢騷擾與丈夫遭陷害的壓力下維持拒絕與尊嚴，其處境揭露東京權貴對平民家庭的侵害。', traits:['堅貞','警醒','克制','有尊嚴','重感情'],
    temperament:'遭逼迫時明確拒絕，回到家中仍試圖維持秩序；她不是事件道具，而是持續承受權力侵入的人。', motivation:'守住人身與婚姻自主，等待被發配的林沖平安歸來。',
    arc:'她從東京教頭妻子成為高衙內覬覦與陸謙設局的受害者，林沖被發配後仍遭逼迫，顯示個人堅持難以抵抗制度性權勢。', relationships:[['林沖','感情深厚卻被迫分離的丈夫'],['高衙內','持續騷擾並企圖逼迫她的權貴子弟'],['陸謙','利用舊交關係協助設局的人']], evidenceNames:['林沖娘子'],
    visualLocal:'北宋東京約三十歲的漢族教頭妻子，端長臉、眉眼沉靜而戒備，身形端正，氣質有城市中產家庭的節制。', costumeLocal:'穿月白與灰青交領長襖裙，外罩低彩度藕褐披衣，梳整潔髮髻配小玉簪，穿素黑繡鞋。',
    visualEn:'a thirty-year-old Han Chinese military-instructor household wife in early-12th-century Kaifeng, long composed face, calm guarded eyes, upright build and restrained urban household dignity', costumeEn:'She wears moon-white and gray-cyan crossed robes with a muted lotus-brown outer wrap, tidy bun with one small jade pin and plain black embroidered shoes.', palette:'月白、灰青與藕褐配色', detailsEn:'small jade pin, muted outer wrap, precise collar, restrained sleeve border, plain black embroidered shoe', negativeEn:'sexualized distress, torn clothing, glamour victim portrait, graphic violence',
    voice:{timbre:'清柔而有底氣的成年女中音',pitch:'中音',pace:'禮貌緩慢，拒絕時清楚加重',accent:'東京城市家庭語感（推斷）',emotion:'克制、警惕、受壓仍不失尊嚴',hint:'像一位面對權貴糾纏仍把拒絕說得完整清楚的教頭妻子',en:'An adult female mezzo voice, mid pitch, clear gentle tone with inner firmness, Kaifeng urban household diction, measured courtesy and unmistakable emphasis when refusing coercion.',local:'約三十歲的清柔女中音，音高居中而有底氣；東京城市家庭語感，平時禮貌緩慢，拒絕逼迫時咬字清楚加重。'}
  },
  {
    name:'宋江', aliases:['公明','及時雨','呼保義'], importance:'protagonist', gender:'男', age:'約三十五至四十五歲（推斷）', identity:'鄆城縣押司、梁山核心領袖',
    oneLiner:'以仗義名聲、人情網路與政治判斷凝聚梁山，同時始終把群體命運拉向被朝廷承認的方向。', traits:['善結交','有領袖手腕','謹慎','重名望','矛盾'],
    temperament:'平時謙和周全，危局中能迅速安排行動；對名分與忠義極敏感，常把個人情感轉成集體決策。', motivation:'保全兄弟與自身名節，使梁山力量獲得合法位置而非永遠被視為草寇。',
    arc:'從地方押司因私放晁蓋、怒殺閻婆惜而流亡，逐步成為梁山領袖；聚義擴大之際，他也把招安願望帶入山寨政治。', relationships:[['吳用','共同決策與調度的軍師'],['李逵','忠誠激烈、也需他約束的部下'],['盧俊義','被迎入梁山並共同承擔領袖位置的人']], evidenceNames:['宋江','公明','及時雨','呼保義'],
    visualLocal:'北宋山東約四十歲的漢族文吏型領袖，身高中等、膚色偏深，方圓臉、眼神溫和而警醒，留整潔短鬚。', costumeLocal:'穿深靛文吏長袍與黑色幞頭，外加暗紅披肩，束素皮帶，帶文書袋與短刀，穿黑布靴。',
    visualEn:'a forty-year-old Han Chinese former county clerk and outlaw leader in early-12th-century Shandong, medium height, darker complexion, square-round face, mild but alert eyes and neat short beard', costumeEn:'He wears a deep-indigo clerk robe and black futou cap with a dark-red shoulder wrap, plain leather belt, document pouch, short utility blade and black cloth boots.', palette:'深靛、暗紅與黑色配色', detailsEn:'black futou cap, neat short beard, document pouch, plain belt and short blade, black cloth boot', negativeEn:'imperial dragon robe, giant warrior body, ornate general armour, saintly halo',
    voice:{timbre:'溫厚沉穩的成年男中音',pitch:'中低音',pace:'平時從容，調度時節奏緊密',accent:'鄆城文吏官話帶山東語感（推斷）',emotion:'謙和、審慎，談名分時格外堅定',hint:'像一位能先安撫全席、再讓每個人接受同一項決策的地方領袖',en:'A mature male baritone, low-mid pitch, warm controlled resonance, Shandong clerkly vernacular, measured social cadence that tightens into command, humility layered over political resolve.',local:'約四十歲的溫厚男中音，音高偏中低，帶山東文吏語感；平時從容周全，調度時節奏緊密，謙和下藏政治決心。'}
  },
  {
    name:'吳用', aliases:['學究','智多星'], importance:'protagonist', gender:'男', age:'約三十五至四十五歲（推斷）', identity:'鄉村學究、梁山軍師',
    oneLiner:'把人情、情報與弱點編成可執行計策的梁山軍師，既能解局也常以操控他人推動局勢。', traits:['機敏','善謀','冷靜','善觀察','務實'],
    temperament:'說話不疾不徐，先讓旁人暴露立場，再提出看似唯一可行的辦法；情緒很少先於計畫。', motivation:'讓梁山在官府與地方勢力間存續壯大，證明自己的謀略能改變階級位置。',
    arc:'從策畫智取生辰綱的鄉村學究成為梁山首席軍師，計策規模隨山寨擴張，也更深介入他人的命運。', relationships:[['宋江','共同制定梁山路線的領袖'],['晁蓋','早期共同起事的首領'],['盧俊義','被其計策引入梁山的重要人物']], evidenceNames:['吳用','智多星'],
    visualLocal:'北宋山東約四十歲的漢族寒士軍師，瘦長臉、細眼、短鬚，身形清瘦，神情安靜而持續觀察。', costumeLocal:'穿灰青布袍、米白內衫與黑色軟巾，腰掛簡樸算袋，手持折扇與卷冊，穿灰黑布鞋。',
    visualEn:'a forty-year-old Han Chinese village scholar and strategist in early-12th-century Shandong, lean long face, narrow observant eyes, short beard and quiet calculating posture', costumeEn:'He wears a gray-cyan cloth scholar robe, off-white inner garment, black soft headscarf, simple calculation pouch, folding fan, rolled papers and gray-black cloth shoes.', palette:'灰青、米白與墨黑配色', detailsEn:'soft scholar headscarf, folding fan, calculation pouch, rolled paper, gray-black cloth shoe', negativeEn:'luxurious court scholar, feather fan cliché, armour, muscular warrior body',
    voice:{timbre:'清瘦平穩的成年男中音',pitch:'中音',pace:'慢而精準，結論前短停頓',accent:'山東鄉學語感（推斷）',emotion:'冷靜、耐心、帶算計',hint:'像一位等眾人說完後才指出唯一缺口的教書先生',en:'A mature male baritone, mid pitch, lean dry clarity, Shandong village-scholar diction, slow exact pacing with a short pause before conclusions, calm strategic control.',local:'約四十歲的清瘦男中音，音高居中、聲線乾淨平穩；帶山東鄉學語感，節奏慢而精準，結論前會短暫停頓。'}
  },
  {
    name:'盧俊義', aliases:['玉麒麟'], importance:'major', gender:'男', age:'約三十五至四十五歲（推斷）', identity:'北京大名府富戶、武藝高強的梁山副領袖',
    oneLiner:'兼具富戶教養與頂尖武藝的高大人物，被計策與冤案推離原有生活後成為梁山重要領袖。', traits:['自負','武藝高強','重體面','堅毅','較少疑心'],
    temperament:'在熟悉環境中沉著有威勢，對自己的武藝和身分有信心；遭背叛後轉為冷硬寡言。', motivation:'起初維護家業與名聲，失去一切後轉而求生、復仇並在梁山重建位置。',
    arc:'他被吳用設計引出大名府，因管家背叛與官府迫害失去家業，最終加入梁山並取得僅次宋江的領袖位置。', relationships:[['燕青','忠誠勸諫並救助他的家僕'],['吳用','以計策把他引入梁山的人'],['宋江','邀請並安排其副領袖位置的人']], evidenceNames:['盧俊義','玉麒麟'],
    visualLocal:'北宋大名府約四十歲的漢族富戶武人，身材極高、肩寬腰直，長方臉、濃眉與自持目光，鬍鬚修整。', costumeLocal:'穿深墨綠錦袍與黑褐皮護腰，外罩低調鐵灰騎戰甲，持長槍，配精製黑靴。',
    visualEn:'a forty-year-old Han Chinese wealthy martial master from early-12th-century Daming Prefecture, exceptionally tall broad-shouldered build, rectangular face, heavy brows, self-possessed eyes and groomed beard', costumeEn:'He wears a deep ink-green brocade robe, black-brown leather waist guard, restrained iron-gray riding armour, long spear and finely made black boots.', palette:'墨綠、鐵灰與黑褐配色', detailsEn:'groomed beard, brocade collar, leather waist guard, long-spear socket, finely made black boot', negativeEn:'ragged peasant clothes, short body, imperial armour, exaggerated gold fantasy armour',
    voice:{timbre:'寬厚有胸腔共鳴的成年男低音',pitch:'低音',pace:'從容偏慢',accent:'大名府富戶語感（推斷）',emotion:'自持，受辱後冷硬',hint:'像一位不需提高音量便能讓廳堂安靜的富戶武師',en:'A mature male bass-baritone, low pitch, broad chest resonance, Daming elite-household diction, deliberate unhurried pace, self-command turning cold after betrayal.',local:'約四十歲的厚實男低音，音域低、胸腔共鳴寬；帶大名府富戶語感，語速從容，平時自持，受辱後轉為冷硬。'}
  },
  {
    name:'林沖', aliases:['豹子頭','林教頭'], importance:'protagonist', gender:'男', age:'約三十至四十歲（推斷）', identity:'東京八十萬禁軍教頭、後為梁山馬軍頭領',
    oneLiner:'長期忍讓制度與權勢侵害的禁軍教頭，當退路被徹底切斷才把克制轉成決絕反抗。', traits:['武藝精熟','忍耐','重情','謹慎','決絕'],
    temperament:'平日收斂情緒、遵守秩序，遭層層逼迫仍先尋合法出路；一旦確認被置於死地，行動便冷而徹底。', motivation:'保住妻子、名節與軍職，後來則是在無法回歸舊生活時求生並尋找公道。',
    arc:'從東京禁軍教頭遭高俅勢力陷害、刺配與追殺，風雪山神廟後斬斷退路，最終成為梁山核心武將。', relationships:[['林娘子','被權勢逼散、始終牽掛的妻子'],['魯智深','野豬林出手相救的摯友'],['陸謙','背叛舊交並參與追殺的人']], evidenceNames:['林沖','豹子頭','林教頭'],
    visualLocal:'北宋東京約三十五歲的漢族禁軍教頭，豹頭環眼感的寬長臉、短鬚，身形精壯，站姿受過正規軍訓。', costumeLocal:'穿暗青禁軍教頭袍、灰黑輕甲與皮革護腕，戴黑色武弁，持丈八蛇矛，穿黑色軍靴。',
    visualEn:'a thirty-five-year-old Han Chinese imperial guard instructor in early-12th-century Kaifeng, broad long face with intense rounded eyes, short beard, compact athletic build and formally trained military posture', costumeEn:'He wears a dark-cyan instructor robe, gray-black light armour, leather bracers, black military cap, long spear and black service boots.', palette:'暗青、灰黑與冷鋼配色', detailsEn:'black military cap, short beard, leather bracer, spear grip, black service boot', negativeEn:'leopard animal head, ornate opera makeup, giant bodybuilder, fantasy armour',
    voice:{timbre:'克制厚實的成年男中音',pitch:'中低音',pace:'平時慢，決斷時短促',accent:'東京軍職官話（推斷）',emotion:'壓抑、警戒，爆發後冰冷',hint:'像一位把怒氣壓到最後一步才出手的正規教頭',en:'A mature male baritone, low-mid pitch, controlled solid tone, Kaifeng military diction, slow restraint that becomes clipped and cold at the point of decision.',local:'約三十五歲的厚實男中音，音高偏中低，帶東京軍職官話；平時克制偏慢，決斷時縮成短句，壓抑轉為冰冷。'}
  },
  {
    name:'魯智深', aliases:['魯達','花和尚'], importance:'protagonist', gender:'男', age:'約三十五至四十五歲（推斷）', identity:'原名魯達的提轄，出家後成為梁山步軍頭領',
    oneLiner:'以巨大體格、直覺正義與不守形式的慈悲行動，總在制度失靈時直接替弱者出手。', traits:['豪爽','勇猛','嫉惡如仇','重義','不拘禮法'],
    temperament:'情緒外放、見不平立刻介入，怒氣來得快卻不以欺弱為樂；粗魯言行下有準確的道德直覺。', motivation:'不讓弱者在自己眼前被欺負，維持朋友間的義氣，即使因此失去官職與安身處。',
    arc:'從經略府提轄因拳打鎮關西逃亡出家，倒拔垂楊柳、救林沖後四處流轉，最終加入梁山。', relationships:[['林沖','一路護送並在野豬林相救的朋友'],['金翠蓮','因其遭欺壓而出手相助的人'],['武松','同為步軍猛將與江湖知己']], evidenceNames:['魯智深','魯達','花和尚'],
    visualLocal:'北宋西北軍鎮出身、約四十歲的漢族壯漢，身材魁梧、圓闊臉、濃眉大眼，剃髮後頭皮可見，短鬚粗硬。', costumeLocal:'穿磨舊灰褐僧衣，外露刺花但不裸身，束深紅僧帶，背戒刀、持厚重水磨禪杖，穿草鞋。',
    visualEn:'a forty-year-old Han Chinese former frontier officer turned Buddhist warrior monk in early-12th-century northern China, massive powerful build, broad round face, heavy brows, large eyes, shaved scalp and coarse short beard', costumeEn:'He wears worn gray-brown monastic robes that fully cover tattooed skin except a restrained neck glimpse, deep-red monk sash, ring-hilted monastic blade, heavy iron staff and straw sandals.', palette:'灰褐、深紅與鐵色配色', detailsEn:'shaved scalp and coarse beard, deep-red monk sash, iron staff head, ring-hilted blade, straw sandal', negativeEn:'lean serene scholar monk, bare muscular torso, Buddhist halo, ornate temple vestments',
    voice:{timbre:'洪亮粗厚的成年男低音',pitch:'低音',pace:'大開大闔，怒時如連雷',accent:'西北軍鎮口音（推斷）',emotion:'豪爽、直怒、護弱時溫厚',hint:'像一位能把佛門戒語與市井痛罵說成同一股正氣的壯僧',en:'A mature male bass, low pitch, huge rough resonance, northwestern garrison colouring, broad rhythmic delivery that thunders in anger yet softens unexpectedly toward the vulnerable.',local:'約四十歲的洪亮男低音，音域低、共鳴粗厚，帶西北軍鎮語感；節奏大開大闔，怒時如雷，對弱者又能突然放柔。'}
  },
  {
    name:'武松', aliases:['武二郎','行者'], importance:'protagonist', gender:'男', age:'約二十八至三十五歲（推斷）', identity:'清河縣武家次子、陽穀縣都頭，後以行者身分加入梁山',
    oneLiner:'以沉著判斷、驚人武力與強烈報償觀念行動的江湖英雄，個人正義也常走向嚴酷暴力。', traits:['勇猛','沉著','剛烈','重親情','有戒心'],
    temperament:'飲酒豪邁但臨敵極冷靜，先觀察證據再出手；認定恩怨後幾乎不留退路。', motivation:'維護兄長與自身名節，報答善意、追究仇怨，在官府不可信時依自己的正義行事。',
    arc:'從景陽岡打虎成名、任陽穀都頭，到查明兄長死因並復仇；孟州與鴛鴦樓事件後改作行者，走上梁山。', relationships:[['武植','促使他追查與復仇的兄長'],['潘金蓮','試探他並參與殺害武植的人'],['孫二娘','由衝突轉為結義的十字坡店主']], evidenceNames:['武松','武二郎','行者'],
    visualLocal:'北宋山東約三十歲的漢族武人，身材高壯精實、寬肩窄腰，方長臉、濃眉與直視眼神，皮膚有日曬痕跡。', costumeLocal:'採雲遊武人階段造型：灰黑頭箍、深褐無袖旅行外衣覆靛青窄袖袍，束皮腰帶，配雙戒刀、綁腿與黑布靴。',
    visualEn:'a thirty-year-old Han Chinese martial fighter from early-12th-century Shandong, tall powerful athletic build, broad shoulders, square-long face, heavy brows, direct eyes and sun-marked skin', costumeEn:'In his pilgrim-warrior stage he wears a gray-black headband, dark-brown sleeveless travel vest over an indigo narrow-sleeved robe, leather belt, paired ring-hilted blades, leg wraps and black cloth boots.', palette:'深褐、靛青與灰黑配色', detailsEn:'gray-black headband, paired ring-hilted blade hilts, leather belt, leg wrap, black cloth boot', negativeEn:'tiger-skin costume, bare chest, generic fantasy assassin, identical costume to a constable',
    voice:{timbre:'低沉乾淨的成年男中音',pitch:'中低音',pace:'平時節制，動怒時仍咬字清楚',accent:'山東清河口音（推斷）',emotion:'冷靜、警戒、恩怨分明',hint:'像一位喝過烈酒仍能把每項證據逐一問清的武人',en:'A mature male baritone, low-mid pitch, clean dense tone, Shandong Qinghe colouring, controlled pace and precise diction even in anger, vigilant and uncompromising about debts and injuries.',local:'約三十歲的低沉男中音，音高偏中低、聲線乾淨緊實；帶山東清河語感，平時節制，動怒時仍咬字清楚，恩怨分明。'}
  },
  {
    name:'李逵', aliases:['黑旋風','鐵牛'], importance:'protagonist', gender:'男', age:'約三十至四十歲（推斷）', identity:'沂州百丈村出身的梁山步軍猛將',
    oneLiner:'把忠誠、怒氣與破壞力毫無遮掩地放在行動上的猛將，既能護主也常造成難以收拾的傷害。', traits:['勇猛','直率','暴躁','忠於宋江','缺乏克制'],
    temperament:'想到便說、認定便做，情緒與身體行動幾乎沒有間隔；對宋江有孩子般依附，也會因誤判立刻翻臉。', motivation:'追隨宋江、保護母親與兄弟，以直接武力消滅他認定的不公。',
    arc:'從江州牢子結識宋江、劫法場上梁山，到屢次因魯莽破壞秩序；他的忠誠與失控始終相伴。', relationships:[['宋江','極度敬愛並依附的領袖'],['吳用','能利用並約束他衝動的軍師'],['李達','性情與生活方式相反的兄長']], evidenceNames:['李逵','黑旋風','鐵牛'],
    visualLocal:'北宋沂州約三十五歲的漢族壯漢，膚色黝黑，圓闊臉、粗眉、濃亂鬍鬚，身形厚重有爆發力，姿態難以安定。', costumeLocal:'穿粗黑短襖、暗土紅護腰與寬腿褲，兩臂戴皮護腕，背兩把板斧，配草繩綁腿與厚底黑鞋。',
    visualEn:'a thirty-five-year-old Han Chinese heavy infantry fighter from early-12th-century Yizhou, very dark sun-weathered complexion, broad round face, coarse brows, dense unruly beard, thick explosive build and restless stance', costumeEn:'He wears a coarse black short jacket, dark-earth-red waist guard, wide trousers, leather forearm guards, paired broad axes, rope leg wraps and heavy black shoes.', palette:'粗黑、土紅與皮褐配色', detailsEn:'dense unruly beard, broad axe head, leather forearm guard, rope leg wrap, heavy black shoe', negativeEn:'clean-shaven handsome face, polished officer armour, delicate body, fantasy dwarf',
    voice:{timbre:'粗礪爆裂的成年男低音',pitch:'低音',pace:'快、常搶話，喊叫突然拔高',accent:'沂州鄉野口音（推斷）',emotion:'直喜直怒、忠誠而衝動',hint:'像一位情緒和板斧總在同一刻落下的莽漢',en:'A mature male bass, low pitch with sudden shouted peaks, rough explosive resonance, rural Yizhou colouring, fast interrupting pace, immediate joy and fury, fierce childlike loyalty.',local:'約三十五歲的粗礪男低音，音域低但喊叫會突然拔高，帶沂州鄉野語感；語速快、常搶話，喜怒直接且忠誠衝動。'}
  },
  {
    name:'楊志', aliases:['青面獸'], importance:'protagonist', gender:'男', age:'約三十至四十歲（推斷）', identity:'將門後裔、殿司制使，後為梁山馬軍頭領',
    oneLiner:'帶醒目青色胎記、執著恢復軍職的將門後裔，屢次因制度、運氣與人際失敗被推向草莽。', traits:['武藝高強','自尊','謹慎','急躁','重功名'],
    temperament:'對任務高度緊繃，習慣用命令壓制不確定性；遭質疑時容易把焦慮轉成怒氣。', motivation:'恢復祖上與自己的軍職名譽，以可被朝廷承認的戰功證明身分。',
    arc:'從失陷花石綱、賣刀殺人到押送生辰綱再度失敗，反覆失去合法軍職道路，最後進入梁山。', relationships:[['吳用','設計智取生辰綱、改變其命運的軍師'],['林沖','投名狀時交手並互認武藝的人'],['梁中書','委派押送生辰綱的上司']], evidenceNames:['楊志','青面獸'],
    visualLocal:'北宋約三十五歲的漢族軍官後裔，長方臉、右側面頰有醒目但自然的青色胎記，身形高壯，目光緊繃自持。', costumeLocal:'穿灰藍軍袍、暗銅札甲與深褐皮腰帶，戴黑色軍帽，配朴刀、護腿與黑色軍靴。',
    visualEn:'a thirty-five-year-old Han Chinese military descendant in early-12th-century northern China, tall strong build, rectangular face with a prominent natural blue-gray birthmark across the right cheek, tense self-controlled eyes', costumeEn:'He wears a gray-blue military robe, muted-bronze lamellar armour, dark-brown leather belt, black service cap, pole sabre, greaves and black military boots.', palette:'灰藍、暗銅與深褐配色', detailsEn:'natural blue-gray facial birthmark, black service cap, lamellar fastening, pole-sabre grip, black military boot', negativeEn:'blue painted whole face, demon features, opera mask, fantasy beast armour',
    voice:{timbre:'緊實帶沙的成年男中低音',pitch:'中低音',pace:'命令短促，解釋身分時較慢',accent:'北方軍旅官話（推斷）',emotion:'自尊、焦慮、易怒',hint:'像一位把每次差事都當成最後一次翻身機會的失意軍官',en:'A mature male bass-baritone, low-mid pitch, tight slightly rough tone, northern military diction, clipped commands and slower self-justification, proud anxiety close to anger.',local:'約三十五歲的男中低音，聲線緊實略沙，帶北方軍旅官話；命令短促，說明身分時放慢，自尊與焦慮緊貼怒意。'}
  },
];

const cast = {
  source: '水滸傳・主要角色',
  lang: 'zh-TW',
  style: 'photoreal',
  summary: '北宋末年的山東、河北與東京一帶，官府壓迫、地方豪強與個人恩怨把各種身分的人逐步推向江湖。宋江、吳用等人以人情與計策擴大梁山，林沖、魯智深、武松、楊志等武人則從各自遭遇走上同一座山寨。扈三娘、孫二娘、顧大嫂等女性以戰鬥、經營與組織能力介入這個群體，潘金蓮、閻婆惜、潘巧雲與林娘子的故事則揭露家庭、權勢與暴力如何和江湖秩序交纏。這份角色群像只涵蓋本目錄收錄的楔子至第七十回。',
  characters: specs.map(makeCard),
};

fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, '水滸傳-主要角色-cast.json'), `${JSON.stringify(cast, null, 2)}\n`);
console.log(JSON.stringify({source: sourcePath, output: outDir, characters: cast.characters.length}, null, 2));
