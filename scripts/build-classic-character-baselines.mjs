#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const corpusRoot = path.join(root, 'testdata', 'corpora', 'classic-chinese-novels');
const benchmarkRoot = path.join(root, 'testdata', 'benchmarks', 'novel-characters', 'classic-chinese-novels');

const photoreal = {
  render: 'Live-action photography, not illustration: a real wardrobe camera-test photograph of a real human being on a film production, shot on a full-frame cinema camera with a 50-85mm lens at a moderate aperture against a neutral warm-gray seamless studio backdrop, the finish and honesty of a costume-department test still',
  surface: 'True photographic skin with visible pores, fine vellus hair, uneven natural tone, faint capillaries, genuine subsurface scattering, moles and freckles left in place, no beauty retouching or skin smoothing; eyes with a real catchlight, moist lower lid, resolvable iris fibres and a limbal ring; eyebrows and eyelids honestly asymmetric; loose individual hair strands breaking the silhouette. Real garments with true cloth weight, visible weave, stitched seams and hems, natural drape, self-shadowing folds and honest wear',
  negative: 'illustration, painting, drawing, sketch, anime, manga, cartoon, cel shading, digital painting brush strokes, CGI, 3d game render, plastic or waxy skin, doll skin, beauty-filter retouching, poreless airbrushed complexion, perfectly symmetrical face, dead flat eyes without a catchlight, wig-like helmet hair with no loose strands, flat untextured costume fabric, cheap cosplay-shop garment, stiff mannequin posing, extra fingers, malformed hands, text, watermark, signature, busy or patterned background, harsh cast shadows on the backdrop',
  tags: ['live-action', 'photographic', 'wardrobe camera test', 'character sheet', 'real skin texture', '85mm lens'],
};

function evidenceFrom(source, patterns) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  return patterns.map((pattern) => {
    const line = lines.find((candidate) => candidate.includes(pattern));
    if (!line) throw new Error(`找不到原文證據：${pattern}`);
    return line.trim();
  });
}

function evidenceForNames(source, names, count = 4) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const matches = lines
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && !line.startsWith('第') && names.some((name) => line.includes(name)));
  const unique = [...new Set(matches)];
  if (unique.length === 0) throw new Error(`找不到角色原文證據：${names.join('、')}`);
  if (unique.length <= count) return unique;
  return Array.from({length: count}, (_, index) => unique[Math.floor(index * (unique.length - 1) / (count - 1))]);
}

function makeCard(source, spec) {
  const visualEn = `${spec.visualEn} ${spec.costumeEn}`;
  const visualLocal = `${spec.visualLocal}${spec.costumeLocal}`;
  const prompt = `${photoreal.render}. ${visualEn} Three-quarter waist-up view against a neutral warm-gray seamless studio backdrop, a large soft-box key from the upper left with gentle cool bounce fill, shallow depth of field, face in sharpest focus. ${photoreal.surface}. No illustration, painting, anime, cartoon, CGI, text, watermark or signature.`;
  const sheet = `Use case: historical-scene. Asset type: live-action production character model sheet. Create ONE 16:9 landscape canvas for ${visualEn} The canvas is divided into three zones by thin hairline rules. LEFT ZONE occupies about 34% of the canvas width: one large front-facing bust portrait, head and shoulders, centred like an ID photograph. BOTH SHOULDERS ARE FULLY VISIBLE with clear space on either side; no side cropping, fade, vignette or rounded bottom; end the portrait with a clean straight horizontal cut below the chest. This portrait is the facial identity anchor. LIGHTING IN THE LEFT ZONE ONLY: a large soft-box key from the upper left with gentle bounce fill, real ambient occlusion under the chin, in the eye sockets and where the collar meets the neck. RIGHT-TOP ZONE: three FULL-BODY views of the SAME character, front, left profile and back, standing side by side on one shared ground line. Their faces must match the bust portrait exactly — same features, hairstyle and expression. PROPORTIONS ARE CRITICAL: equal height and head-to-body ratio, correct limb lengths, natural anatomy, feet on the ground line, clear margin above and below, no stretching, squashing or foreshortening. LIGHTING IN THE RIGHT ZONES: flat even orthographic frontal studio light with no directional key and no cast shadows on the backdrop. RIGHT-BOTTOM ZONE: four to five small isolated detail studies, evenly spaced and smaller than the figures: ${spec.detailsEn}. If details do not fit, continue them down the right edge; the detail studies give way, not the figures. Plain pure white background throughout, generous even margins, no scenery, no written labels, no text, no watermark. ${photoreal.render}. ${photoreal.surface}.`;

  return {
    name: spec.name,
    aliases: spec.aliases,
    importance: spec.importance,
    oneLiner: spec.oneLiner,
    persona: {
      gender: spec.gender,
      ageRange: spec.ageRange,
      identity: spec.identity,
      appearance: spec.appearance,
      personality: spec.personality,
      temperament: spec.temperament,
      motivation: spec.motivation,
      arc: spec.arc,
      relationships: spec.relationships,
      evidence: spec.evidencePatterns
        ? evidenceFrom(source, spec.evidencePatterns)
        : evidenceForNames(source, [spec.name, ...spec.aliases]),
    },
    image: {
      style: `擬真實拍劇組試裝定妝照，${spec.paletteLocal}`,
      prompt,
      promptLocal: `擬真實拍劇組試裝定妝照：${visualLocal}四分之三半身視角，中性暖灰無縫背景，左上大型柔光箱主光與冷調反射補光，淺景深，面部最清晰。皮膚保留毛孔、細小汗毛與自然膚色變化；眼睛有實拍高光，眉眼略不對稱，髮際線有碎髮；衣料具真實重量、織紋、縫線與褶皺自陰影。`,
      negativePrompt: `${photoreal.negative}, ${spec.negativeEn}`,
      tags: photoreal.tags,
      sheet,
    },
    voice: {
      timbre: spec.voice.timbre,
      pitch: spec.voice.pitch,
      pace: spec.voice.pace,
      accent: spec.voice.accent,
      emotion: spec.voice.emotion,
      referenceHint: spec.voice.referenceHint,
      prompt: spec.voice.prompt,
      promptLocal: spec.voice.promptLocal,
    },
  };
}

function compactSpec(spec) {
  const ageVoice = spec.gender === '女' ? 'female' : 'male';
  return {
    name: spec.name,
    aliases: spec.aliases ?? [],
    importance: spec.importance ?? 'major',
    gender: spec.gender,
    ageRange: spec.age,
    identity: spec.identity,
    oneLiner: spec.oneLiner,
    appearance: `${spec.visualLocal}${spec.costumeLocal}（推斷）`,
    personality: spec.traits,
    temperament: spec.temperament,
    motivation: spec.motivation,
    arc: spec.arc,
    relationships: spec.relationships.map(([name, relation]) => ({name, relation})),
    visualEn: spec.visualEn,
    costumeEn: spec.costumeEn,
    visualLocal: spec.visualLocal,
    costumeLocal: spec.costumeLocal,
    paletteLocal: spec.palette,
    detailsEn: spec.detailsEn,
    negativeEn: spec.negativeEn ?? 'modern clothing, modern haircut, cheap cosplay, fantasy armour unrelated to the source',
    voice: {
      timbre: spec.voice.timbre,
      pitch: spec.voice.pitch,
      pace: spec.voice.pace,
      accent: spec.voice.accent,
      emotion: spec.voice.emotion,
      referenceHint: spec.voice.referenceHint,
      prompt: `A ${ageVoice} voice at the character's stated adult age. ${spec.voice.prompt}`,
      promptLocal: spec.voice.promptLocal,
    },
  };
}

const threeKingdomsSpecs = [
  compactSpec({
    name:'貂蟬',aliases:[],gender:'女',age:'約十八至二十二歲（推斷）',identity:'司徒王允府中歌伎，連環計的執行者',oneLiner:'在權臣壓迫下承擔連環計風險，以表演、判斷與勇氣周旋於董卓與呂布之間。',traits:['機敏','沉著','勇敢','善表演','有責任感'],temperament:'善於觀察對方情緒並控制自己的表情，真正的恐懼與決心都藏在禮數之下。',motivation:'協助王允除去董卓，終止權臣暴虐，同時在被當作政治工具的處境中求生。',arc:'從王允府中的歌伎被推上政治核心，以精準表演促成董卓與呂布決裂，也承受計策成功後仍缺乏自主的代價。',relationships:[['王允','收養並委以連環計的司徒'],['呂布','被她引導反抗董卓的武將'],['董卓','必須以親近姿態周旋的權臣']],visualLocal:'漢末洛陽約二十歲的漢族女性，細長鵝蛋臉、沉著杏眼與受過歌舞訓練的端正體態。',costumeLocal:'穿深緋與煙紫層疊曲裾，配低調金簪、細腰帶與舞袖，華美但不情色。',visualEn:'a twenty-year-old Han Chinese court performer in late-2nd-century Luoyang, slender oval face, steady almond eyes, poised dancer posture, black hair in a restrained Han-period high bun',costumeEn:'She wears layered deep-crimson and smoky-purple Han-period quju robes, restrained gold hairpins, a narrow belt and long controlled dance sleeves.',palette:'深緋、煙紫與暗金配色',detailsEn:'the restrained gold hairpin, controlled dance sleeve, narrow belt clasp, layered quju collar, embroidered cloth shoe',voice:{timbre:'清亮而受控的年輕女中音',pitch:'中高音',pace:'禮貌緩慢，施計時精準停頓',accent:'漢末洛陽上層語感（推斷）',emotion:'表面柔順，內裡警醒堅定',referenceHint:'像一位每次停頓都在觀察權力風向的宮府歌者',prompt:'Clear controlled mezzo-soprano, mid-high pitch, polished court diction, measured phrasing, precise pauses, outward softness covering vigilance and resolve.',promptLocal:'約二十歲的清亮女中音，音高偏中高，宮府咬字精準；語速剋制、停頓有意識，柔順表面下保持警醒與決心。'}}),
  compactSpec({
    name:'孫夫人',aliases:['孫權之妹'],gender:'女',age:'約二十至二十五歲（推斷）',identity:'孫權之妹、劉備之妻，江東政治婚姻的核心人物',oneLiner:'帶著持兵侍女出嫁的江東貴女，在婚姻聯盟與家族命令之間展現剛烈主見。',traits:['剛烈','尚武','自尊','果斷','重家族'],temperament:'說話直接、行動迅速，不把婚姻視為被動服從；即使被兄長與夫家利用，也會用自己的威勢改變場面。',motivation:'維持江東家族利益與個人尊嚴，避免自己只成為兩方爭奪的物件。',arc:'從政治婚姻的新婦成為劉備身邊具獨立威勢的夫人，返吳衝突則揭露她的選擇始終受兩國權力挾持。',relationships:[['孫權','安排婚姻並召她返吳的兄長'],['劉備','政治婚姻中的丈夫'],['趙雲','在截江事件中阻止她帶走阿斗的將領']],visualLocal:'東漢末年江東約二十三歲的漢族貴族女性，眉眼銳利、體態挺拔，帶長期接觸兵器的穩定站姿。',costumeLocal:'穿赤褐與墨綠交領袍裙，外加便於行動的短襦與窄袖，配小型佩劍、皮革護腕和黑色靴履。',visualEn:'a twenty-three-year-old Han Chinese noblewoman from Jiangdong in the early 3rd century, sharp eyes, upright athletic posture and confident bearing shaped by a martial household',costumeEn:'She wears russet and dark-green Han-period crossed-collar robes with a short practical outer jacket, narrow sleeves, a small ceremonial sword, leather wrist guards and black boots.',palette:'赤褐、墨綠與黑色配色',detailsEn:'the small ceremonial sword, leather wrist guard, crossed collar, compact hair ornament, black riding boot',voice:{timbre:'明亮堅實的年輕女中音',pitch:'中音',pace:'俐落直接，命令時不拖尾音',accent:'江東貴族語感（推斷）',emotion:'自信、警戒，受制時帶壓住的怒意',referenceHint:'像一位習慣讓持兵侍女立即照令行動的江東女主人',prompt:'Bright firm mezzo voice, mid pitch, crisp Jiangdong noble diction, brisk direct pace, command without shouting, confidence edged by restrained anger when controlled.',promptLocal:'約二十三歲的明亮女中音，音高居中，帶江東貴族語感；節奏俐落直接，命令不需提高音量，受制時有被壓住的怒意。'}}),
  compactSpec({name:'糜夫人',aliases:[],gender:'女',age:'約二十五至三十五歲（推斷）',identity:'劉備夫人，長坂坡亂軍中保護阿斗的重要人物',oneLiner:'在長坂坡潰散中以受傷之身保全幼主，把危局裡的判斷置於自身安危之前。',traits:['決斷','堅忍','護幼','剋制','勇敢'],temperament:'平時端靜，危急時迅速判斷誰能帶孩子突圍，不以哭喊拖延行動。',motivation:'在亂軍中保住阿斗與劉備家系，避免趙雲因照料自己失去突圍機會。',arc:'她的主要行動集中在長坂坡，短暫卻以極端情勢下的自主決定改變幼主與趙雲的命運。',relationships:[['劉備','在戰亂中失散的丈夫'],['趙雲','託付阿斗並要求其立即突圍的將領'],['阿斗','在亂軍中全力保護的幼主']],visualLocal:'東漢末年荊州戰亂中約三十歲的漢族貴族女性，面容疲憊、姿態受傷但眼神堅決。',costumeLocal:'穿蒙塵的赭褐與灰藍漢代袍裙，衣角有奔逃磨損，完整衣著、不呈現傷口獵奇。',visualEn:'a thirty-year-old Han Chinese noblewoman during the early-3rd-century Jingzhou campaign, exhausted face, injured guarded posture and unwavering eyes',costumeEn:'She wears dust-marked russet-brown and gray-blue Han robes with travel wear at the hems, fully clothed and presented without graphic injury.',palette:'赭褐、灰藍與塵土色配色',detailsEn:'the dust-marked sleeve, layered collar, worn hem, simple hairpin, cloth shoe',voice:{timbre:'疲憊但穩定的成年女中音',pitch:'中音',pace:'呼吸短促仍把指令說清楚',accent:'荊州上層家庭語感（推斷）',emotion:'痛苦中保持決斷',referenceHint:'像一位在亂軍逼近時仍先把孩子交到可靠者手中的母親',prompt:'Adult mezzo voice, mid pitch, breath shortened by exhaustion yet diction remains clear, restrained noble bearing, decisive urgency without melodrama.',promptLocal:'約三十歲的成年女中音，因疲憊而氣息短，仍能把每個指令說清楚；語氣端正剋制，急迫而不煽情。'}}),
  compactSpec({name:'甘夫人',aliases:[],gender:'女',age:'約二十五至三十五歲（推斷）',identity:'劉備夫人、阿斗生母',oneLiner:'在長年遷徙與戰亂中維繫劉備家室，也是阿斗身世與蜀漢繼承線的重要母親。',traits:['沉靜','忍耐','慈愛','適應力強','重家人'],temperament:'面對軍旅遷徙多以沉著配合維持日常，危機中關切孩子與同行者而少作張揚。',motivation:'在反覆流離中保護家人，使幼子能在軍政動盪裡存活。',arc:'她從劉備家室成員成為阿斗生母，個人形象被戰亂與繼承需求包圍，呈現亂世女性被迫承擔的延續責任。',relationships:[['劉備','長期隨軍流離的丈夫'],['阿斗','在戰亂中被保護的幼子'],['糜夫人','共同承受長坂坡危局的夫人']],visualLocal:'東漢末年約三十歲的漢族貴族女性，柔和長圓臉、沉靜眼神與略顯旅途疲憊的身形。',costumeLocal:'穿柔褐與淺青漢代交領袍裙，飾物極少，外加便於遷徙的披帛與布鞋。',visualEn:'a thirty-year-old Han Chinese noblewoman living through early-3rd-century military displacement, gentle long-round face, calm eyes and travel-worn bearing',costumeEn:'She wears soft-brown and pale-cyan Han crossed-collar robes with minimal jewellery, a practical travel shawl and cloth shoes.',palette:'柔褐、淺青與米白配色',detailsEn:'the minimal hairpin, travel shawl weave, crossed collar, mended hem, cloth shoe',voice:{timbre:'柔暖而低調的成年女中音',pitch:'中低音',pace:'緩慢清楚',accent:'漢末中原與荊州間的官話語感（推斷）',emotion:'安定、憂心而不失溫柔',referenceHint:'像一位在營帳遷徙間仍維持家中節奏的母親',prompt:'Warm understated adult mezzo, low-mid pitch, slow clear diction, gentle steadiness shaped by repeated displacement, worry held beneath a calming tone.',promptLocal:'約三十歲的柔暖女中音，音高偏中低，語速緩慢清楚；多次遷徙造成的憂心被壓在安定溫柔的語氣下。'}}),
  compactSpec({name:'蔡夫人',aliases:[],gender:'女',age:'約四十至五十歲（推斷）',identity:'劉表後妻、劉琮之母，荊州繼承鬥爭的推動者',oneLiner:'以母族與內宅影響力介入荊州繼承，為兒子劉琮爭取位置的政治行動者。',traits:['精明','護子','多疑','權力敏感','果斷'],temperament:'擅長把家族關係轉成政治壓力，說話端整卻會迅速排除被視為威脅的人。',motivation:'確保劉琮繼承荊州並維持蔡氏家族影響力。',arc:'她成功推動劉琮取得繼承位置，卻也讓荊州在外敵壓境時更依賴內部算計與倉促決策。',relationships:[['劉表','受其信任並影響繼承安排的丈夫'],['劉琮','全力扶持的兒子'],['劉備','被她視為威脅並設法排除的客將']],visualLocal:'漢末荊州約四十五歲的漢族貴族女性，長方臉、眼神審慎，成熟端正而有管理威勢。',costumeLocal:'穿深紫與墨青厚實曲裾，配蔡氏家族玉飾與整齊高髻，服裝輪廓封閉嚴整。',visualEn:'a forty-five-year-old Han Chinese aristocratic political matriarch in early-3rd-century Jingzhou, mature rectangular face, cautious eyes and controlled authority',costumeEn:'She wears weighty deep-purple and ink-cyan Han quju robes, a clan jade ornament and a precise high bun, with a closed formal silhouette.',palette:'深紫、墨青與冷玉配色',detailsEn:'the clan jade ornament, precise high bun, heavy robe border, formal sash, dark cloth shoe',voice:{timbre:'冷靜厚實的中年女中音',pitch:'中低音',pace:'慢而有審議感',accent:'荊州上層家族語感（推斷）',emotion:'剋制、多疑，談及兒子時轉為強硬',referenceHint:'像一位在家宴中也能推動繼承決策的宗族女主人',prompt:'Mature firm contralto, low-mid pitch, slow deliberative cadence, aristocratic Jingzhou diction, controlled suspicion and sharpened resolve when protecting her son.',promptLocal:'約四十五歲的厚實女低音，音高偏中低，節奏緩慢而像在審議；帶荊州上層家族語感，剋制多疑，護子時轉為強硬。'}}),
  compactSpec({name:'伏皇后',aliases:['伏後'],gender:'女',age:'約三十至四十歲（推斷）',identity:'漢獻帝皇后，反對曹操專權的宮廷政治人物',oneLiner:'身在受控宮廷仍試圖聯絡外援反抗曹操，以皇后身分承擔高風險政治行動。',traits:['剛毅','憂國','謹慎','有政治判斷','敢於反抗'],temperament:'長期在監視下保持儀態，私下行動慎密；被逼至絕境時仍以皇后尊嚴面對權臣。',motivation:'削弱曹操對天子的控制，恢復漢室政治自主並保護皇帝。',arc:'她從被挾持宮廷中的皇后轉為主動密謀者，失敗後遭到殘酷清算，凸顯漢室名位與實權的斷裂。',relationships:[['漢獻帝','共同受曹操控制並試圖維護的丈夫'],['曹操','她密謀反抗的權臣'],['伏完','被寄望提供外援的父親']],visualLocal:'漢末許都約三十五歲的漢族皇后，端長臉、深眼窩與長期緊繃的剋制神情。',costumeLocal:'穿暗朱與玄黑漢代皇后禮服，玉飾與冠飾莊重剋制，不採後世戲曲鳳冠。',visualEn:'a thirty-five-year-old Han Chinese empress in late-2nd-century Xuchang, dignified long face, deep-set watchful eyes and tension held beneath formal composure',costumeEn:'She wears dark-vermilion and black Han imperial court robes with restrained jade ornaments and a historically grounded formal headdress, not a later opera crown.',palette:'暗朱、玄黑與冷玉配色',detailsEn:'the grounded formal headdress, jade pendant, dark-vermilion woven border, sealed letter sleeve, black court shoe',voice:{timbre:'端肅而微顫的成年女中音',pitch:'中音',pace:'公開場合極慢，私語時緊促',accent:'漢末宮廷雅正語感（推斷）',emotion:'恐懼受控而意志堅定',referenceHint:'像一位知道宮牆有耳、仍要把密令說完整的皇后',prompt:'Dignified adult mezzo, mid pitch, formal court diction, very slow in public and compressed in private, fear tightly controlled beneath political resolve.',promptLocal:'約三十五歲的端肅女中音，音高居中，宮廷咬字雅正；公開場合極慢，私下密語緊促，恐懼被嚴密控制在政治決心之下。'}}),
  compactSpec({name:'甄氏',aliases:['甄夫人'],gender:'女',age:'約二十至三十歲（推斷）',identity:'袁熙之妻，鄴城陷落後進入曹氏家族',oneLiner:'在袁曹政權更替中被迫轉換家族位置的貴族女性，其處境映出勝負如何進入婚姻。',traits:['端莊','審慎','適應力強','自持','敏感'],temperament:'身處勝者審視時保持禮貌與自制，極少讓私人情緒直接外露。',motivation:'在政權更替與婚姻被重新安排時保全生命、尊嚴與家人。',arc:'她由袁氏媳婦成為曹丕之妻，身分轉換主要由軍事勝負決定，呈現亂世貴族女性選擇空間的侷限。',relationships:[['袁熙','原先的丈夫'],['曹丕','鄴城陷落後迎娶她的勝方公子'],['曹操','決定曹氏家族安排的權力中心']],visualLocal:'漢末河北約二十五歲的漢族貴族女性，端正橢圓臉、沉靜眼神與收束的站姿。',costumeLocal:'穿灰紫與月白漢代交領袍裙，飾物精緻而低調，保留由袁入曹的中性剋制。',visualEn:'a twenty-five-year-old Han Chinese noblewoman from late-2nd-century Hebei, balanced oval face, quiet observant eyes and a restrained formal posture',costumeEn:'She wears gray-violet and moon-white Han crossed-collar robes with refined but understated ornaments and a controlled neutral silhouette.',palette:'灰紫、月白與冷銀配色',detailsEn:'the understated hairpin, layered collar, fine woven border, narrow sash, pale cloth shoe',voice:{timbre:'清柔而自持的年輕女中音',pitch:'中高音',pace:'慢，字句留有距離',accent:'河北士族語感（推斷）',emotion:'端莊、戒備，悲傷不外露',referenceHint:'像一位在勝者家中必須讓每句話都無可挑剔的貴族女子',prompt:'Soft restrained young mezzo, mid-high pitch, refined Hebei noble diction, slow distanced phrasing, formal composure with guarded grief kept internal.',promptLocal:'約二十五歲的清柔女中音，音高偏中高，帶河北士族語感；語速緩慢、字句留有距離，端莊表面下把戒備與悲傷收住。'}}),
  compactSpec({name:'祝融夫人',aliases:[],gender:'女',age:'約二十五至三十五歲（推斷）',identity:'南中孟獲之妻、親自率軍出戰的女性武將',oneLiner:'能以飛刀和騎戰正面迎敵的南中女將，在部族與婚姻聯盟中擁有實際軍事能力。',traits:['勇猛','果斷','自信','忠於部族','好勝'],temperament:'戰場上反應直接，對挑戰以行動回答；不因對手名聲退讓，也不把自己縮在丈夫身後。',motivation:'保衛孟獲政權與南中自主，證明自己的戰力足以承擔部族危機。',arc:'她以少見的女性武將身分直接改變戰局，雖最終敗於蜀軍，仍以戰力而非婚姻附屬被故事記住。',relationships:[['孟獲','共同抵抗蜀軍的丈夫'],['趙雲','南征戰場上的對手'],['諸葛亮','主導南征與招撫的蜀漢統帥']],visualLocal:'三世紀南中約三十歲的本地女性武將，日曬膚色、顴骨分明、體格矯健，眼神直接。',costumeLocal:'穿以棕紅、靛藍和皮革構成的南中實戰服，配織紋護臂、飛刀套與短靴，避免通用奇幻裸甲。',visualEn:'a thirty-year-old woman warrior native to the Nanzhong region in the 3rd century, sun-browned skin, defined cheekbones, athletic build and direct fearless gaze',costumeEn:'She wears practical brown-red and indigo regional textiles with leather reinforcement, woven bracers, a fitted throwing-knife case and sturdy short boots, never revealing fantasy armour.',palette:'棕紅、靛藍與皮革色配色',detailsEn:'the throwing-knife case, woven bracer, regional textile pattern, leather fastening, sturdy short boot',voice:{timbre:'明亮有力的成年女中音',pitch:'中音',pace:'短句迅速，戰場上投射強',accent:'南中地域語感（推斷）',emotion:'自信、好勝、忠誠',referenceHint:'像一位在馬背上也能把軍令喊得清楚的部族女將',prompt:'Powerful adult mezzo, mid pitch, strong outdoor projection, concise rapid commands, Nanzhong regional colouring, fearless competitive energy and loyalty.',promptLocal:'約三十歲的有力女中音，音高居中，戶外投射強；短句迅速，帶南中地域語感，自信好勝而忠於部族。'}}),
  compactSpec({name:'劉備',aliases:['玄德','劉玄德','先主'],gender:'男',age:'約四十至五十歲（推斷）',identity:'蜀漢開國君主，漢室宗親與流動軍政集團領袖',oneLiner:'以仁厚名望、韌性與結盟能力在亂世反覆失地又重建勢力的核心領袖。',traits:['仁厚','堅韌','善結盟','剋制','有政治野心'],temperament:'待人溫和、善於傾聽，重大挫敗後仍能迅速尋求新盟友；情感真切也能成為政治號召。',motivation:'建立足以匡扶漢室並安置追隨者的政權，取得不再寄人籬下的根據地。',arc:'從地方義軍領袖歷經多次依附與流亡，終於據有益州、建立蜀漢；仁義理想與帝王選擇也逐漸產生張力。',relationships:[['關羽','結義兄弟與核心將領'],['張飛','結義兄弟與先鋒武將'],['諸葛亮','三顧延請的軍師與政略核心'],['孫夫人','吳蜀聯盟下的政治婚姻']],visualLocal:'漢末至三國約四十五歲的漢族領袖，長臉、大耳特徵含蓄呈現，眼神溫和而疲憊，體態端穩。',costumeLocal:'穿素雅土黃與深青漢代長袍，外加低調甲片護肩和雙股劍佩帶，兼具流亡君主與統帥身分。',visualEn:'a forty-five-year-old Han Chinese warlord and claimant in the early 3rd century, long face, subtly prominent ears, compassionate tired eyes and steady dignified posture',costumeEn:'He wears restrained earth-yellow and deep-cyan Han robes with modest lamellar shoulder protection, a paired-sword harness and practical dark boots.',palette:'土黃、深青與暗鐵配色',detailsEn:'the paired-sword harness, modest lamellar shoulder, woven robe border, simple crown, practical boot',voice:{timbre:'溫厚帶疲憊的中年男中音',pitch:'中低音',pace:'從容，說服人時留足停頓',accent:'漢末北方士人官話語感（推斷）',emotion:'仁厚、悲憫，決斷時不失硬度',referenceHint:'像一位屢次失去城池仍能讓追隨者留下的領袖',prompt:'Warm mature baritone, low-mid pitch, deliberate persuasive cadence, educated northern Han diction, compassionate fatigue with resilient authority.',promptLocal:'約四十五歲的溫厚男中音，音高偏中低，節奏從容且善用停頓；帶北方士人語感，疲憊與悲憫之下仍有韌性和權威。'}}),
  compactSpec({name:'關羽',aliases:['關公','雲長','關雲長'],gender:'男',age:'約四十至五十歲（推斷）',identity:'劉備結義兄弟、蜀漢核心將領',oneLiner:'以忠義、自尊與壓倒性武勇著稱的統帥，威嚴也可能轉成孤高判斷。',traits:['忠義','勇猛','自負','守信','威嚴'],temperament:'平日寡言，對認可者有禮，面對敵手與不被尊重者則顯得冷峻傲慢。',motivation:'守護劉備集團與結義承諾，以軍功維持自身忠義名聲。',arc:'從共同起兵的武將成為獨鎮荊州的統帥，個人威望達到高峰，也因孤立與輕敵走向敗亡。',relationships:[['劉備','誓約與政治共同體的兄長'],['張飛','性情相反的結義弟弟'],['曹操','曾厚待他卻無法留住其忠心的敵方領袖']],visualLocal:'三世紀約四十五歲的漢族武將，身材高大，面色偏紅、鳳眼、長髯，威嚴但不做神像化妝。',costumeLocal:'穿墨綠戰袍與暗鐵札甲，配青龍偃月刀、綠色頭巾與厚底戰靴，材質務實。',visualEn:'a very tall forty-five-year-old Han Chinese general in the early 3rd century, naturally ruddy face, narrow phoenix eyes, exceptionally long dark beard and grave commanding posture, historical human rather than deity',costumeEn:'He wears a deep-green war robe over dark iron lamellar armour, a green headcloth, heavy campaign boots and carries a long crescent-bladed polearm.',palette:'墨綠、暗鐵與赭紅配色',detailsEn:'the crescent polearm blade, long beard, green headcloth knot, lamellar plate lacing, heavy campaign boot',voice:{timbre:'深沉有金屬感的成熟男低音',pitch:'低音',pace:'慢而字句分明',accent:'河東武人語感（推斷）',emotion:'威嚴、自信，鄙夷時更冷',referenceHint:'像一位不必提高音量便能讓軍帳安靜的主將',prompt:'Deep mature bass-baritone with metallic firmness, low pitch, slow exact diction, Hedong martial colouring, grave authority and cold disdain when challenged.',promptLocal:'約四十五歲的深沉男低音，音高低，咬字慢而分明；帶河東武人語感，威嚴厚重，受挑戰時冷意更強。'}}),
  compactSpec({name:'張飛',aliases:['翼德','張翼德'],gender:'男',age:'約三十五至四十五歲（推斷）',identity:'劉備結義兄弟、蜀漢猛將',oneLiner:'以爆發力、直率與震懾性嗓門衝在最前，也因失控暴烈傷害自己的軍隊。',traits:['勇猛','直率','暴躁','重義','好酒'],temperament:'情緒幾乎直接化成音量與行動，對兄弟極重情，對部下卻常缺乏節制。',motivation:'以戰功保護結義兄長與集團，用正面力量迅速解決威脅。',arc:'從起兵猛將一路建立赫赫戰功，卻始終未能完全克服酒後暴虐，最終被身邊部下反噬。',relationships:[['劉備','忠誠追隨的結義兄長'],['關羽','並肩作戰的結義兄長'],['呂布','多次正面交鋒的強敵']],visualLocal:'三世紀約四十歲的漢族猛將，肩背極寬，豹頭環眼、濃密短鬚，肌肉厚實而動勢前傾。',costumeLocal:'穿黑褐戰袍與粗重鐵甲，配丈八蛇矛、紅黑護腕與耐磨戰靴。',visualEn:'a massively broad forty-year-old Han Chinese shock general in the early 3rd century, round fierce eyes, heavy brows, dense short beard, thick muscular build and forward-driving stance',costumeEn:'He wears black-brown war robes beneath heavy iron lamellar armour, red-black bracers, durable campaign boots and carries a long serpent-bladed spear.',palette:'黑褐、暗鐵與深紅配色',detailsEn:'the serpent spear point, dense short beard, iron plate lacing, red-black bracer, worn campaign boot',voice:{timbre:'雷鳴般粗厚的成熟男低音',pitch:'低音',pace:'短促爆發，飲酒後更急',accent:'燕趙武人口音（推斷）',emotion:'豪烈、易怒、重情',referenceHint:'像一聲能壓過戰鼓的軍陣喝令',prompt:'Thunderous rough bass, very low pitch, explosive short phrases, northern martial accent, huge projection, fierce loyalty and volatile anger.',promptLocal:'約四十歲的雷鳴男低音，音高極低，短句爆發、投射巨大；帶北方武人口音，豪烈重情而易怒。'}}),
  compactSpec({name:'諸葛亮',aliases:['孔明','諸葛孔明','臥龍'],gender:'男',age:'約三十五至四十五歲（推斷）',identity:'蜀漢丞相、軍師與政略核心',oneLiner:'以長期規畫、知識與自律把流亡集團變成國家的軍政設計者。',traits:['冷靜','自律','深謀','勤勉','責任感強'],temperament:'說話平穩、善用層層推演取得信任，壓力越大越少顯露情緒。',motivation:'實踐隆中對、輔佐劉備與後主，使蜀漢在強敵間維持自主。',arc:'從隆中隱士被三顧請出，逐步成為蜀漢軍政中樞；成功建立制度，也因事事親決承擔近乎耗盡生命的責任。',relationships:[['劉備','三顧延請並託付國政的君主'],['周瑜','赤壁合作又彼此競逐的吳軍統帥'],['司馬懿','北伐中長期較量的魏國對手']],visualLocal:'三世紀約四十歲的漢族軍師，清瘦長臉、眼神冷靜，留短鬚，姿態端直而不武張。',costumeLocal:'穿羽白與深灰寬袖文士袍，戴綸巾，持羽扇，腰間掛簡牘袋與小型印綬。',visualEn:'a lean forty-year-old Han Chinese strategist in the 3rd century, long composed face, calm analytical eyes, short neat beard and upright unshowy posture',costumeEn:'He wears feather-white and deep-gray scholar robes, a historically grounded guan scarf, carries a feather fan, bamboo-slip case and modest official seal.',palette:'羽白、深灰與竹褐配色',detailsEn:'the feather fan, guan scarf fold, bamboo-slip case, official seal, cloth shoe',voice:{timbre:'清冷穩定的成熟男中音',pitch:'中音',pace:'從容而邏輯分段清楚',accent:'荊襄士人語感（推斷）',emotion:'剋制、自信，疲憊極少外露',referenceHint:'像一位在軍帳中把複雜局勢拆成可執行步驟的丞相',prompt:'Cool steady mature baritone, mid pitch, precise logical segmentation, Jingxiang scholar diction, restrained confidence and fatigue kept almost inaudible.',promptLocal:'約四十歲的清冷男中音，音高居中，語句依邏輯分段；帶荊襄士人語感，自信剋制，疲憊幾乎不外露。'}}),
  compactSpec({name:'曹操',aliases:['孟德','曹孟德','魏王'],gender:'男',age:'約五十至六十歲（推斷）',identity:'魏國奠基者、漢末權臣與統帥',oneLiner:'兼具政治手腕、軍事冒險與詩人氣質的權力中心，善用人才也深受猜疑驅動。',traits:['雄才','多疑','果決','善用人','富文采'],temperament:'談笑與威嚇切換迅速，能欣賞才能，也會在安全感受威脅時先下手為強。',motivation:'結束群雄割據並把秩序掌握在自己手中，以實際能力而非舊名分統合天下。',arc:'從討董諸侯成為控制漢廷的魏王，建立最強政權；成功與猜疑同步擴張，使他始終既是秩序建立者也是威脅來源。',relationships:[['劉備','互相辨識野心並長期競逐的對手'],['關羽','賞識並試圖收服的敵將'],['司馬懿','納入麾下但保持戒心的後期謀臣']],visualLocal:'漢末約五十五歲的漢族統帥，身高中等、額頭寬，眼神敏銳多變，鬍鬚整齊而略帶風霜。',costumeLocal:'穿玄黑與暗紅統帥袍甲，配簡潔冠帽、佩劍與虎符，避免純粹白臉奸臣化妝。',visualEn:'a fifty-five-year-old Han Chinese warlord and statesman in the early 3rd century, medium stature, broad forehead, quick assessing eyes, weathered face and neatly kept beard',costumeEn:'He wears black and dark-red command robes over restrained lamellar armour, a compact formal crown, sword, military tally and black boots.',palette:'玄黑、暗紅與鐵灰配色',detailsEn:'the military tally, compact crown, sword hilt, dark-red armour lacing, black command boot',voice:{timbre:'乾亮而有穿透力的成熟男中音',pitch:'中低音',pace:'機敏多變，詩句時放慢',accent:'譙沛與洛陽官場混合語感（推斷）',emotion:'自信、試探，猜疑時突然收冷',referenceHint:'像一位能在宴席笑談中同時衡量所有人忠誠的統帥',prompt:'Penetrating mature baritone, low-mid pitch, agile shifts between wit and command, educated northern diction, slows for poetry and turns abruptly cold under suspicion.',promptLocal:'約五十五歲的乾亮男中音，音高偏中低，能在機智笑談與軍令間迅速切換；吟詩時放慢，猜疑時聲線突然轉冷。'}}),
  compactSpec({name:'孫權',aliases:['仲謀','孫仲謀','吳侯'],gender:'男',age:'約三十至四十歲（推斷）',identity:'江東之主、孫吳政權核心',oneLiner:'在父兄基業、江東士族與強敵夾擊間維持平衡的年輕君主。',traits:['沉著','善權衡','知人','有戒心','務實'],temperament:'比武將更能等待資訊，聽取多方意見後才定案；決定一出便要求部屬一致執行。',motivation:'守住江東基業，使孫氏在曹劉兩方之間取得自主與長期政權。',arc:'他從承接兄長基業的年輕領袖成長為能主導聯盟與戰爭的君主，平衡能力既是優勢也常造成反覆。',relationships:[['周瑜','倚重的江東統帥'],['劉備','聯盟與競爭交錯的鄰國領袖'],['孫夫人','被納入吳蜀外交安排的妹妹']],visualLocal:'三世紀約三十五歲的漢族江東君主，方長臉、眼神沉著，體態精實而不誇張。',costumeLocal:'穿赭黃與青黑江東君主袍服，配低調冠帽、短劍與虎形帶扣。',visualEn:'a thirty-five-year-old Han Chinese ruler of Jiangdong in the early 3rd century, square-long face, steady evaluating eyes and compact disciplined build',costumeEn:'He wears ochre-yellow and blue-black ruler robes with a restrained crown, short sword, tiger-shaped belt buckle and black boots.',palette:'赭黃、青黑與古銅配色',detailsEn:'the tiger belt buckle, restrained crown, short-sword hilt, woven robe border, black boot',voice:{timbre:'沉穩清晰的成年男中音',pitch:'中低音',pace:'聽取意見時慢，決策時簡短',accent:'江東上層語感（推斷）',emotion:'務實、戒慎，怒意受控',referenceHint:'像一位會讓群臣把話說完、最後用短句定案的年輕君主',prompt:'Steady clear adult baritone, low-mid pitch, measured listening cadence followed by concise decisions, Jiangdong court colouring, pragmatic caution and controlled anger.',promptLocal:'約三十五歲的沉穩男中音，音高偏中低；聽取意見時節奏慢，決策時短而清楚，帶江東上層語感，務實戒慎。'}}),
  compactSpec({name:'周瑜',aliases:['公瑾','周公瑾','大都督'],gender:'男',age:'約三十至三十五歲（推斷）',identity:'孫吳大都督、赤壁之戰核心統帥',oneLiner:'兼具音律修養、俊雅風度與軍事決斷的江東統帥，在聯盟中維持吳方主導權。',traits:['俊雅','果斷','自信','精於軍事','重江東利益'],temperament:'禮儀周到而競爭心強，戰場決策快速；對威脅吳國自主的盟友保持高度警戒。',motivation:'擊退曹操、保障江東，並避免劉備集團藉聯盟坐大。',arc:'他在赤壁達到軍事聲望高峰，後續與劉備、諸葛亮的角力則使聯盟勝利轉化為新的權力焦慮。',relationships:[['孫權','信任並授予兵權的君主'],['諸葛亮','赤壁合作又競爭的蜀方軍師'],['曹操','赤壁決戰的北方強敵']],visualLocal:'三世紀約三十三歲的漢族江東統帥，清俊長臉、修整短鬚，體格精實，姿態有音樂家般節制。',costumeLocal:'穿深赤與靛青精緻將袍，外覆輕量札甲，配長劍、指揮節與小型音律玉佩。',visualEn:'a handsome thirty-three-year-old Han Chinese commander from Jiangdong in the early 3rd century, refined long face, neat short beard, athletic build and controlled musician-like poise',costumeEn:'He wears deep-red and indigo command robes over light lamellar armour, with a long sword, command baton and a small music-themed jade pendant.',palette:'深赤、靛青與冷玉配色',detailsEn:'the command baton, music jade pendant, sword guard, light lamellar lacing, polished boot',voice:{timbre:'清亮有權威的年輕男中音',pitch:'中音',pace:'流暢，軍令時切得俐落',accent:'江東士族語感（推斷）',emotion:'自信、優雅，競爭時轉銳',referenceHint:'像一位能聽出曲中錯音、也能在火攻前精準下令的統帥',prompt:'Clear authoritative young baritone, mid pitch, fluid cultured phrasing, crisp military cuts, Jiangdong aristocratic diction, elegant confidence sharpening under rivalry.',promptLocal:'約三十三歲的清亮男中音，音高居中，語句流暢有文化修養；軍令切分俐落，帶江東士族語感，競爭時聲線轉銳。'}}),
  compactSpec({name:'司馬懿',aliases:['仲達','司馬仲達'],gender:'男',age:'約五十五至六十五歲（推斷）',identity:'曹魏後期統帥與權力核心',oneLiner:'以耐心、偽裝與風險控制熬過多次政局變化，成為後期真正掌握節奏的人。',traits:['隱忍','審慎','多謀','善觀勢','意志強'],temperament:'很少讓情緒先於判斷，能接受暫時退讓；面對挑釁更重視對手目的而非個人面子。',motivation:'保全家族與自身權力，等待能以最低風險取得決定性優勢的時機。',arc:'從受曹氏防備的謀臣成為抵抗諸葛亮的主帥，最後利用政變掌握魏國實權，長期隱忍轉成制度性權力。',relationships:[['曹操','早期賞用又保持戒心的上位者'],['諸葛亮','北伐中反覆較量的對手'],['曹爽','後期權力鬥爭中被他推翻的政敵']],visualLocal:'三世紀約六十歲的漢族老年統帥，瘦長臉、眼皮略沉，鬢髮灰白，姿態節省動作而持續觀察。',costumeLocal:'穿灰黑與暗褐魏國官袍，外加低調指揮甲，配竹簡袋、短劍與深色靴。',visualEn:'a sixty-year-old Han Chinese senior commander of Cao Wei in the 3rd century, lean long face, heavy watchful eyelids, graying temples and economical observant posture',costumeEn:'He wears gray-black and dark-brown Wei official robes with understated command armour, a bamboo-document pouch, short sword and dark boots.',palette:'灰黑、暗褐與舊銀配色',detailsEn:'the bamboo-document pouch, graying temple hair, understated armour clasp, short-sword hilt, dark boot',voice:{timbre:'低而乾的老年男中音',pitch:'低音',pace:'極慢，先聽後答',accent:'河內士族官話語感（推斷）',emotion:'冷靜、隱忍，勝券在握時仍不外露',referenceHint:'像一位願意讓對手先耗盡自己、再用一句話結束議論的老統帥',prompt:'Dry elderly bass-baritone, low pitch, extremely patient cadence, listens before answering, Henei aristocratic diction, controlled calculation with almost no audible triumph.',promptLocal:'約六十歲的乾低男中音，音高低，節奏極慢而總是先聽後答；帶河內士族語感，計算與隱忍幾乎不讓勝意外露。'}}),
];

function buildThreeKingdoms() {
  const sourcePath = path.join(corpusRoot, '三國演義.txt');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const outDir = path.join(benchmarkRoot, '三國演義-主要角色');
  const cast = {
    source: '三國演義・主要角色', lang: 'zh-TW', style: 'photoreal',
    summary: '東漢末年政權崩解，各地諸侯、士族與軍隊在聯盟和戰爭中重新分配天下。劉備、曹操與孫權建立三方核心，關羽、張飛、周瑜、諸葛亮等人以武力與謀略推動局勢，宮廷與婚姻中的女性也承擔聯盟、繼承和反抗的高風險行動。從洛陽權臣鬥爭、荊州流離到赤壁與南中戰事，這群人物共同構成一個由忠誠、名分、家族和生存選擇交織的長期政治世界。',
    characters: threeKingdomsSpecs.map((spec) => makeCard(source, spec)),
  };
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, '三國演義-主要角色-cast.json'), `${JSON.stringify(cast, null, 2)}\n`);
  console.log(JSON.stringify({source: sourcePath, output: outDir, characters: cast.characters.length}, null, 2));
}

const redChamberSpecs = [
  {
    name: '賈寶玉', aliases: ['寶玉', '寶二爺', '怡紅公子'], importance: 'protagonist', gender: '男', ageRange: '約十五至十六歲（推斷）',
    identity: '榮國府公子、賈政與王夫人之子，大觀園怡紅院主人',
    oneLiner: '銜玉而生的貴族少年，以對仕途規訓的抗拒與對女兒世界的珍重站在家族秩序中央。',
    appearance: '面若中秋之月、色如春曉之花，眼神多情而靈動；常佩通靈寶玉，華服之下仍有少年未馴的輕捷。（推斷）身形清秀勻稱，黑髮束成貴族少年髮式，主色採銀紅與朱紅，和其他成年男性的深沉配色區隔。',
    personality: ['敏感', '多情', '叛逆', '真率', '憐惜弱者'],
    temperament: '在姊妹與侍女面前親近活潑，遇到八股仕途與父權訓誡便退縮或反抗；情緒來得快，關切他人時近乎忘我。',
    motivation: '守住與大觀園眾人的真情，不讓功名、家法與婚姻安排把人變成可交換的身分。',
    arc: '從被眾人呵護的富貴少年，逐步看見親近女性與整個家族被制度、債務和死亡拆散，天真因而轉成對繁華秩序的根本懷疑。',
    relationships: [{name:'林黛玉',relation:'精神知己與情感核心'}, {name:'薛寶釵',relation:'家族期待的婚姻物件與價值觀映照'}, {name:'賈母',relation:'最主要的保護者與祖母'}, {name:'賈政',relation:'以仕途和家法要求他的父親'}, {name:'襲人',relation:'貼身照料生活並勸其入世的侍女'}],
    evidencePatterns: ['何等眼熟到如此', '面若中秋之月', '原來草莽．潦倒不通世務', '女兒是水作的骨肉'],
    visualEn: 'a slender fifteen-year-old Han Chinese aristocratic boy in an elite mid-Qing-dynasty household in 18th-century Beijing, luminous oval face, lively almond eyes, straight nose, warm youthful complexion, quick compassionate expression, balanced adolescent proportions, glossy black hair in a refined period topknot with loose temple wisps',
    costumeEn: 'He wears layered silver-red and vermilion silk robes with restrained gold-thread cloud motifs, a pale jade belt ornament, soft black cloth boots, and a polished multicoloured jade pendant at his chest.',
    visualLocal: '十八世紀清代京城貴族宅院中約十五歲的漢族少年。身形纖秀勻稱，明亮鵝蛋臉、靈動杏眼、鼻樑筆直，神情溫暖而機敏；黑髮梳成精緻少年髮式，鬢邊留少量碎髮。',
    costumeLocal: '穿銀紅與朱紅層疊絲袍，暗織剋制的金線雲紋，配淡玉腰飾、黑色軟靴與胸前多彩玉佩。', paletteLocal: '銀紅、朱紅與淡玉配色', detailsEn: 'the multicoloured jade pendant, silver-red woven silk and cloud embroidery, the refined topknot ornament, pale jade belt fitting, soft black cloth boot', negativeEn: 'adult beard, muscular warrior body, imperial dragon crown, modern haircut, feminine makeup',
    voice: {timbre:'清朗溫潤的少年男聲，帶尚未完全成熟的柔軟共鳴',pitch:'中高音',pace:'日常輕快，受壓時停頓增多',accent:'京城貴族家庭的官話語感（推斷）',emotion:'真率、敏感，喜怒很快浮到聲音表面',referenceHint:'像一位一談詩便精神明亮、面對父親卻立刻收住呼吸的少年',prompt:'A teenage male voice around fifteen, clear light tenor with warm youthful resonance, mid-high pitch, educated eighteenth-century northern Mandarin colouring, lively conversational rhythm, quick emotional turns, softens around trusted companions and becomes hesitant under paternal authority.',promptLocal:'約十五歲的少年男聲，清朗輕男高音帶溫暖而未成熟的共鳴；音高偏中高，官話帶十八世紀北方貴族家庭語感。日常節奏活潑，情緒轉折迅速，面對親近的人語氣柔軟，承受父權壓力時會遲疑停頓。'}
  },
  {
    name: '賈母', aliases: ['史太君', '老太太', '老祖宗'], importance: 'major', gender: '女', ageRange: '約七十歲上下（推斷）',
    identity: '榮國府最高輩分的史氏太夫人，賈寶玉與林黛玉的外祖母', oneLiner: '以資歷、財富與情感權威維繫賈府日常秩序的老祖母，也是繁華生活最敏銳的策展者。',
    appearance: '高齡而精神充足，居正席、受眾人服侍，笑語中帶不容忽視的家主分量。（推斷）臉形寬和，銀灰髮梳高髻，皺紋隨笑意展開；衣料厚重端整，以深褐、石青與暗金呈現長輩權威。', personality:['慈愛','風趣','老練','重情','具支配力'], temperament:'善用笑話和宴飲調節全家氣氛，也能以一句話決定座次、住處與人事；她的疼愛真切，卻仍在宗法與階級秩序內運作。', motivation:'維持家族體面與內宅和樂，保護自己珍愛的晚輩，讓晚年仍能掌握家庭情感中心。', arc:'她長期以威望托住賈府繁華，越到後段越顯出個人慈愛無法逆轉整個家族制度與財務的衰敗。',
    relationships:[{name:'賈寶玉',relation:'最疼愛並多次庇護的孫子'}, {name:'林黛玉',relation:'憐愛的外孫女'}, {name:'王熙鳳',relation:'倚重其辦事與逗趣能力的孫媳'}, {name:'劉姥姥',relation:'以禮物、宴飲和玩笑接待的鄉村客人'}], evidencePatterns:['賈母正面榻上獨坐','有名的一個潑皮破落戶兒','賈母笑的摟著寶玉', '史太君兩宴大觀園'],
    visualEn:'an elderly Han Chinese aristocratic matriarch around seventy in an elite mid-Qing-dynasty household in 18th-century Beijing, broad kindly face with age spots, natural sagging skin and expression-led smile lines, alert dark eyes, dignified full figure, silver-gray hair swept into a high formal period bun', costumeEn:'She wears weighty deep-brown and stone-blue brocade layers with restrained antique-gold borders, a dark jade forehead ornament, an amber prayer-bead bracelet and embroidered black platform shoes.', visualLocal:'十八世紀清代京城貴族宅院中約七十歲的漢族女性家主。寬和臉形留有老人斑、自然鬆弛與隨表情延伸的笑紋，雙眼清醒，體態豐潤端正；銀灰髮梳成正式高髻。', costumeLocal:'穿厚重深褐與石青錦緞層衣，配剋制的暗金滾邊、深玉額飾、琥珀念珠手串與黑色繡花高底鞋。',paletteLocal:'深褐、石青與暗金配色',detailsEn:'the dark jade forehead ornament, amber prayer beads, antique-gold brocade border, silver-gray hair bun, embroidered black platform shoe',negativeEn:'young smooth face, frail beggar clothing, imperial empress crown, exaggerated comedy makeup, thin teenage body',
    voice:{timbre:'厚實溫暖的高齡女中音，笑宣告亮而有穿透力',pitch:'中低音',pace:'從容，講笑話時節奏俐落',accent:'京城上層家庭的老派官話（推斷）',emotion:'親暱中自帶權威，發怒時不必提高音量',referenceHint:'像一位能讓滿屋人跟著笑、也能用一句平話定下家務的老家主',prompt:'An elderly female voice around seventy, warm full contralto with textured age, clear projection and an unexpectedly bright laugh, low-mid pitch, measured old-fashioned northern Mandarin cadence, assured pauses, affectionate command and effortless household authority.',promptLocal:'約七十歲的高齡女聲，溫厚飽滿的女低音帶自然歲月質地，音高落在中低區，投射清楚而笑聲意外明亮；語調帶老派北方官話節奏，停頓從容，親暱與家主權威自然並存。'}
  },
  {
    name:'賈政',aliases:['政老爺','老爺'],importance:'major',gender:'男',ageRange:'約四十五至五十歲（推斷）',identity:'工部官員、榮國府二老爺，賈寶玉之父',oneLiner:'以儒家仕途與家法衡量兒子的官僚父親，嚴峻外表下也偶爾顯出審美與責任感。',appearance:'相貌端肅，言談講究讀書與名分，面對寶玉時常以父親與官員的雙重權威壓住情緒。（推斷）中等偏高身材，長方臉，眉間深紋與修整鬍鬚增加剋制感，服色採深靛與墨黑。',personality:['嚴肅','守禮','重仕途','剋制','責任導向'],temperament:'在清客與同僚間維持禮賢姿態，回到家中則把焦慮化成考問與責罰；少數點頭微笑的時刻透露他並非沒有審美，只是不容私人情感越過名教。',motivation:'使家族在官場和禮法中延續，將寶玉塑造成能承擔門第責任的合格繼承人。',arc:'他越想以傳統方法保全家族，越暴露那些方法無法理解寶玉，也無法阻止賈府從內部鬆動。',relationships:[{name:'賈寶玉',relation:'寄予仕途期待並以家法管束的兒子'},{name:'賈母',relation:'在孝道與家主權威下必須退讓的母親'},{name:'王夫人',relation:'共同維持二房秩序的妻子'},{name:'賈璉',relation:'處理家務與外務的侄子'}],evidencePatterns:['賈政最喜讀書人','禮賢下士，濟弱扶危','賈政聽了，點頭微笑','賈政訓子有方'],visualEn:'a stern Han Chinese scholar-official aged about forty-eight in an elite mid-Qing-dynasty household in 18th-century Beijing, tall restrained posture, long rectangular face, deep vertical brow crease, observant narrow eyes, straight nose, neatly trimmed moustache and short goatee, black hair concealed under a formal scholar-official cap',costumeEn:'He wears a sober deep-indigo formal robe with black gauze outer layer, subtle rank-appropriate woven motifs, dark leather belt with plain jade fittings and black official boots.',visualLocal:'十八世紀清代京城貴族宅院中約四十八歲的漢族文官。身形偏高而姿態剋制，長方臉、眉間深直紋、狹長眼、鼻樑筆直，鬍鬚修整整齊；黑髮收在正式文官帽內。',costumeLocal:'穿深靛色正式袍服與黑紗外層，暗織合於品級的低調紋樣，配素玉帶件的深色革帶和黑色官靴。',paletteLocal:'深靛、墨黑與素玉配色',detailsEn:'the formal black gauze cap, plain jade belt fitting, subtle woven official motif, neatly trimmed moustache and goatee, black official boot',negativeEn:'smiling youth, warrior armour, imperial dragon robe, flamboyant jewellery, modern business suit',voice:{timbre:'乾淨而偏硬的中年男中音，胸腔共鳴剋制',pitch:'中低音',pace:'平時慢而講究句法，動怒時短促斷句',accent:'受過經學教育的京城官話（推斷）',emotion:'端肅、審查意味強，讚許很少直接說滿',referenceHint:'像一位把每句家常話都說成考課的中年官員',prompt:'A middle-aged male voice around forty-eight, firm dry baritone with controlled chest resonance, low-mid pitch, educated northern official Mandarin, deliberate syntactic phrasing, restrained volume, clipped commands when angry and rare understated warmth.',promptLocal:'約四十八歲的中年男聲，堅實偏乾的男中音，胸腔共鳴受控；音高落在中低區，採受經學教育的北方官話，句法分明、音量剋制，動怒時命令短促，偶有溫意也極少外露。'}
  },
  {
    name:'賈璉',aliases:['璉二爺','二爺'],importance:'major',gender:'男',ageRange:'約二十至二十五歲（推斷）',identity:'榮國府長房公子，王熙鳳之夫，承辦家族內外事務',oneLiner:'在鳳姐權勢、家族差使與個人慾望間周旋的年輕管事者，精明卻缺乏穩定原則。',appearance:'二十來歲的貴族青年，熟悉交際、差旅與家務運作。（推斷）身形修長，長橢圓臉帶疲憊眼袋，笑意靈活但不完全可靠；服裝較寶玉成熟，以茶褐、孔雀藍和暗金呈現外務活動感。',personality:['世故','機變','好享樂','務實','怕強權'],temperament:'對外辦事有速度，面對鳳姐時常以笑語試探風向；既能看懂制度漏洞，也會利用漏洞滿足私慾，遇到真正壓力便先求自保。',motivation:'在家族差使中保住地位與便利，同時替自己的享樂和關係留出空間。',arc:'他從能幹而油滑的年輕承辦人逐漸陷入內宅衝突、財務壓力與權力失衡，個人弱點與家族管理的腐敗彼此放大。',relationships:[{name:'王熙鳳',relation:'能力強勢、彼此合作也彼此猜防的妻子'},{name:'平兒',relation:'協助辦事並承受夫妻權力拉扯的通房'},{name:'賈政',relation:'交辦家族外務的叔父'},{name:'賈母',relation:'需恭敬服從的祖母與最高家主'}],evidencePatterns:['今已二十來往了','雖不十分準，也有八分準了','賈璉聽了，低頭','便命人去喚賈璉'],visualEn:'a Han Chinese aristocratic household manager aged about twenty-four in an elite mid-Qing-dynasty household in 18th-century Beijing, lean elegant build, long oval face, faint under-eye fatigue, alert calculating eyes, an easy socially polished half-smile, black hair in a neat adult topknot beneath a small dark cap',costumeEn:'He wears layered tea-brown and muted peacock-blue silk robes with restrained antique-gold piping, a practical dark leather waist belt, document pouch and polished black cloth boots.',visualLocal:'十八世紀清代京城貴族宅院中約二十四歲的漢族管事公子。身形修長，長橢圓臉有淡淡眼袋，目光機警計算，帶熟練的社交性半笑；黑髮束為成年男子髮式，戴小型深色帽。',costumeLocal:'穿茶褐與低彩度孔雀藍層疊絲袍，配剋制的暗金滾邊、實用深色革帶、文書袋與拋光黑布靴。',paletteLocal:'茶褐、孔雀藍與暗金配色',detailsEn:'the compact dark cap, document pouch and tally, antique-gold silk piping, practical leather belt, polished black cloth boot',negativeEn:'teenage innocent face, elderly beard, military armour, imperial crown, modern suit',voice:{timbre:'圓滑清楚的年輕男中音，帶社交場合訓練出的笑意',pitch:'中音',pace:'反應快，試探時稍放慢',accent:'京城貴族家庭官話（推斷）',emotion:'表面輕鬆，壓力下會露出急促與防備',referenceHint:'像一位一邊盤算差使成本、一邊用笑話探測對方底線的年輕管事',prompt:'A young adult male voice around twenty-four, polished light baritone, mid pitch, educated northern household Mandarin, quick responsive pacing, socially practised warmth, slightly slower when testing another person, breath tightens under pressure.',promptLocal:'約二十四歲的年輕男聲，圓滑明晰的輕男中音，音高居中，帶京城上層家庭官話語感；反應快速而有社交性暖意，試探他人時稍微放慢，壓力上升時呼吸會變緊。'}
  },
  {
    name:'薛蟠',aliases:['薛大爺','呆霸王','文起'],importance:'major',gender:'男',ageRange:'約二十二至二十五歲（推斷）',identity:'薛家少主、皇商家族繼承人，薛寶釵之兄',oneLiner:'倚仗財勢、衝動任性的皇商少主，以粗疏慾望不斷把家人與自己拖入麻煩。',appearance:'自幼奢侈、言語傲慢，不諳生意卻慣於倚財行事。（推斷）體格厚實，方圓臉，眉粗、鼻翼寬，表情直接而缺少自制；穿赭紅與靛藍的昂貴衣料，剪裁略顯張揚。',personality:['衝動','傲慢','粗疏','重享樂','偶有憨直'],temperament:'喜怒和慾望幾乎不經過思量便付諸行動，仗著金錢與家勢要求別人收拾後果；受挫時又顯出缺乏歷練的狼狽。',motivation:'即刻取得自己想要的人、物與熱鬧，維持作為富家少主的自由與面子。',arc:'他的財勢長期替衝動兜底，卻也讓他無法學會節制；一次次闖禍使薛家資源和親族關係被持續消耗。',relationships:[{name:'薛寶釵',relation:'常替他收拾後果、也無法真正管束他的妹妹'},{name:'賈寶玉',relation:'往來宴飲、個性與教養形成對照的表弟'},{name:'賈政',relation:'入京後必須拜見的賈府長輩'},{name:'劉湘蓮',relation:'因輕薄挑釁而受挫的對手'}],evidencePatterns:['性情奢侈，言語傲慢','年輕不諳世事','薛蟠見英蓮生得不俗','引誘的薛蟠比當日更壞了十倍'],visualEn:'a wealthy Han Chinese merchant heir aged about twenty-four in mid-Qing-dynasty 18th-century Beijing, thickset strong build, broad square-round face, coarse straight brows, wide nose, ruddy uneven complexion, direct entitled stare and poorly restrained energy, black hair in an expensive but slightly untidy adult topknot',costumeEn:'He wears costly russet-red and deep-indigo silk robes with oversized gold-thread border motifs, a heavy jade-and-brass belt clasp, several rings and sturdy black satin boots, expensive materials worn with showy excess.',visualLocal:'十八世紀清代京城中約二十四歲的漢族皇商少主。體格厚實，方圓臉、粗直眉、寬鼻，膚色紅潤而不均，目光直接帶理所當然的驕氣；黑髮梳成昂貴卻略凌亂的成年髮式。',costumeLocal:'穿昂貴赭紅與深靛絲袍，金線滾邊圖樣偏大，配沉重玉銅腰釦、數枚戒指與結實黑緞靴，衣料貴重而搭配張揚。',paletteLocal:'赭紅、深靛與金銅配色',detailsEn:'the heavy jade-and-brass belt clasp, oversized gold-thread silk border, multiple rings, slightly untidy topknot ornament, sturdy black satin boot',negativeEn:'slender scholarly body, delicate teenage face, poor patched clothing, imperial robe, modern streetwear',voice:{timbre:'厚而響亮的年輕男中音，鼻腔共鳴明顯',pitch:'中低音',pace:'平時快而搶話，酒後更黏連含混',accent:'帶商戶家庭語感的京城官話（推斷）',emotion:'自滿、急躁，受挫時轉成惱羞',referenceHint:'像一位習慣用音量和銀錢搶先得到答案的富家少主',prompt:'A young adult male voice around twenty-four, loud thick baritone with noticeable nasal resonance, low-mid pitch, urban northern merchant-household Mandarin, fast interrupting pace, entitled confidence, becomes slurred when drinking and petulant when denied.',promptLocal:'約二十四歲的年輕男聲，厚實響亮的男中音帶明顯鼻腔共鳴，音高偏中低；北方城市商戶家庭官話，常搶話且語速快，語氣自滿，飲酒後黏連含混，遭拒時轉為惱羞。'}
  },
  {
    name:'劉姥姥',aliases:['姥姥','劉老老'],importance:'major',gender:'女',ageRange:'約七十歲上下（推斷）',identity:'京郊貧農老寡婦，透過女婿王狗兒與王家舊親進入賈府',oneLiner:'靠兩畝薄田度日的鄉村老婦，以膽識、幽默與務實眼光穿過賈府的禮法迷宮。',appearance:'積年老寡婦，靠薄田生活，進城時帶著外孫板兒。（推斷）身形矮壯而背略彎，皮膚受日曬呈深褐，手掌粗糙，皺紋深而有笑意；粗布衣以土褐、靛青和灰白為主。',personality:['務實','機智','堅韌','會察言觀色','知恩'],temperament:'遇到權貴先自降身段，用誇張笑話化解尷尬，真正要緊處卻敢開口、敢行動；她看似被取笑，也清楚如何把一場熱鬧換成家人生計。',motivation:'替困窘的女兒一家尋找活路，照顧板兒，並在懸殊階級之間維持尊嚴和可用的人情。',arc:'她從求助的窮親戚成為大觀園盛景的見證者；正因站在府外，她的記憶、報恩與生存能力顯得比賈府繁華更持久。',relationships:[{name:'賈母',relation:'以宴飲與笑話建立短暫親近的高門老太太'},{name:'王熙鳳',relation:'掌握接濟資源並安排她入府的管家少奶奶'},{name:'平兒',relation:'初入榮府時替她通報並給予體面的丫鬟'},{name:'板兒',relation:'帶在身邊照顧的外孫'}],evidencePatterns:['積年的老寡婦','只靠兩畝薄田度日','謀事在人，成事在天','劉姥姥便起來梳洗了'],visualEn:'an elderly Han Chinese peasant widow around seventy from the rural outskirts of 18th-century Qing Beijing, short sturdy work-worn body with a slightly bent back, broad weathered face, sun-browned uneven skin, deep expression-led wrinkles, bright observant eyes, rough hands, gray-streaked hair pulled into a low practical bun beneath a faded headcloth',costumeEn:'She wears patched earth-brown and faded indigo coarse-cotton jacket and trousers, gray-white inner collar, woven waist sash, cloth leg wraps, worn black cloth shoes, and carries a small knotted farm-cloth bundle.',visualLocal:'十八世紀清代京郊約七十歲的漢族農村寡婦。身形矮壯耐勞、背略彎，寬臉受日曬呈深褐而膚色不均，皺紋隨表情深刻，雙眼明亮會觀察，雙手粗糙；灰黑髮束成低矮實用髮髻並罩褪色頭巾。',costumeLocal:'穿補綴土褐與褪色靛青粗棉襖褲，露灰白內領，配編織腰帶、綁腿、磨損黑布鞋，攜一隻打結農布小包。',paletteLocal:'土褐、褪靛與灰白配色',detailsEn:'the rough sun-spotted hand, faded headcloth knot, patched coarse-cotton seam, woven waist sash, worn black cloth shoe',negativeEn:'aristocratic silk gown, smooth young face, fragile tiny body, imperial jewellery, caricatured toothless grin',voice:{timbre:'粗暖而有顆粒感的高齡女中音，笑聲爽亮',pitch:'中低音',pace:'敘事時有農村口語節拍，見機時反應很快',accent:'京郊農村口音（推斷）',emotion:'謙卑外表下帶務實自信與幽默',referenceHint:'像一位能把窘境講成笑話、但每句都在替一家人找活路的老農婦',prompt:'An elderly female voice around seventy, rough warm contralto with grain and a bright open laugh, low-mid pitch, rural Beijing-outskirts Mandarin colouring, story-shaped cadence, quick situational timing, outward humility with practical confidence and resilient humour.',promptLocal:'約七十歲的高齡女聲，粗暖有顆粒感的女低音，笑聲爽亮，音高落在中低區；帶京郊農村語感，敘事節拍鮮明，臨場反應快，表面謙下而內裡務實自信。'}
  },
  {
    name:'紫鵑',aliases:['紫鵑姐姐','鸚哥'],importance:'major',gender:'女',ageRange:'約十六至十八歲（推斷）',identity:'林黛玉最親近的貼身侍女，原為賈母房中丫鬟',oneLiner:'以照料、試探和直言替黛玉守住現實邊界的貼身侍女，安靜卻極有判斷力。',appearance:'長期近身照料黛玉，做事細緻，敢以言語試探寶玉真心。（推斷）身形勻稱輕捷，窄圓臉、目光沉著，黑髮梳成簡潔雙髻；穿葡萄紫、灰藍與素白的侍女服，配色穩定而不搶主家。',personality:['忠誠','敏銳','務實','勇敢','細心'],temperament:'平日語氣平穩、辦事俐落，談及黛玉終身時會直指問題核心；她不靠高聲取得力量，而靠長期觀察和在關鍵時刻承擔風險。',motivation:'保護黛玉的身體、情感與未來，迫使有能力表態的人正視她在賈府中的不安全處境。',arc:'從日常照料者逐漸成為黛玉命運最清醒的代言人；她的試探揭露寶黛關係的深度，也揭露侍女幾乎無力改變婚姻制度。',relationships:[{name:'林黛玉',relation:'近如家人的主人與被照護者'},{name:'賈寶玉',relation:'為黛玉未來主動試探其真心的人'},{name:'雪雁',relation:'共同服侍黛玉的侍女'},{name:'賈母',relation:'原先所屬並將她給黛玉使喚的家主'}],evidencePatterns:['紫鵑姐姐怕姑娘冷','紫鵑遞過香皂','他是客，自然先倒了茶來','情辭試忙玉'],visualEn:'a Han Chinese senior maid aged about seventeen in an elite mid-Qing-dynasty household in 18th-century Beijing, balanced agile build, narrow round face, steady observant almond eyes, straight brows, composed mouth, warm medium complexion, black hair arranged in two compact practical maid buns with restrained side wisps',costumeEn:'She wears a clean muted grape-purple and gray-blue cotton-silk maid jacket over a plain off-white collar, narrow working sleeves, dark pleated skirt, small silver hairpin, cloth key pouch and quiet black embroidered shoes.',visualLocal:'十八世紀清代京城貴族宅院中約十七歲的漢族資深侍女。身形勻稱輕捷，窄圓臉、沉著杏眼、平直眉與剋制嘴角，膚色自然偏暖；黑髮梳成兩個緊實實用的小髻，鬢邊留少量碎髮。',costumeLocal:'穿乾淨的低彩度葡萄紫與灰藍棉絲侍女襖，露素白內領，窄工作袖配深色褶裙、小銀簪、布製鑰匙袋與安靜的黑色繡鞋。',paletteLocal:'葡萄紫、灰藍與素白配色',detailsEn:'the small silver hairpin, cloth key pouch, narrow working cuff, grape-purple cotton-silk weave, black embroidered maid shoe',negativeEn:'aristocratic crown, ornate mistress jewellery, child body, seductive pose, modern uniform',voice:{timbre:'沉靜清楚的年輕女中音，聲線不高卻很穩',pitch:'中音',pace:'日常平順，說到要害時放慢並加重字尾',accent:'京城宅院官話，帶輕微江南陪伴語感（推斷）',emotion:'剋制、關切，必要時有不退讓的硬度',referenceHint:'像一位把照護做成判斷、用一句平話逼人面對後果的貼身侍女',prompt:'A young female voice around seventeen, steady clear mezzo-soprano, mid pitch, educated household Mandarin with a faint softened Jiangnan colouring, even practical pace, lowers and slows on essential points, restrained care with quiet uncompromising resolve.',promptLocal:'約十七歲的年輕女聲，沉靜清楚的女中音，音高居中；宅院官話略帶柔和江南語感，日常節奏平順務實，說到關鍵處會降低音高、放慢速度，關切剋制而有安靜的不退讓。'}
  },
  {
    name:'平兒',aliases:['平兒','平姑娘'],importance:'major',gender:'女',ageRange:'約二十至二十五歲（推斷）',identity:'王熙鳳的心腹大丫鬟、賈璉通房，協助處理榮府家務',oneLiner:'身處夫妻與主僕權力夾縫的能幹助手，以分寸、同理和執行力替許多人留下一線餘地。',appearance:'被稱作鳳姐心腹，能代為通報、查問與處置家務，旁人認為她「為人很好」。（推斷）身形端勻，鵝蛋臉，目光柔和但警醒；髮式整潔成熟，衣著以青綠、藕灰和米白呈現可信任的管事感。',personality:['能幹','體貼','審慎','公允','有分寸'],temperament:'她懂得鳳姐的權威如何運作，也知道何時柔化命令、何時立即辦理；受委屈時常先收住情緒，再用事實和人情尋找可行出口。',motivation:'在無法自由選擇的主僕與婚姻位置中保全自己，維持家務運作，也盡可能減少權力對較弱者的傷害。',arc:'她一直是榮府管理機器中最可靠的緩衝者；越能辦事，越顯出她的善意只能修補制度造成的傷口，不能真正取得自主。',relationships:[{name:'王熙鳳',relation:'信任她辦事、也掌握她命運的女主人'},{name:'賈璉',relation:'有親密關係卻無正式地位保障的男主人'},{name:'劉姥姥',relation:'初入榮府時替她通報並維持體面的來客'},{name:'賈探春',relation:'共同處理府務時彼此認可能力的小姐'}],evidencePatterns:['心腹通房大丫頭名喚平兒','平兒站在炕沿邊，打量了劉姥姥兩眼','你就帶進來現辦','平姑娘為人很好'],visualEn:'a Han Chinese senior household attendant aged about twenty-three in an elite mid-Qing-dynasty household in 18th-century Beijing, poised balanced build, soft oval face, calm alert almond eyes, gently straight brows, composed mouth with restrained empathy, warm light-medium complexion, black hair in a tidy mature servant updo with a modest jade-green pin',costumeEn:'She wears layered muted celadon-green and lotus-root-gray cotton-silk garments with an ivory inner collar, precise narrow cuffs, a practical dark sash with account-token pouch, understated silver earrings and clean black embroidered shoes.',visualLocal:'十八世紀清代京城貴族宅院中約二十三歲的漢族高階女侍。身形端勻，柔和鵝蛋臉、沉著警醒的杏眼、平順眉形與剋制而帶同理的嘴角，膚色自然偏暖；黑髮梳成整潔成熟的侍女髮髻，配小型玉綠簪。',costumeLocal:'穿低彩度青瓷綠與藕灰棉絲層衣，露米白內領，窄袖口收得精準，深色實用腰帶掛帳務牌袋，配低調銀耳飾與乾淨黑色繡鞋。',paletteLocal:'青瓷綠、藕灰與米白配色',detailsEn:'the modest jade-green hairpin, account-token pouch, precise narrow cuff, understated silver earring, clean black embroidered shoe',negativeEn:'ornate aristocratic crown, teenage child face, seductive pose, imperial robe, modern office clothing',voice:{timbre:'柔和沉穩的年輕女中音，咬字清楚而不帶壓迫',pitch:'中音',pace:'辦事時俐落，安撫人時放緩',accent:'京城宅院中受過訓練的官話（推斷）',emotion:'理性、體貼，受委屈時仍先維持分寸',referenceHint:'像一位能在命令與人情之間迅速找到可執行方案的資深助手',prompt:'A young adult female voice around twenty-three, warm steady mezzo-soprano, mid pitch, trained elite-household northern Mandarin, clear efficient diction, brisk when handling tasks and slower when protecting another person, rational composure with restrained hurt and humane tact.',promptLocal:'約二十三歲的年輕女聲，溫和穩定的女中音，音高居中；受過宅院訓練的北方官話，咬字清楚，辦事時俐落，保護或安撫他人時放慢，理性分寸下保留被壓住的委屈與同理。'}
  },
];

function buildRedChamber() {
  const sourcePath = path.join(corpusRoot, '紅樓夢.txt');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const oldDir = path.join(benchmarkRoot, '紅樓夢-主要女性角色');
  const oldCastPath = path.join(oldDir, '紅樓夢-主要女性角色-cast.json');
  const outDir = path.join(benchmarkRoot, '紅樓夢-主要角色');
  const existing = JSON.parse(fs.readFileSync(oldCastPath, 'utf8'));
  const characters = [...existing.characters, ...redChamberSpecs.map((spec) => makeCard(source, spec))];
  const cast = {
    source: '紅樓夢・主要角色',
    lang: 'zh-TW',
    style: 'photoreal',
    summary: '清代貴族賈府以婚姻、仕途與內宅管理維繫龐大家族，銜玉而生的賈寶玉則在大觀園裡與眾多女性建立不受功名衡量的親密關係。林黛玉、薛寶釵與眾姊妹以詩社、日常照護和家務決策展現各自的才情與處境，賈母、賈政、王熙鳳等長輩則分別代表情感、家法與治理權力。劉姥姥從鄉村進入賈府，使園中繁華在階級差距的映照下更為鮮明，也讓這群人物共同站在盛景逐漸鬆動的時刻。',
    characters,
  };
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, '紅樓夢-主要角色-cast.json'), `${JSON.stringify(cast, null, 2)}\n`);
  console.log(JSON.stringify({source: sourcePath, output: outDir, characters: characters.length}, null, 2));
}

function buildJinPingMei() {
  const externalRoot = 'C:\\cc_home\\novel-characters-lab\\jinpingmei-full';
  const sourcePath = path.join(corpusRoot, '金瓶梅.txt');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const externalCastPath = path.join(externalRoot, '_current', 'characters', '金瓶梅詞話-目前視覺權威角色-cast.json');
  const external = JSON.parse(fs.readFileSync(externalCastPath, 'utf8'));
  const outDir = path.join(benchmarkRoot, '金瓶梅-主要角色');
  const baseLayout = 'Create ONE 16:9 landscape canvas divided into three zones by thin hairline rules. LEFT ZONE occupies about 34% of the canvas width: one large front-facing bust portrait, head and shoulders, both shoulders fully visible, centred like an ID photograph with a clean straight horizontal bottom cut; this portrait is the facial identity anchor. RIGHT-TOP ZONE: three equal-height FULL-BODY views of the SAME actor, true front, strict left profile and true back, on one shared ground line; the face, age, body proportions, hairstyle, garments, colours and shoes must match the left portrait exactly. PROPORTIONS ARE CRITICAL: correct anatomy and limb lengths, clear margin above and below, no stretching, squashing or foreshortening. RIGHT-BOTTOM ZONE: four to five small isolated detail studies, smaller than the figures; if they do not fit, continue down the right edge; the detail studies give way, not the figures. Plain pure white background, generous even margins, no scenery, no written labels, no text, no watermark. LIGHTING IN THE LEFT ZONE ONLY: a large soft-box key from the upper left with gentle bounce fill and real ambient occlusion. LIGHTING IN THE RIGHT ZONES: flat even orthographic frontal studio light with no directional key and no cast shadows on the backdrop.';
  const characters = external.characters.map((card) => {
    const matchingEvidence = card.persona.evidence.filter((quote) => source.includes(quote));
    if (matchingEvidence.length === 0) throw new Error(`${card.name} 沒有可遷移的本 repo 原文引文`);
    const externalNegative = card.image.negativePrompt
      .replace(/photorealistic/gi, '')
      .replace(/3d render/gi, 'synthetic CGI render')
      .replace(/,\s*,/g, ',');
    return {
      name: card.name,
      aliases: card.aliases,
      importance: card.importance,
      oneLiner: card.oneLiner,
      persona: {...card.persona, evidence: matchingEvidence},
      image: {
        style: '擬真實拍晚明歷史劇試裝定妝照，人物身分、臉部、體態、衣著與配色鎖定外部現行視覺權威',
        prompt: `${card.image.prompt} ${photoreal.render}. ${photoreal.surface}.`,
        promptLocal: card.image.promptZh,
        negativePrompt: `${photoreal.negative}, ${externalNegative}`,
        tags: [...new Set([...photoreal.tags, ...card.image.tags])].slice(0, 8),
        sheet: `${baseLayout} IDENTITY-LOCKED ACTOR AND COSTUME DESCRIPTION: ${card.image.turnaround} ${photoreal.render}. ${photoreal.surface}.`,
      },
      voice: {
        timbre: card.voice.timbre,
        pitch: card.voice.pitch,
        pace: card.voice.pace,
        accent: card.voice.accent,
        emotion: card.voice.emotion,
        referenceHint: card.voice.referenceHint,
        prompt: card.voice.prompt,
        promptLocal: card.voice.promptZh,
      },
    };
  });
  const cast = {
    source: '金瓶梅・主要角色',
    lang: 'zh-TW',
    style: 'photoreal',
    summary: '晚明商業城市清河縣中，西門慶以財富、官場關係與婚姻網路擴張勢力，妻妾、僕役、幫閒與地方人物因而被捲入同一座宅院及其外部交易。潘金蓮、李瓶兒、吳月娘、龐春梅等女性在內宅權力、情感需求與生存策略之間各自行動，武松、陳經濟、應伯爵等男性則從復仇、依附與慾望的不同位置介入。這十九人共同呈現財富如何轉化為親密控制與社會權力，也讓日常宴飲、帳務和往來成為人物命運交錯的場域。',
    characters,
  };
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, '金瓶梅-主要角色-cast.json'), `${JSON.stringify(cast, null, 2)}\n`);
  console.log(JSON.stringify({source: sourcePath, externalCast: externalCastPath, output: outDir, characters: characters.length}, null, 2));
}

const target = process.argv[2];
if (target === '紅樓夢' || target === 'red-chamber') {
  buildRedChamber();
} else if (target === '金瓶梅' || target === 'jin-ping-mei') {
  buildJinPingMei();
} else if (target === '三國演義' || target === 'three-kingdoms') {
  buildThreeKingdoms();
} else {
  console.error('用法：node scripts/build-classic-character-baselines.mjs <紅樓夢|金瓶梅|三國演義>');
  process.exitCode = 1;
}
