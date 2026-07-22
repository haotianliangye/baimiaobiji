export const SYNC_CONSTANTS = {
  // Sync
  AUTO_SYNC_DEBOUNCE_MS: 2000,
  API_RATE_LIMIT_DELAY_MS: 3000,
  
  // Storage
  BACKUP_FILENAME_ZIP: 'baimiao_data.enc',
  BACKUP_FILENAME_JSON: 'data.enc',

  // Google Drive
  GDRIVE_MULTIPART_BOUNDARY: '314159265358979323846',
  
  // Default OAuth Client IDs
  DEFAULT_ONEDRIVE_CLIENT_ID: 'e74f3468-f9b8-4903-b097-d86b037dfc89', // Use VITE_ONEDRIVE_CLIENT_ID in env
  DEFAULT_GDRIVE_CLIENT_ID: '575661159981-d13lnd7t0gblvobq63o15vtsq5q245p7.apps.googleusercontent.com', // Use VITE_GDRIVE_CLIENT_ID in env
  DEFAULT_DROPBOX_CLIENT_ID: '3qy6q5w6sc1m22l', // Use VITE_DROPBOX_CLIENT_ID in env
};

export const CRYPTO_CONSTANTS = {
  // Key Derivation
  PBKDF2_ITERATIONS: 100000,
  KEY_LENGTH_BITS: 256,
  SALT_LENGTH_BYTES: 16,

  // Encryption
  IV_LENGTH_BYTES: 12,
  ALGORITHM: 'AES-GCM',
};

// #009-ext: TTS 提供商预置音色常量。
// 数据来源：Google AI Studio Gemini TTS 文档（30 个预置音色）+ 火山引擎官方音色列表（在线 + 多语种 + 方言，去重）。
// 与官方文档 1:1 对应；用户看到的下拉选项就是"权威源"本人，无需查文档。
// 维护注意：Google/字节官方更新时同步追加；新增 Provider 需在下方追加新块并在 TTS_VOICES 索引里挂上。
export interface TtsVoiceOption {
  /** 发送给后端的 voice id（如 "Kore" / "BV001_streaming"） */
  id: string;
  /** 下拉里给用户看的中文/英文标签（含性别/风格/角色提示） */
  label: string;
  /** 简短描述（如 "沉稳温柔"） */
  desc: string;
  /** 分类分组（用于下拉里的分组标题） */
  group: string;
  /** 主要语言 */
  lang: string;
}

export const GEMINI_TTS_VOICES: TtsVoiceOption[] = [
  // 顺序与官方文档表格一致
  { id: 'Zephyr', label: 'Zephyr · 清新明亮', desc: '通用默认，明亮自然', group: '通用', lang: 'multi' },
  { id: 'Puck', label: 'Puck · 活力年轻', desc: '年轻有活力，情绪外放', group: '通用', lang: 'multi' },
  { id: 'Charon', label: 'Charon · 沉稳叙述', desc: '信息密度高，适合长文', group: '通用', lang: 'multi' },
  { id: 'Kore', label: 'Kore · 柔和女声', desc: '沉稳温柔，中性场景', group: '通用', lang: 'multi' },
  { id: 'Fenrir', label: 'Fenrir · 沙哑男声', desc: '略带磁性，戏剧感', group: '通用', lang: 'multi' },
  { id: 'Leda', label: 'Leda · 少女音', desc: '年轻清新', group: '通用', lang: 'multi' },
  { id: 'Orus', label: 'Orus · 庄重男声', desc: '平稳庄重', group: '通用', lang: 'multi' },
  { id: 'Aoede', label: 'Aoede · 轻快女声', desc: '轻快明亮', group: '通用', lang: 'multi' },
  { id: 'Callirrhoe', label: 'Callirrhoe · 舒适女声', desc: '温柔舒适', group: '通用', lang: 'multi' },
  { id: 'Autonoe', label: 'Autonoe · 清亮', desc: '清亮有光泽', group: '通用', lang: 'multi' },
  { id: 'Enceladus', label: 'Enceladus · 气声', desc: '带气声，疲惫感', group: '通用', lang: 'multi' },
  { id: 'Iapetus', label: 'Iapetus · 清晰男声', desc: '清晰干净', group: '通用', lang: 'multi' },
  { id: 'Umbriel', label: 'Umbriel · 随和男声', desc: '平和不抢戏', group: '通用', lang: 'multi' },
  { id: 'Algieba', label: 'Algieba · 顺滑男声', desc: '顺滑沉稳', group: '通用', lang: 'multi' },
  { id: 'Despina', label: 'Despina · 柔顺女声', desc: '柔顺温和', group: '通用', lang: 'multi' },
  { id: 'Erinome', label: 'Erinome · 清晰女声', desc: '清晰平稳', group: '通用', lang: 'multi' },
  { id: 'Algenib', label: 'Algenib · 微沙哑', desc: '略带沙哑', group: '通用', lang: 'multi' },
  { id: 'Rasalgethi', label: 'Rasalgethi · 信息型', desc: '信息密度高', group: '通用', lang: 'multi' },
  { id: 'Laomedeia', label: 'Laomedeia · 活泼', desc: '活泼欢快', group: '通用', lang: 'multi' },
  { id: 'Achernar', label: 'Achernar · 温柔女声', desc: '柔和舒缓', group: '通用', lang: 'multi' },
  { id: 'Alnilam', label: 'Alnilam · 稳重型', desc: '稳重踏实', group: '通用', lang: 'multi' },
  { id: 'Schedar', label: 'Schedar · 平稳', desc: '平稳中性', group: '通用', lang: 'multi' },
  { id: 'Gacrux', label: 'Gacrux · 成熟男声', desc: '成熟低沉', group: '通用', lang: 'multi' },
  { id: 'Pulcherrima', label: 'Pulcherrima · 过渡型', desc: '中性过渡', group: '通用', lang: 'multi' },
  { id: 'Achird', label: 'Achird · 友好男声', desc: '亲切友好', group: '通用', lang: 'multi' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi · 自然', desc: '自然平常', group: '通用', lang: 'multi' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix · 温柔', desc: '温柔安静', group: '通用', lang: 'multi' },
  { id: 'Sadachbia', label: 'Sadachbia · 生动', desc: '生动活泼', group: '通用', lang: 'multi' },
  { id: 'Sadaltager', label: 'Sadaltager · 知性', desc: '知性成熟', group: '通用', lang: 'multi' },
  { id: 'Sulafat', label: 'Sulafat · 温暖男声', desc: '温暖宽厚', group: '通用', lang: 'multi' },
];

// 火山引擎音色：按"通用 → 有声阅读 → 智能助手 → 视频配音 → 特色 → 广告 → 新闻 → 教育 → 多语种 → 方言"分组。
// 描述综合自官方"音色名称 + 支持情感/风格"两列。
export const VOLCENGINE_TTS_VOICES: TtsVoiceOption[] = [
  // 通用场景
  { id: 'BV700_V2_streaming', label: '灿灿 2.0', desc: '女声·22 种情感，最丰富', group: '通用', lang: 'zh' },
  { id: 'BV705_streaming', label: '炀炀', desc: '男声·自然对话/通用', group: '通用', lang: 'zh' },
  { id: 'BV701_V2_streaming', label: '擎苍 2.0', desc: '男声·旁白舒缓/沉浸', group: '通用', lang: 'zh' },
  { id: 'BV001_V2_streaming', label: '通用女声 2.0', desc: '女声·通用', group: '通用', lang: 'zh' },
  { id: 'BV700_streaming', label: '灿灿', desc: '女声·22 种情感，支持多语言', group: '通用', lang: 'multi' },
  { id: 'BV406_V2_streaming', label: '超自然音色-梓梓 2.0', desc: '女声·超自然', group: '通用', lang: 'zh' },
  { id: 'BV406_streaming', label: '超自然音色-梓梓', desc: '女声·7 种情感', group: '通用', lang: 'zh' },
  { id: 'BV407_V2_streaming', label: '超自然音色-燃燃 2.0', desc: '男声·超自然', group: '通用', lang: 'zh' },
  { id: 'BV407_streaming', label: '超自然音色-燃燃', desc: '男声·超自然', group: '通用', lang: 'zh' },
  { id: 'BV001_streaming', label: '通用女声', desc: '女声·12 种情感·客服/助手', group: '通用', lang: 'zh' },
  { id: 'BV002_streaming', label: '通用男声', desc: '男声·通用默认', group: '通用', lang: 'zh' },
  // 有声阅读
  { id: 'BV701_streaming', label: '擎苍', desc: '男声·旁白舒缓/沉浸', group: '有声阅读', lang: 'zh' },
  { id: 'BV123_streaming', label: '阳光青年', desc: '男声·7 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV120_streaming', label: '反卷青年', desc: '男声·7 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV119_streaming', label: '通用赘婿', desc: '男声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV115_streaming', label: '古风少御', desc: '女声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV107_streaming', label: '霸气青叔', desc: '男声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV100_streaming', label: '质朴青年', desc: '男声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV104_streaming', label: '温柔淑女', desc: '女声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV004_streaming', label: '开朗青年', desc: '男声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV113_streaming', label: '甜宠少御', desc: '女声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  { id: 'BV102_streaming', label: '儒雅青年', desc: '男声·旁白/8 种情感', group: '有声阅读', lang: 'zh' },
  // 智能助手
  { id: 'BV405_streaming', label: '甜美小源', desc: '女声·智能助手', group: '智能助手', lang: 'zh' },
  { id: 'BV007_streaming', label: '亲切女声', desc: '女声·通用', group: '智能助手', lang: 'zh' },
  { id: 'BV009_streaming', label: '知性女声', desc: '女声·客服/专业/严肃', group: '智能助手', lang: 'zh' },
  { id: 'BV419_streaming', label: '诚诚', desc: '男声·通用', group: '智能助手', lang: 'zh' },
  { id: 'BV415_streaming', label: '童童', desc: '童声·通用', group: '智能助手', lang: 'zh' },
  { id: 'BV008_streaming', label: '亲切男声', desc: '男声·客服/专业/严肃', group: '智能助手', lang: 'zh' },
  // 视频配音
  { id: 'BV408_streaming', label: '译制片男声', desc: '男声·影视译制', group: '视频配音', lang: 'zh' },
  { id: 'BV426_streaming', label: '懒小羊', desc: '女声·日常', group: '视频配音', lang: 'zh' },
  { id: 'BV428_streaming', label: '清新文艺女声', desc: '女声·清新', group: '视频配音', lang: 'zh' },
  { id: 'BV403_streaming', label: '鸡汤女声', desc: '女声·治愈', group: '视频配音', lang: 'zh' },
  { id: 'BV158_streaming', label: '智慧老者', desc: '男声·长者', group: '视频配音', lang: 'zh' },
  { id: 'BV157_streaming', label: '慈爱姥姥', desc: '女声·长辈', group: '视频配音', lang: 'zh' },
  { id: 'BR001_streaming', label: '说唱小哥', desc: '男声·说唱', group: '视频配音', lang: 'zh' },
  { id: 'BV410_streaming', label: '活力解说男', desc: '男声·活力解说', group: '视频配音', lang: 'zh' },
  { id: 'BV411_streaming', label: '影视解说小帅', desc: '男声·影视解说', group: '视频配音', lang: 'zh' },
  { id: 'BV437_streaming', label: '解说小帅-多情感', desc: '男声·7 种情感解说', group: '视频配音', lang: 'zh' },
  { id: 'BV412_streaming', label: '影视解说小美', desc: '女声·影视解说', group: '视频配音', lang: 'zh' },
  { id: 'BV159_streaming', label: '纨绔青年', desc: '男声·痞气', group: '视频配音', lang: 'zh' },
  { id: 'BV418_streaming', label: '直播一姐', desc: '女声·直播', group: '视频配音', lang: 'zh' },
  { id: 'BV142_streaming', label: '沉稳解说男', desc: '男声·沉稳解说', group: '视频配音', lang: 'zh' },
  { id: 'BV143_streaming', label: '潇洒青年', desc: '男声·潇洒', group: '视频配音', lang: 'zh' },
  { id: 'BV056_streaming', label: '阳光男声', desc: '男声·阳光', group: '视频配音', lang: 'zh' },
  { id: 'BV005_streaming', label: '活泼女声', desc: '女声·活泼', group: '视频配音', lang: 'zh' },
  { id: 'BV064_streaming', label: '小萝莉', desc: '童声·7 种情感', group: '视频配音', lang: 'zh' },
  // 特色音色
  { id: 'BV051_streaming', label: '奶气萌娃', desc: '童声·奶气', group: '特色', lang: 'zh' },
  { id: 'BV063_streaming', label: '动漫海绵', desc: '男声·动漫', group: '特色', lang: 'zh' },
  { id: 'BV417_streaming', label: '动漫海星', desc: '男声·动漫', group: '特色', lang: 'zh' },
  { id: 'BV050_streaming', label: '动漫小新', desc: '童声·动漫', group: '特色', lang: 'zh' },
  { id: 'BV061_streaming', label: '天才童声', desc: '童声·天才', group: '特色', lang: 'zh' },
  // 广告配音
  { id: 'BV401_streaming', label: '促销男声', desc: '男声·促销', group: '广告配音', lang: 'zh' },
  { id: 'BV402_streaming', label: '促销女声', desc: '女声·促销', group: '广告配音', lang: 'zh' },
  { id: 'BV006_streaming', label: '磁性男声', desc: '男声·磁性', group: '广告配音', lang: 'zh' },
  // 新闻播报
  { id: 'BV011_streaming', label: '新闻女声', desc: '女声·新闻', group: '新闻播报', lang: 'zh' },
  { id: 'BV012_streaming', label: '新闻男声', desc: '男声·新闻', group: '新闻播报', lang: 'zh' },
  // 教育场景
  { id: 'BV034_streaming', label: '知性姐姐-双语', desc: '女声·中英双语', group: '教育', lang: 'zh' },
  { id: 'BV033_streaming', label: '温柔小哥', desc: '男声·温柔', group: '教育', lang: 'zh' },
  // 多语种 - 美式英语
  { id: 'BV511_streaming', label: '慵懒女声-Ava', desc: '女声·美式英语·7 种情感', group: '多语种', lang: 'en' },
  { id: 'BV505_streaming', label: '议论女声-Alicia', desc: '女声·美式英语', group: '多语种', lang: 'en' },
  { id: 'BV138_streaming', label: '情感女声-Lawrence', desc: '女声·美式英语·8 种情感', group: '多语种', lang: 'en' },
  { id: 'BV027_streaming', label: '美式女声-Amelia', desc: '女声·美式英语', group: '多语种', lang: 'en' },
  { id: 'BV502_streaming', label: '讲述女声-Amanda', desc: '女声·美式英语', group: '多语种', lang: 'en' },
  { id: 'BV503_streaming', label: '活力女声-Ariana', desc: '女声·美式英语', group: '多语种', lang: 'en' },
  { id: 'BV504_streaming', label: '活力男声-Jackson', desc: '男声·美式英语', group: '多语种', lang: 'en' },
  { id: 'BV421_streaming', label: '天才少女', desc: '女声·8 国语言', group: '多语种', lang: 'multi' },
  { id: 'BV702_streaming', label: 'Stefan', desc: '男声·6 国语言', group: '多语种', lang: 'multi' },
  { id: 'BV506_streaming', label: '天真萌娃-Lily', desc: '童声·美式英语', group: '多语种', lang: 'en' },
  // 多语种 - 英式/澳洲
  { id: 'BV040_streaming', label: '亲切女声-Anna', desc: '女声·英式英语·7 种情感', group: '多语种', lang: 'en' },
  { id: 'BV516_streaming', label: '澳洲男声-Henry', desc: '男声·澳洲英语', group: '多语种', lang: 'en' },
  // 多语种 - 日语
  { id: 'BV520_streaming', label: '元气少女', desc: '女声·日语', group: '多语种', lang: 'ja' },
  { id: 'BV521_streaming', label: '萌系少女', desc: '女声·日语', group: '多语种', lang: 'ja' },
  { id: 'BV522_streaming', label: '气质女声', desc: '女声·日语', group: '多语种', lang: 'ja' },
  { id: 'BV524_streaming', label: '日语男声', desc: '男声·日语', group: '多语种', lang: 'ja' },
  // 多语种 - 葡/西/泰/越/印尼
  { id: 'BV531_streaming', label: '活力男声Carlos', desc: '男声·葡语（巴西）', group: '多语种', lang: 'pt' },
  { id: 'BV530_streaming', label: '活力女声（巴西）', desc: '女声·葡语（巴西）', group: '多语种', lang: 'pt' },
  { id: 'BV065_streaming', label: '气质御姐（墨西哥）', desc: '女声·西语（墨西哥）', group: '多语种', lang: 'es' },
  // 方言
  { id: 'BV021_streaming', label: '东北老铁', desc: '男声·东北话', group: '方言', lang: 'zh' },
  { id: 'BV020_streaming', label: '东北丫头', desc: '女声·东北话', group: '方言', lang: 'zh' },
  { id: 'BV704_streaming', label: '方言灿灿', desc: '女声·多方言', group: '方言', lang: 'zh' },
  { id: 'BV210_streaming', label: '西安佟掌柜', desc: '女声·西安话', group: '方言', lang: 'zh' },
  { id: 'BV217_streaming', label: '沪上阿姐', desc: '女声·上海话', group: '方言', lang: 'zh' },
  { id: 'BV213_streaming', label: '广西表哥', desc: '男声·广西普通话', group: '方言', lang: 'zh' },
  { id: 'BV025_streaming', label: '甜美台妹', desc: '女声·台湾普通话', group: '方言', lang: 'zh' },
  { id: 'BV227_streaming', label: '台普男声', desc: '男声·台湾普通话', group: '方言', lang: 'zh' },
  { id: 'BV026_streaming', label: '港剧男神', desc: '男声·粤语', group: '方言', lang: 'zh' },
  { id: 'BV424_streaming', label: '广东女仔', desc: '女声·粤语', group: '方言', lang: 'zh' },
  { id: 'BV212_streaming', label: '相声演员', desc: '男声·天津话', group: '方言', lang: 'zh' },
  { id: 'BV019_streaming', label: '重庆小伙', desc: '男声·川渝话', group: '方言', lang: 'zh' },
  { id: 'BV221_streaming', label: '四川甜妹儿', desc: '女声·川渝话', group: '方言', lang: 'zh' },
  { id: 'BV423_streaming', label: '重庆幺妹儿', desc: '女声·川渝话', group: '方言', lang: 'zh' },
  { id: 'BV214_streaming', label: '乡村企业家', desc: '男声·郑州话', group: '方言', lang: 'zh' },
  { id: 'BV226_streaming', label: '湖南妹坨', desc: '女声·湖南普通话', group: '方言', lang: 'zh' },
  { id: 'BV216_streaming', label: '长沙靓女', desc: '女声·长沙话', group: '方言', lang: 'zh' },
];

/**
 * Provider -> 预置音色列表。用户在 TTS 设置页"语音"下拉里看到的就是这个。
 * 维护：新增 Provider 时在此处追加。
 */
export const TTS_VOICES: Record<'gemini' | 'volcengine', TtsVoiceOption[]> = {
  gemini: GEMINI_TTS_VOICES,
  volcengine: VOLCENGINE_TTS_VOICES,
};

/**
 * 根据 voice id 查找对应的显示标签。如果 id 不在当前 Provider 的列表里（老用户旧值/自定义），
 * 返回 null——UI 应展示"未匹配，请重新选择"的占位状态。
 */
export function findTtsVoiceLabel(
  provider: 'gemini' | 'volcengine',
  voiceId: string
): TtsVoiceOption | null {
  if (!voiceId) return null;
  const list = TTS_VOICES[provider];
  return list.find((v) => v.id === voiceId) || null;
}
