(() => {
  'use strict';

  const state = {
    data: { terms: [], cases: [], sources: [] },
    view: 'home',
    pending: null,
    meta: null,
    result: null,
    sampleCase: null,
    liveFacts: [],
    imageFile: null,
    termQuery: '',
    termCat: '全部'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHTML = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const nowStamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let toastTimer = null;
  function showToast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function boot() {
    try {
      const [terms, cases, sources, testset, adapters] = await Promise.all([
        fetch('data/terms.json', { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('terms.json');
          return r.json();
        }),
        fetch('data/cases.json', { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('cases.json');
          return r.json();
        }),
        fetch('data/sources.json', { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('sources.json');
          return r.json();
        }),
        fetch('data/testset.json', { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('testset.json');
          return r.json();
        }),
        fetch('data/adapters.json', { cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('adapters.json');
          return r.json();
        })
      ]);
      state.data = { terms, cases, sources, testset, adapters };
    } catch (err) {
      $('#app').innerHTML = `
        <section class="section" style="margin-top:26px">
          <div class="panel">
            <div class="notice bad">
              <strong>数据加载失败。</strong><br>
              请用本地服务器打开，而不是直接双击 index.html：<br>
              <code>cd path/to/weather-rumor-judger-demo/web</code><br>
              <code>python -m http.server 8000</code><br>
              然后访问 <code>http://localhost:8000</code>。
            </div>
            <p class="small muted" style="margin-top:12px">错误：${escapeHTML(err.message || String(err))}</p>
          </div>
        </section>`;
      return;
    }

    window.addEventListener('hashchange', route);
    document.addEventListener('paste', handlePasteImage);
    route();
  }

  function handlePasteImage(event) {
    if (state.view !== 'home') return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageItem = Array.from(items).find(item => item.type && item.type.startsWith('image/'));
    if (!imageItem) return;
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (file && typeof state.showImage === 'function') {
      state.showImage(file, 'paste');
    }
  }

  function route() {
    const hash = (location.hash || '#/home').replace(/^#\/?/, '');
    const allowed = ['home', 'confirm', 'result', 'terms', 'cases', 'sources', 'method'];
    let view = allowed.includes(hash) ? hash : 'home';
    if (view === 'confirm' && !state.pending) view = 'home';
    if (view === 'result' && !state.result) view = 'home';
    state.view = view;
    render();
  }

  function render() {
    const app = $('#app');
    const views = {
      home: homeView,
      confirm: confirmView,
      result: resultView,
      terms: termsView,
      cases: casesView,
      sources: sourcesView,
      method: methodView
    };
    app.innerHTML = (views[state.view] || homeView)();
    $$('.nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.nav === state.view);
    });
    if (state.view === 'home') bindHome();
    if (state.view === 'confirm') bindConfirm();
    if (state.view === 'result') bindResult();
    if (state.view === 'terms') bindTerms();
    if (state.view === 'cases') bindCases();
    if (state.view === 'method') bindMethod();
    window.scrollTo(0, 0);
  }

  // ---------- data helpers ----------
  const getTerm = id => state.data.terms.find(t => t.id === id);
  const getCase = id => state.data.cases.find(c => c.id === id);

  function uniqueUrls(items) {
    const seen = new Set();
    return items.filter(item => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  // ---------- extraction ----------
  const PHENOMENA = [
    { key: '台风', words: ['台风', '热带气旋', '超强台风', '强台风', '登陆'] },
    { key: '暴雨', words: ['暴雨', '特大暴雨', '大暴雨', '降水', '雨量', '内涝', '降雨'] },
    { key: '高温', words: ['高温', '热浪', '最热', '酷热', '暑热'] },
    { key: '寒潮', words: ['寒潮', '极寒', '低温', '降温', '冰冻', '寒潮'] },
    { key: '干旱', words: ['干旱', '旱情', '特旱', '气象干旱'] },
    { key: '厄尔尼诺', words: ['厄尔尼诺', '拉尼娜', 'ENSO', '海温', 'ONI', 'Niño', 'Nino'] },
    { key: '海浪', words: ['海浪', '巨浪', '波高', '风暴潮', '海雾'] },
    { key: '大风', words: ['大风', '阵风', '极大风', '最大风', '风力'] }
  ];

  const LOCATIONS = [
    '北京', '上海', '天津', '重庆', '广东', '海南', '山东', '江苏', '浙江', '福建',
    '辽宁', '河北', '河南', '湖北', '湖南', '四川', '云南', '贵州', '广西', '江西',
    '安徽', '山西', '陕西', '甘肃', '青海', '宁夏', '新疆', '西藏', '内蒙古',
    '黑龙江', '吉林', '香港', '澳门', '台湾', '深圳', '广州', '海口', '三亚',
    '青岛', '厦门', '宁波', '温州', '湛江', '阳江', '阳春', '珠海', '文昌', '台山',
    '哈尔滨', '长春', '沈阳', '呼和浩特', '石家庄', '太原', '西安', '济南',
    '乌鲁木齐', '拉萨', '西宁', '兰州', '银川', '郑州', '南京', '武汉',
    '杭州', '合肥', '福州', '南昌', '长沙', '贵阳', '成都', '昆明', '南宁', '台北'
  ];

  const SEA_AREAS = ['西北太平洋', '南海', '东海', '黄海', '渤海', '赤道中东太平洋', '赤道太平洋', '西太平洋'];
  const WMO_STATIONS = {
    '北京': '54511', '天津': '54527', '上海': '58367', '重庆': '57516',
    '河北': '53698', '石家庄': '53698', '山西': '53772', '太原': '53772',
    '内蒙古': '53463', '呼和浩特': '53463', '辽宁': '54342', '沈阳': '54342',
    '吉林': '54161', '长春': '54161', '黑龙江': '50953', '哈尔滨': '50953',
    '江苏': '58238', '南京': '58238', '浙江': '58457', '杭州': '58457',
    '安徽': '58321', '合肥': '58321', '福建': '58847', '福州': '58847',
    '江西': '58606', '南昌': '58606', '山东': '54823', '济南': '54823',
    '河南': '57083', '郑州': '57083', '湖北': '57494', '武汉': '57494',
    '湖南': '57687', '长沙': '57687', '广东': '59287', '广州': '59287',
    '广西': '59431', '南宁': '59431', '海南': '59758', '海口': '59758',
    '四川': '56294', '成都': '56294', '贵州': '57816', '贵阳': '57816',
    '云南': '56778', '昆明': '56778', '西藏': '55591', '拉萨': '55591',
    '陕西': '57036', '西安': '57036', '甘肃': '52889', '兰州': '52889',
    '青海': '52866', '西宁': '52866', '宁夏': '53614', '银川': '53614',
    '新疆': '51463', '乌鲁木齐': '51463',
    '深圳': '59493', '珠海': '59488', '青岛': '54857', '厦门': '59134',
    '宁波': '58562', '温州': '58659', '三亚': '59948', '湛江': '59658',
    '阳江': '59663', '广东阳江': '59663', '阳春': '59663',
    '台山': '59478', '文昌': '59757', '香港': '45007', '澳门': '45011', '台北': '46692'
  };
  const QUICK_FACT_SETS = [
    {
      test: text => /顺昌/.test(text) && /暴雨/.test(text),
      date: '2026-06-15 08—06-16 08 · 福建南平顺昌',
      source: '顺昌县应急局 / 中国互联网联合辟谣平台',
      items: [
        { label: '实际降雨', value: '5.2 mm', sub: '24 小时累计' },
        { label: '城区最高水位', value: '115.62 m', sub: '未达警戒水位' },
        { label: '网传灾情', value: '不实', sub: '视频拼接，非本地' },
        { label: '原视频', value: '已下架', sub: '警方追查造谣者' }
      ]
    },
    {
      test: text => /广东/.test(text)
        && /(1000|1,000)\s*(毫米|mm)/i.test(text)
        && /(超级暴雨|龙王|全省雨量|扛下)/.test(text),
      date: '2026-05-20 · 广东阳江阳春',
      source: '中国网 / 央广网官方实况',
      items: [
        { label: '最大滑动 24h', value: '1058.5 mm', sub: '阳春河口镇下双站' },
        { label: '过程雨量', value: '1793 mm', sub: '同一轮过程' },
        { label: '超 1000mm 站', value: '10 个', sub: '阳江' },
        { label: '超 250mm 站', value: '97 个', sub: '阳江' },
        { label: '最大 12h', value: '741 mm', sub: '下双站' },
        { label: '纪录', value: '百年一遇', sub: '打破广东省多项纪录' }
      ]
    }
  ];

  const INPUT_PRESETS = [
    {
      test: text => /顺昌/.test(text) && /暴雨/.test(text),
      title: '福建顺昌“严重暴雨灾情”',
      subtitle: '网传视频称顺昌遭暴雨袭击、灾情紧急',
      input: '福建南平顺昌遭暴雨袭击',
      publish_time: '未提供（短视频平台）',
      event_time: '2026-06-15 08:00 至 2026-06-16 08:00',
      time_window: '24 小时（08—08）',
      time_scale: '24 小时',
      location: '福建顺昌（南平市）',
      location_level: '县（城区）',
      source_url: 'https://www.piyao.org.cn/20260618/4c1aaf3a6a644d778686e0572d8fac99/c.html',
      source_name: '短视频平台（官方辟谣）',
      claim_type: '观测 / 灾情声明',
      phenomenon: '暴雨',
      parameter: '24 小时降水量',
      value: '网传严重暴雨灾情',
      reference: '实际 5.2 mm',
      verdict: 'E',
      confidence: '高',
      summary: '这是假新闻。顺昌县应急局核查：2026 年 6 月 15 日 8 时至 16 日 8 时全县降雨总量只有 5.2 mm，城区最高水位 115.62 m，未达警戒水位；中国互联网联合辟谣平台通报：网传“暴雨灾情”视频系拼接非本地画面，涉事视频已下架，警方追查造谣者。辟谣平台提供的是通报文本，不提供原始雨量/水位数据表；5.2 mm、115.62 m 来自应急部门核查通报。',
      term_ids: ['extreme_rain'],
      loopholes: [
        { name: '实际雨量不支持', status: 'fail', note: '官方实测 24 小时仅 5.2 mm，远低于暴雨门槛（24h ≥50 mm），不可能形成网传严重洪涝。' },
        { name: '视频张冠李戴', status: 'fail', note: '视频系拼接画面，不是顺昌本地实景；不能用外地/旧视频证明本地灾情。' },
        { name: '水位/预警无依据', status: 'fail', note: '城区最高水位 115.62 m，未达警戒水位；没有本地暴雨红色预警或灾情通报。' },
        { name: '来源缺失', status: 'warn', note: '原帖没有可核验的账号、发布时间和视频 ID；官方已认定其为虚假信息。' }
      ],
      evidence: [
        {
          source: '中国互联网联合辟谣平台',
          date: '2026-06-18',
          data: '“福建南平顺昌遭遇严重暴雨灾情”不实；2026-06-15 08 至 06-16 08 降雨总量 5.2 mm，城区未达警戒水位；视频系拼接杜撰，已下架。',
          url: 'https://www.piyao.org.cn/20260618/4c1aaf3a6a644d778686e0572d8fac99/c.html'
        },
        {
          source: '顺昌县委网信办 / 大武夷新闻网',
          date: '2026-06-18',
          data: '顺昌县应急局实测：24 小时降雨 5.2 mm；城区最高水位 115.62 m，未到警戒水位；网传视频为拼接虚假画面。',
          url: 'https://www.greatwuyi.com/info/content/202606/18/c1588857.html'
        }
      ],
      conditions: [
        '若指 2026-06-15 08 至 06-16 08 顺昌本地降雨：实际 5.2 mm，网传严重暴雨灾情不成立。',
        '若视频来自外地/旧素材：不能作为顺昌本地灾情证据。',
        '若没有本地水位/预警/官方通报：不能证明“灾情紧急”。'
      ],
      next_steps: [
        '补原视频账号、发布时间和视频 ID；目前原视频已下架。',
        '核对顺昌县应急局/水文部门的原始雨量和水位记录。',
        '如需展示，使用官方辟谣文章中的关键帧，不使用二次搬运视频。'
      ]
    }
  ];

  const CHINA_WEATHER_CITIES = {
    '北京': '101010100', '上海': '101020100', '天津': '101030100', '重庆': '101040100',
    '河北': '101090101', '石家庄': '101090101', '山西': '101100101', '太原': '101100101',
    '内蒙古': '101080101', '呼和浩特': '101080101', '辽宁': '101070101', '沈阳': '101070101',
    '吉林': '101060101', '长春': '101060101', '黑龙江': '101050101', '哈尔滨': '101050101',
    '江苏': '101190101', '南京': '101190101', '浙江': '101210101', '杭州': '101210101',
    '安徽': '101220101', '合肥': '101220101', '福建': '101230101', '福州': '101230101',
    '江西': '101240101', '南昌': '101240101', '山东': '101120101', '济南': '101120101',
    '河南': '101180101', '郑州': '101180101', '湖北': '101200101', '武汉': '101200101',
    '湖南': '101250101', '长沙': '101250101', '广东': '101280101', '广州': '101280101',
    '广西': '101300101', '南宁': '101300101', '海南': '101310101', '海口': '101310101',
    '四川': '101270101', '成都': '101270101', '贵州': '101260101', '贵阳': '101260101',
    '云南': '101290101', '昆明': '101290101', '西藏': '101140101', '拉萨': '101140101',
    '陕西': '101110101', '西安': '101110101', '甘肃': '101160101', '兰州': '101160101',
    '青海': '101150101', '西宁': '101150101', '宁夏': '101170101', '银川': '101170101',
    '新疆': '101130101', '乌鲁木齐': '101130101',
    '深圳': '101280601', '珠海': '101280701', '青岛': '101120201', '厦门': '101230201',
    '宁波': '101210401', '温州': '101210701', '三亚': '101310201', '湛江': '101281001',
    '阳江': '101281801', '广东阳江': '101281801', '阳春': '101281801',
    '台山': '101281106', '文昌': '101310212', '香港': '101320101', '澳门': '101330101',
    '台北': '101340101'
  };
  const STATIONS = ['南郊观象台', '大兴敬贤家园', '黄土梁', '汤河口', '观象台', '朝阳站', '海淀站'];
  const VAGUE_WORDS = ['极大', '最大', '最强', '最严重', '特大', '超级', '史诗级', '毁灭性', '极端', '罕见', '百年一遇', '千年一遇', '破纪录', '史上', '同期', '连续', '短时', '大面积', '局地', '超强', '严重'];

  const PERIOD_QUALIFIERS = [
    { key: '非夏季', aliases: ['非夏季', '非夏天'], note: '6—8 月以外' },
    { key: '夏季', aliases: ['夏季', '夏天'], note: '6—8 月' },
    { key: '春季', aliases: ['春季', '春天'], note: '3—5 月' },
    { key: '秋季', aliases: ['秋季', '秋天'], note: '9—11 月' },
    { key: '冬季', aliases: ['冬季', '冬天'], note: '12—2 月' },
    { key: '非汛期', aliases: ['非汛期'], note: '当地官方汛期以外' },
    { key: '汛期', aliases: ['汛期'], note: '按当地官方汛期定义' },
    { key: '主汛期', aliases: ['主汛期'], note: '汛期内降水最集中时段，按当地定义' },
    { key: '前汛期', aliases: ['前汛期'], note: '华南等地区分段，按当地定义' },
    { key: '后汛期', aliases: ['后汛期'], note: '华南等地区分段，按当地定义' },
    { key: '非雨季', aliases: ['非雨季'], note: '当地雨季以外，按气候/业务定义' },
    { key: '雨季', aliases: ['雨季'], note: '按当地气候/业务定义' },
    { key: '旱季', aliases: ['旱季'], note: '按当地气候定义' },
    { key: '湿季', aliases: ['湿季'], note: '按当地气候定义' },
    { key: '台风季', aliases: ['台风季'], note: '按当地/官方定义' },
    { key: '非台风季', aliases: ['非台风季'], note: '当地台风季以外' },
    { key: '上半年', aliases: ['上半年', '前半年'], note: '1—6 月' },
    { key: '下半年', aliases: ['下半年', '后半年'], note: '7—12 月' },
    { key: '全年', aliases: ['全年', '年内'], note: '1—12 月' },
    { key: '年初', aliases: ['年初'], note: '需明确具体月份' },
    { key: '年中', aliases: ['年中'], note: '需明确具体月份' },
    { key: '年末', aliases: ['年末'], note: '需明确具体月份' },
    { key: '月初', aliases: ['月初'], note: '需明确具体日期范围' },
    { key: '月底', aliases: ['月底'], note: '需明确具体日期范围' },
    { key: '上旬', aliases: ['上旬'], note: '每月 1—10 日' },
    { key: '中旬', aliases: ['中旬'], note: '每月 11—20 日' },
    { key: '下旬', aliases: ['下旬'], note: '每月 21 日至月末' }
  ];

  function extractPeriodQualifiers(text) {
    const source = String(text || '');
    const matches = [];
    PERIOD_QUALIFIERS.forEach(item => {
      item.aliases.forEach(alias => {
        let index = source.indexOf(alias);
        while (index >= 0) {
          matches.push({ ...item, alias, index, end: index + alias.length });
          index = source.indexOf(alias, index + 1);
        }
      });
    });
    matches.sort((a, b) => a.index - b.index || b.end - a.end || b.alias.length - a.alias.length);
    const selected = [];
    let lastEnd = -1;
    matches.forEach(match => {
      if (match.index < lastEnd) return;
      if (!selected.some(item => item.key === match.key)) selected.push(match);
      lastEnd = match.end;
    });
    return selected.sort((a, b) => a.index - b.index);
  }

  function extract(text) {
    const sourceUrl = (text.match(/https?:\/\/[^\s，。；）)]+/) || [''])[0];
    const abs = text.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
    const rel = text.match(/(昨天|今天|明天|昨晚|今晨|前天|后天)/);
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(小时|h|天)/i);
    const month = text.match(/(\d{1,2})\s*月/);
    const forecast = /(预计|或|可能|将|前后|逼近|即将)/.test(text);

    let timeRaw = '未说明';
    if (abs) timeRaw = `${abs[1]}-${String(abs[2]).padStart(2, '0')}-${String(abs[3]).padStart(2, '0')}`;
    else if (rel) timeRaw = rel[1];
    else if (hours) timeRaw = hours[0];
    else if (month) timeRaw = month[0];

    let timeWindow = '未说明';
    const longHours = text.match(/(36|70)\s*小时/);
    if (/24\s*小时/.test(text)) timeWindow = '未说明（24h 窗口）';
    else if (/1\s*小时/.test(text)) timeWindow = '1 小时';
    else if (longHours) timeWindow = `${longHours[1]} 小时`;
    else if (/(过程|连续|累计)/.test(text)) timeWindow = '过程累计';

    let timeScale = '未说明';
    if (/(3\s*个月|三个月|ONI)/.test(text)) timeScale = '3 个月滑动';
    else if (/1\s*小时/.test(text)) timeScale = '1 小时';
    else if (/(24\s*小时|单日)/.test(text)) timeScale = '24 小时';
    else if (/3\s*秒/.test(text)) timeScale = '3 秒';
    else if (/候/.test(text)) timeScale = '候（5 天）';
    else if (/旬/.test(text)) timeScale = '旬（10 天）';
    else if (/月/.test(text)) timeScale = '月';
    else if (/季/.test(text)) timeScale = '季';

    let locationRaw = '未说明';
    let locationLevel = '未说明';
    const station = STATIONS.find(s => text.includes(s));
    const sea = SEA_AREAS.find(s => text.includes(s));
    const place = LOCATIONS.find(s => text.includes(s));
    if (station) { locationRaw = station; locationLevel = '站点'; }
    else if (sea) { locationRaw = sea; locationLevel = '海区'; }
    else if (place) { locationRaw = place; locationLevel = '省/市'; }
    if (/(全市|城区|全省|全境)/.test(text) && place) locationLevel = '省/市（区域平均）';

    const phenomenon = PHENOMENA.find(p => p.words.some(w => text.includes(w)))?.key || '未识别';

    const quantities = [];
    const qRe = /(\d+(?:\.\d+)?)\s*(mm|毫米|m\/s|米\/秒|℃|度|级|米|m)/gi;
    let qm;
    while ((qm = qRe.exec(text)) !== null) {
      const v = `${qm[1]} ${qm[2]}`;
      if (!quantities.includes(v)) quantities.push(v);
    }

    const vague = VAGUE_WORDS.filter(w => text.includes(w));
    const periodQualifiers = extractPeriodQualifiers(text);

    const hasObs = /(已|实况|观测|出现|达到|是|发生)/.test(text);
    const hasImpact = /(影响|持续到|导致|造成)/.test(text);
    let claimType = '观测/观点';
    if (forecast && (hasObs || hasImpact)) claimType = '混合（观测/预测/影响）';
    else if (forecast) claimType = '预测';
    else if (hasImpact) claimType = '影响';

    const terms = state.data.terms.filter(t => {
      const names = [t.term, ...(t.aliases || [])];
      return names.some(n => n && text.includes(n));
    });

    return {
      time_raw: timeRaw,
      time_window: timeWindow,
      time_scale: timeScale,
      location_raw: locationRaw,
      location_level: locationLevel,
      source_url: sourceUrl,
      phenomenon,
      quantities,
      vague,
      period_qualifiers: periodQualifiers,
      claim_type: claimType,
      terms,
      is_forecast: forecast
    };
  }

  function detectCase(text) {
    // 只有和示例原文几乎一致时才套用 curated 案例；否则用用户自己的时间/地点走通用规则。
    const norm = s => String(s || '').replace(/\s+/g, '').trim();
    for (const id of ['beijing_rain', 'elnino_2026']) {
      const c = getCase(id);
      if (c && norm(c.input) === norm(text)) return id;
    }
    return null;
  }

  function relativeTerm(text) {
    return (String(text || '').match(/(昨天|今天|明天|昨晚|今晨|前天|后天)/) || [])[1] || '';
  }

  function deriveRelativeEvent(claim, publish) {
    const rel = relativeTerm(claim);
    if (!rel) return null;
    const m = String(publish || '').match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const offset = { '昨天': -1, '今天': 0, '明天': 1, '昨晚': -1, '今晨': 0, '前天': -2, '后天': 2 }[rel];
    if (offset === undefined) return null;
    d.setDate(d.getDate() + offset);
    return fmtDateISO(d);
  }

  function caseMatchesMeta(c, meta) {
    const user = String(meta.event_time || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const fixed = String(c.event_time || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return !user || !fixed || user === fixed;
  }

  // ---------- checks ----------
  function runChecks(text, meta, ex) {
    const checks = [];
    const add = (id, name, status, note) => checks.push({ id, name, status, note });
    const hasTime = Boolean(meta.event_time && meta.event_time !== '未说明') || (ex.time_raw && ex.time_raw !== '未说明');
    const hasWindow = meta.time_window && meta.time_window !== '未说明';
    const hasScale = meta.time_scale && meta.time_scale !== '未说明';
    const hasLocation = Boolean(meta.location && meta.location !== '未说明') || (ex.location_raw && ex.location_raw !== '未说明');
    const hasSource = Boolean(meta.source_url) || Boolean(ex.source_url);

    const rainMatches = [...text.matchAll(/(\d{3,4}(?:\.\d+)?)\s*(mm|毫米)/gi)]
      .map(m => Number(m[1]))
      .filter(v => Number.isFinite(v));
    const maxRain = rainMatches.length ? Math.max(...rainMatches) : 0;

    add('subject', '主体/事件', ex.phenomenon !== '未识别' ? 'pass' : 'fail', ex.phenomenon !== '未识别' ? `识别为：${ex.phenomenon}` : '未识别天气现象，无法确定要查哪类数据。');
    add('term', '参数/术语', ex.terms.length ? 'pass' : 'warn', ex.terms.length ? `匹配到：${ex.terms.map(t => t.term).join('、')}` : '未匹配到标准术语，建议先查词库。');
    if (/(超级|史诗级|毁灭性)/.test(text)) {
      add('vague_intensity', '模糊强度词', 'fail', '“超级/史诗级/毁灭性”不是气象等级；降水等级只有暴雨、大暴雨、特大暴雨，必须换算成具体时段降水量。');
    }
    if (maxRain >= 1000) {
      const multiDay = /(过程|连续|累计|三天|3\s*天|一周|7\s*天)/.test(text);
      add('rainfall_extreme', '雨量极值合理性', multiDay ? 'warn' : 'fail',
        `${maxRain} mm 是特大暴雨阈值（250 mm）的 ${(maxRain / 250).toFixed(1)} 倍；${multiDay ? '即使按过程累计，也属于极端异常量级，必须给出站点、时段和官方来源。' : '若指 24 小时，已属极端异常量级，必须给出站点、时段和官方来源；仅凭“超级暴雨”不能成立。'}`);
      if (/(广东|全省|全市|全区|面平均|区域平均)/.test(text)) {
        add('rainfall_scope', '雨量范围', 'warn', '1000 mm 级降水通常是一个或少数站点的 24h 极值；必须说明是“某站”还是“全省/全市平均”，不能用单站极值代替全省，否则标题会以点代面。');
      }
    }
    if (/特大暴雨/.test(text)) {
      const oneHour = /1\s*小时/.test(text);
      add('term_consistency', '术语一致性', oneHour ? 'fail' : 'warn', oneHour ? '“特大暴雨”是 24 小时 ≥250 mm（12 小时 ≥140 mm），不能用 1 小时雨量套用；1 小时 100 mm 属于短时强降水。' : '“特大暴雨”必须说明 24 小时/12 小时口径，不能只写“特大”。');
    }
    if (/(17\s*级|17级)/.test(text) && /超强台风/.test(text)) {
      add('typhoon_consistency', '台风术语一致性', 'warn', '超强台风是 ≥51.0 m/s（16 级或以上），不等于 17 级；17 级是风力等级，还要注明 3 秒/1 分钟/2 分钟/10 分钟平均。');
    }
    if (/(极大|最大)/.test(text) && /(风速|风力|风)/.test(text)) {
      add('wind_consistency', '风速口径', 'warn', '极大风速是 3 秒平均；最大风速是 10 分钟平均；阵风是 3 秒峰值。三者不能互换。');
    }
    add('time', '时间尺度', hasTime && (hasWindow || hasScale) ? 'pass' : 'fail', hasTime && (hasWindow || hasScale) ? `时间：${meta.event_time || ex.time_raw}；窗口：${meta.time_window || ex.time_window}；尺度：${meta.time_scale || ex.time_scale}` : '缺时间窗口/尺度；不同尺度不能直接比较。');
    add('tense', '观测/预测/影响', meta.claim_type && meta.claim_type !== '未说明' ? (meta.claim_type.includes('混合') ? 'warn' : 'pass') : 'fail', meta.claim_type && meta.claim_type !== '未说明' ? `当前标为：${meta.claim_type}` : '未说明是观测、预测还是影响。');
    add('space', '空间尺度', hasLocation ? (meta.location_level && meta.location_level.includes('未说明') ? 'warn' : 'pass') : 'fail', hasLocation ? `地点：${meta.location || ex.location_raw}；级别：${meta.location_level || ex.location_level}` : '缺地点/站/区域。');
    add('reference', '比较基准', /(以来|史上|近\s*\d+\s*年|同期|破纪录)/.test(text) ? 'warn' : 'pass', /(以来|史上|近\s*\d+\s*年|同期|破纪录)/.test(text) ? '出现“史上/以来/同期”等比较，需要说明基准期、站网、资料年限。' : '未出现历史比较。');
    const periodQualifiers = ex.period_qualifiers || [];
    if (periodQualifiers.length) {
      const periodText = periodQualifiers.map(p => `${p.key}（${p.note}）`).join('、');
      add('period', '时段限定', 'warn', `识别到${periodText}；不同季节/汛期/雨季/半年口径不能互相替代，必须写清起止月份和基准期。`);
    }
    if (/(1959|史上|非夏季|非汛期|全市平均)/.test(text) && /(24\s*小时|单日)/.test(text)) {
      add('long_series', '历史序列', 'warn', '“1959 年以来全市平均 24h 最大”需要北京长期站网/插值序列；公开再分析单点不能证明或否定，需 CMA/北京市气象局序列。');
    }
    add('source', '来源地址', hasSource ? 'pass' : 'warn', hasSource ? '已提供来源链接或可追溯地址。' : '缺来源 URL/账号/发布时间；置信度会降低。');
    add('data', '指数/数据版本', ex.phenomenon === '厄尔尼诺' && !/(Niño|Nino|ONI|候|旬|月|季|3\s*个月)/.test(text) ? 'fail' : 'pass', ex.phenomenon === '厄尔尼诺' ? '厄尔尼诺必须说明指数（Niño1+2/3/3.4/4/ONI）与时间尺度。' : '未涉及 ENSO 指数。');
    add('uncertainty', '不确定性', ex.is_forecast && (meta.claim_type || '').includes('观测') ? 'fail' : (ex.is_forecast ? 'warn' : 'pass'), ex.is_forecast ? '出现“预计/或/可能/将/前后”，应标为预测，不能当已发生。' : '未出现明显预测词。');
    add('compare', '比较是否成立', /(最强|最大|最严重|史上|破纪录|百年一遇)/.test(text) && !ex.terms.length ? 'fail' : 'warn', '比较必须同指标、同时段、同范围、同基准；否则“最强”没有意义。');
    add('causal', '因果', /(导致|造成|因为|由于)/.test(text) ? 'warn' : 'pass', /(导致|造成|因为|由于)/.test(text) ? '出现因果表述；相关不等于因果，需要额外证据。' : '未出现明显因果表述。');
    add('probability', '概率/重现期', /百年一遇/.test(text) ? 'warn' : 'pass', /百年一遇/.test(text) ? '百年一遇 = 年超越概率 1%，不是“一百年只发生一次”。' : '未出现重现期表述。');
    add('visual', '标题/视觉', /(最强|震撼|末日|恐怖|正在逼近)/.test(text) ? 'warn' : 'pass', /(最强|震撼|末日|恐怖|正在逼近)/.test(text) ? '标题/配图可能放大情绪；视觉强度不等于证据强度。' : '未出现明显情绪化词。');
    const emotionWords = ['惹了龙王', '龙王', '天漏了', '雨弹', '倒水', '狂暴', '肆虐'];
    const emotions = emotionWords.filter(word => text.includes(word));
    if (emotions.length) {
      add('emotion', '情绪化/拟人化', 'warn', `识别到“${emotions.join('、')}”；这是修辞/拟人化表达，不是气象机制或等级，不能替代站点、时段和雨量数据。`);
    }
    add('official', '官方证据', 'warn', '官方入口已列出；系统会自动拉取可公开的数据源；CMA 站点档案需账号/权限，不能用再分析冒充官方观测。');

    return checks;
  }

  function decideVerdict(text, meta, ex, checks) {
    if (/超级暴雨|超级大暴雨/.test(text)) return 'C';
    if (/特大暴雨/.test(text) && /1\s*小时/.test(text)) return 'C';
    const rainfallCheck = checks.find(c => c.id === 'rainfall_extreme');
    if (rainfallCheck && rainfallCheck.status === 'fail') return 'D';
    if (/百年一遇/.test(text)) return 'B';
    if (/(极大|最大)/.test(text) && /(风速|风力|风)/.test(text)) return 'B';
    if (/(17\s*级|17级)/.test(text) && /超强台风/.test(text)) return 'B';
    if (ex.phenomenon === '厄尔尼诺' && !/(Niño|Nino|ONI|候|旬|月|季|3\s*个月)/.test(text)) return 'D';

    const failIds = checks.filter(c => c.status === 'fail').map(c => c.id);
    if (failIds.includes('term')) return 'C';
    if (failIds.includes('time') || failIds.includes('space') || failIds.includes('tense') || failIds.includes('data')) return 'D';
    if (failIds.includes('subject')) return 'D';
    if (ex.terms.length) return 'B';
    return 'D';
  }

  function buildSummary(verdict, ex, meta, checks = [], text = '') {
    if (verdict === 'C') {
      if (/超级暴雨/.test(text) && /(1000|1,000)\s*(mm|毫米)/i.test(text)) {
        return '这不是假新闻：核心降水数值可能有官方实况支撑；但“广东1000毫米”若省略“某站”，标题就以点代面，容易让人误以为整个广东都下了1000毫米。同时“超级暴雨”不是标准术语；“惹了龙王”是拟人化修辞，不是气象机制，必须区分单站极值与全省平均。';
      }
      const specific = checks.filter(c => c.status !== 'pass' && ['term_consistency', 'vague_intensity', 'rainfall_extreme'].includes(c.id));
      if (specific.length) return `术语/量级冲突：${specific.map(c => c.note).join('；')}`;
      return '这句话存在术语/口径冲突：同一个词在不同标准下不是同一个量，不能直接下结论。';
    }
    if (verdict === 'D') return '关键信息不足：时间、地点、指数或口径缺失。系统不猜，先判“信息不足”。';
    if (verdict === 'B') {
      if (checks.some(c => c.id === 'long_series')) {
        return '术语基本对得上，但“1959 年以来全市平均最大”需要北京长期站网/插值序列；当前只有公开再分析点，不能证明或否定。需补 24h 窗口、站网和官方序列。';
      }
      return '术语基本对得上，但结论依赖口径。需要补时间窗口、站/区域、基准期和官方数据。';
    }
    return '在给定口径下，暂未发现术语冲突；仍需官方数据核验。';
  }

  function buildConditions(ex, meta) {
    const list = [];
    if (ex.terms.some(t => t.id === 'extreme_wind' || t.id === 'max_wind' || t.id === 'gust')) {
      list.push('“极大风速”是 3 秒平均，“最大风速”是 10 分钟平均；必须先说明是哪一个。');
    }
    if (ex.terms.some(t => t.id === 'wind_force')) {
      list.push('17 级 = 56.1–61.2 m/s（10 分钟平均）；若用 1 分钟/2 分钟平均，不能直接套用。');
    }
    if (ex.terms.some(t => t.id === 'super_typhoon')) {
      list.push('超强台风是 ≥51.0 m/s（16 级或以上），不等于“17 级”；还要区分巅峰与登陆。');
    }
    if (ex.terms.some(t => t.id === 'extreme_rain')) {
      list.push('特大暴雨是 24 小时 ≥250 mm（12 小时 ≥140 mm）；1 小时雨量不能套这个等级。');
    }
    if (ex.terms.some(t => t.id === 'return_period')) {
      list.push('百年一遇 = 年超越概率 1%，不是“一百年只发生一次”；要说明变量、区域、资料年限。');
    }
    if (ex.terms.some(t => t.id === 'oni' || t.id === 'super_elnino')) {
      list.push('厄尔尼诺必须说明指数（Niño1+2/3/3.4/4/ONI）和时间尺度（候/旬/月/3 个月滑动）。');
      list.push('3.2—3.5℃ 若是预测峰值，就不能写成“已破 3.2”。');
    }
    if (ex.time_raw === '未说明' || (meta.time_window || '') === '未说明') {
      list.push('补时间窗口：08—08、20—20、自然日，还是滑动 24h。');
    }
    if ((ex.period_qualifiers || []).length) {
      list.push(`把时段限定落到明确起止月份：${ex.period_qualifiers.map(p => `${p.key}（${p.note}）`).join('、')}；非夏季、非汛期、非雨季不能互相替代。`);
    }
    if (!meta.location || meta.location === '未说明') {
      list.push('补地点：单站、全市平均、城区，还是某个站号。');
    }
    if (!list.length) list.push('补官方来源与数据版本，再判断是否成立。');
    return list;
  }

  function suggestSources(ex) {
    const namesByPhenomenon = {
      '台风': ['中央气象台台风网', 'CMA 热带气旋资料中心', 'NOAA NCEI / IBTrACS'],
      '暴雨': ['中国气象局', '中国气象数据网', '中央气象台'],
      '高温': ['中国气象局', '中国气象数据网'],
      '寒潮': ['中国气象局', '中国气象数据网'],
      '干旱': ['中国气象局', '水利部'],
      '厄尔尼诺': ['NOAA CPC', '国家气候中心', '中国气象局'],
      '海浪': ['国家海洋环境预报中心', '自然资源部'],
      '大风': ['中央气象台', '中国气象数据网']
    };
    const names = namesByPhenomenon[ex.phenomenon] || ['中国气象局', '中央气象台', '国家气候中心'];
    const items = names.map(name => {
      const s = state.data.sources.find(x => x.name === name);
      return s ? {
        source: s.name,
        date: '待核验',
        data: '官方核验入口；可在下方“实时核验”拉取 ONI/天气；CMA 站点数据需在官网查询。',
        url: s.url
      } : null;
    }).filter(Boolean);

    ex.terms.forEach(t => {
      if (t.url) items.push({
        source: t.standard,
        date: '标准',
        data: t.definition,
        url: t.url
      });
    });
    return items;
  }

  function buildGenericResult(text, meta) {
    const ex = extract(text);
    const checks = runChecks(text, meta, ex);
    const verdict = decideVerdict(text, meta, ex, checks);
    const confidence = verdict === 'B' ? '中' : (verdict === 'C' ? '中' : '低');
    const nextSteps = [];
    if (!meta.publish_time) nextSteps.push('补发布时间；“昨天/今天/明天”要锚定到发布日。');
    if ((meta.time_window || '未说明') === '未说明') nextSteps.push('补时间窗口（08—08 / 20—20 / 自然日 / 滑动 24h）。');
    if ((meta.time_scale || '未说明') === '未说明') nextSteps.push('补时间尺度（3 秒 / 1 分钟 / 2 分钟 / 10 分钟 / 1 小时 / 24 小时 / 候 / 旬 / 月 / 季 / ONI）。');
    if (!meta.location || meta.location === '未说明') nextSteps.push('补地点（省/市/区县/站点/经纬度/海区）。');
    if (!meta.source_url) nextSteps.push('补来源 URL/账号；没有来源就标“来源不明”。');
    if (ex.phenomenon === '厄尔尼诺') nextSteps.push('补指数（Niño1+2/3/3.4/4/ONI）与数据集/基准期。');
    if ((ex.period_qualifiers || []).length) {
      nextSteps.push('补时段限定的起止月份/业务定义（非夏季、汛期、雨季、上半年等不能互换）。');
    }
    if (/(1959|史上|非夏季|非汛期|全市平均)/.test(text) && /(24\s*小时|单日)/.test(text)) {
      nextSteps.push('补北京 1959—2026 年全市平均 24h 序列（站网、插值方法、08—08/20—20/滑动窗口）。');
    }

    return {
      title: `判据结果：${ex.phenomenon === '未识别' ? '待归类' : ex.phenomenon}`,
      subtitle: ex.terms.length ? ex.terms.map(t => t.term).join(' / ') : '未匹配到标准术语',
      claim: text,
      caseId: null,
      meta,
      decomposition: [
        ['现象', ex.phenomenon],
        ['参数', ex.terms.length ? ex.terms.map(t => t.term).join('、') : '未匹配'],
        ['数值', ex.quantities.length ? ex.quantities.join('；') : '未给出'],
        ['模糊词', ex.vague.length ? ex.vague.join('、') : '未识别'],
        ['时间', ex.time_raw],
        ['时段限定', ex.period_qualifiers.length ? ex.period_qualifiers.map(p => `${p.key}（${p.note}）`).join('、') : '未说明'],
        ['窗口', meta.time_window || ex.time_window],
        ['尺度', meta.time_scale || ex.time_scale],
        ['空间', meta.location || ex.location_raw],
        ['级别', meta.location_level || ex.location_level],
        ['来源', meta.source_url || ex.source_url || '未提供'],
        ['确定性', meta.claim_type || ex.claim_type]
      ],
      loopholes: checks,
      terms: ex.terms,
      verdict,
      confidence,
      summary: buildSummary(verdict, ex, meta, checks, text),
      conditions: buildConditions(ex, meta),
      evidence: suggestSources(ex),
      next_steps: nextSteps.length ? nextSteps : ['补官方数据后再判断。'],
      official_urls: []
    };
  }

  function buildCaseResult(c, meta, text) {
    const mergedMeta = {
      publish_time: meta.publish_time || c.publish_time,
      event_time: meta.event_time || c.event_time,
      time_window: meta.time_window || c.time_window,
      time_scale: meta.time_scale || c.time_scale,
      location: meta.location || c.location,
      location_level: meta.location_level || c.location_level,
      source_url: meta.source_url || c.source_url,
      claim_type: meta.claim_type || c.claim_type
    };
    const terms = (c.term_ids || []).map(getTerm).filter(Boolean);
    const periodQualifiers = extractPeriodQualifiers(text || c.input);
    const periodText = periodQualifiers.map(p => `${p.key}（${p.note}）`).join('、');
    const periodCheck = periodQualifiers.length ? [{
      id: 'period',
      name: '时段限定',
      status: 'warn',
      note: `识别到${periodText}；不同季节/汛期/雨季/半年口径不能互相替代，必须写清起止月份和基准期。`
    }] : [];
    return {
      title: c.title,
      subtitle: c.subtitle,
      claim: text || c.input,
      caseId: c.id,
      meta: mergedMeta,
      decomposition: [
        ['现象', c.phenomenon],
        ['参数', c.parameter],
        ['数值', c.value],
        ['时间', mergedMeta.event_time || c.event_time],
        ['时段限定', periodQualifiers.length ? periodQualifiers.map(p => `${p.key}（${p.note}）`).join('、') : '未说明'],
        ['窗口', mergedMeta.time_window],
        ['尺度', mergedMeta.time_scale],
        ['空间', mergedMeta.location],
        ['级别', mergedMeta.location_level],
        ['来源', mergedMeta.source_url || c.source_name],
        ['确定性', mergedMeta.claim_type]
      ],
      loopholes: [...periodCheck, ...c.loopholes],
      terms,
      verdict: c.verdict,
      confidence: c.confidence,
      summary: c.summary,
      conditions: c.conditions,
      evidence: c.evidence,
      next_steps: c.next_steps,
      official_urls: []
    };
  }

  function buildPresetResult(preset, meta, text) {
    const result = buildCaseResult({ ...preset, id: null }, meta, text);
    return { ...result, caseId: null };
  }

  function analyze(text, meta, caseId, preset = null) {
    if (caseId) {
      const c = getCase(caseId);
      if (c && caseMatchesMeta(c, meta)) return buildCaseResult(c, meta, text);
    }
    if (preset) return buildPresetResult(preset, meta, text);
    return buildGenericResult(text, meta);
  }

  // ---------- home ----------
  function homeView() {
    return `
      <section class="hero" data-edit-id="hero">
        <div class="hero-grid">
          <div data-edit-id="hero-copy">
            <div class="eyebrow">AI + 信息素养 · 气象海洋</div>
            <h1><em>“史上最强！”？</em><br>气象说法真实吗？</h1>
            <p class="hero-lede">
              输入一句天气说法，先找逻辑漏洞，再把模糊词翻译成标准参数，
              最后拉取官方数据回答：<strong>在什么条件下成立，在什么条件下不成立。</strong>
            </p>
            <div class="hero-stats">
              <div class="hero-stat"><strong>19</strong><span>项逻辑漏洞检查</span></div>
              <div class="hero-stat"><strong>23</strong><span>张术语判据卡</span></div>
              <div class="hero-stat"><strong>A–E</strong><span>五级判定</span></div>
            </div>
          </div>
          <div class="input-card" id="input-card" data-edit-id="input-card">
            <label class="field-label" for="claim-input">粘贴原文 / 输入关键词</label>
            <textarea id="claim-input" class="claim-input" placeholder="例：北京昨天的暴雨是史上非夏季最大的一场雨，24 小时全市平均最大……&#10;&#10;也可以只输入：极大风、特大暴雨、百年一遇、强超强厄尔尼诺。"></textarea>
            <div class="sample-row">
              <button class="chip hot" data-sample="beijing">北京“最大暴雨”</button>
              <button class="chip hot" data-sample="elnino">“最强超强厄尔尼诺”</button>
              <button class="chip" data-sample="wind">17 级超强台风</button>
              <button class="chip" data-sample="rain">1 小时 100 mm“特大暴雨”</button>
              <button class="chip" data-sample="return">百年一遇</button>
              <button class="chip" data-sample="max">极大 vs 最大</button>
            </div>
            <div class="input-actions">
              <label class="upload-btn">
                ＋ 上传图片
                <input type="file" id="image-input" accept="image/*" />
              </label>
              <button class="btn btn-ghost btn-sm" id="paste-image-btn" type="button">从剪贴板粘贴</button>
              <button class="btn btn-primary" id="analyze-btn">开始判据 →</button>
            </div>
            <div id="image-preview" class="image-preview"></div>
            <p class="image-note">支持 Ctrl+V 粘贴、拖拽图片，或选择文件；会自动识别图中文字并填入输入框，识别结果可修改。</p>
          </div>
        </div>
      </section>

      <section class="matrix" data-edit-id="matrix">
        <div class="matrix-card" data-edit-id="matrix-card">
          <div class="section-kicker">真真假假，假假真真</div>
          <h3 class="section-title">真假 × 模糊词</h3>
          <p class="section-sub">极端词汇、夸张模糊，不一定假<br>数据背书、官方引据，并非全真</p>
          <div class="matrix-grid">
            <div class="matrix-cell warn" data-edit-id="matrix-cell-1">
              <h4><span class="dot"></span>可信</h4>
              <p>口径完整、证据支持，判定为可信。<br>例：官方最佳路径/同口径数据</p>
            </div>
            <div class="matrix-cell gray" data-edit-id="matrix-cell-2">
              <h4><span class="dot"></span>待核</h4>
              <p>说得精确、无数据作证，判定为待核。<br>例：北京 24h 全市平均序列</p>
            </div>
            <div class="matrix-cell good" data-edit-id="matrix-cell-3">
              <h4><span class="dot"></span>误读</h4>
              <p>数据真实，但被模糊夸大，判定为误读。<br>例：厄尔尼诺候尺度 3℃ 当成月值</p>
            </div>
            <div class="matrix-cell bad" data-edit-id="matrix-cell-4">
              <h4><span class="dot"></span>虚假</h4>
              <p>既没口径，也没证据，判定为虚假。<br>例：单说“史上最强”</p>
            </div>
          </div>
          <p class="matrix-legend">横轴：口径完整度；纵轴：证据支持度。</p>
        </div>
        <div class="features" data-edit-id="features">
          <div class="feature-card" data-edit-id="feature-1">
            <div class="feature-icon">01</div>
            <h4>Step1 定位时间/地点</h4>
            <p>判断时间、地点是否准确描述。“昨天”锚定发布时间，“北京”需明确是全市平均、南郊观象台，还是大兴敬贤家园。</p>
          </div>
          <div class="feature-card" data-edit-id="feature-2">
            <div class="feature-icon">02</div>
            <h4>Step2 模糊词分析</h4>
            <p>自动提取话语模糊词与夸张词，根据气象知识验证。“极大” ≠ “最大”，“17 级台风” ≠ “超强台风”。</p>
          </div>
          <div class="feature-card" data-edit-id="feature-3">
            <div class="feature-icon">03</div>
            <h4>Step3 官网数据作证</h4>
            <p>根据官方网址、访问日期、数据口径进行查询。从 A 到 E 进行打分判定，得出结论。</p>
          </div>
        </div>
      </section>

      <section class="section" data-edit-id="cases">
        <div class="section-head" data-edit-id="cases-head">
          <div>
            <div class="section-kicker">真实案例</div>
            <h2>“真—假”二字不能全面概括</h2>
            <p>取例来源于社交媒体（小红书）</p>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/cases">查看案例库 →</a>
        </div>
        <div class="case-grid">
          ${state.data.cases.map(c => caseCard(c)).join('')}
        </div>
      </section>
    `;
  }

  function caseCard(c) {
    return `
      <article class="case-card" data-edit-id="case-${escapeHTML(c.id)}">
        <div class="case-tag">${escapeHTML(c.tag)}</div>
        <h3>${escapeHTML(c.title)}</h3>
        <p class="case-sub">${escapeHTML(c.subtitle)}</p>
        <p class="case-summary">${escapeHTML(c.summary)}</p>
        <div class="case-footer">
          <span class="tag">判定 ${escapeHTML(c.verdict)} · 置信度 ${escapeHTML(c.confidence)}</span>
          <button class="btn btn-soft btn-sm" data-case="${escapeHTML(c.id)}">查看完整判据 →</button>
        </div>
      </article>`;
  }

  function bindHome() {
    const input = $('#claim-input');
    const preview = $('#image-preview');

    $$('[data-sample]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sample;
        const samples = {
          beijing: { text: getCase('beijing_rain')?.input || '', caseId: 'beijing_rain' },
          elnino: { text: getCase('elnino_2026')?.input || '', caseId: 'elnino_2026' },
          wind: { text: '这次台风极大风力达到 17 级，是超强台风登陆。', caseId: null },
          rain: { text: '特大暴雨来了，1 小时下了 100 毫米。', caseId: null },
          return: { text: '这是百年一遇的暴雨。', caseId: null },
          max: { text: '气象台说极大风速 30 米每秒，最大风速 25 米每秒。', caseId: null }
        };
        const s = samples[key];
        if (!s) return;
        input.value = s.text;
        state.sampleCase = s.caseId;
        input.focus();
        showToast(s.caseId ? '已填入案例，点击“开始判据”' : '已填入示例，点击“开始判据”');
      });
    });

    input.addEventListener('input', () => {
      if (state.sampleCase) {
        const c = getCase(state.sampleCase);
        if (!c || input.value.trim() !== c.input.trim()) state.sampleCase = null;
      }
    });

    $('#analyze-btn')?.addEventListener('click', startAnalysis);

    const prepareImageForOcr = async (file) => {
      try {
        const bitmap = await createImageBitmap(file);
        const maxSide = 3200;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) return blob;
      } catch (err) {
        // Fall back to the original file; the backend will report unsupported types.
      }
      return file;
    };

    const setOcrStatus = (kind, html) => {
      const el = $('#ocr-status');
      if (!el) return;
      el.className = `ocr-status ${kind}`;
      el.innerHTML = html;
    };

    const runOcr = async (file) => {
      const area = $('#ocr-text');
      const note = $('#ocr-note');
      const useBtn = $('#use-ocr');
      const retryBtn = $('#retry-ocr');
      if (!area) return;
      area.disabled = true;
      area.value = '';
      if (useBtn) useBtn.disabled = true;
      if (retryBtn) retryBtn.disabled = true;
      setOcrStatus('loading', '<span class="spinner"></span> 正在识别图片文字…');
      if (note) note.textContent = '本地 OCR，不上传云端；通常 1–3 秒。';
      try {
        const blob = await prepareImageForOcr(file);
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'image/png' },
          body: blob,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ok) {
          throw new Error(payload.error || `OCR 服务返回 ${res.status}`);
        }
        const data = payload.data || {};
        const text = String(data.text || '').trim();
        area.disabled = false;
        area.value = text;
        if (useBtn) useBtn.disabled = !text;
        if (retryBtn) retryBtn.disabled = false;
        state.ocrText = text;
        state.ocrDone = true;
        if (!text) {
          setOcrStatus('warn', '未识别到文字');
          if (note) note.textContent = '可以换一张更清晰、文字更大的截图，或在下方手动补充。';
          showToast('没有识别到文字；请换清晰截图或手动输入');
          return;
        }
        input.value = text;
        state.sampleCase = null;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const seconds = data.duration_ms ? ` · ${(data.duration_ms / 1000).toFixed(1)}s` : '';
        setOcrStatus('ok', `识别完成 · ${data.chars || text.length} 字${seconds}`);
        if (note) note.textContent = data.note || '识别结果可直接修改；确认后点“开始判据”。';
        showToast('已识别图片文字，可直接点“开始判据”');
        input.focus();
      } catch (err) {
        area.disabled = false;
        if (retryBtn) retryBtn.disabled = false;
        if (useBtn) useBtn.disabled = true;
        setOcrStatus('bad', '识别失败');
        if (note) note.textContent = `OCR 失败：${err.message}。请确认后端 8766 已启动，或手动输入。`;
        showToast(`OCR 失败：${err.message}`);
      }
    };

    const showImage = (file, source = 'upload') => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        showToast('请上传或粘贴图片文件');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        showToast('图片超过 8MB，建议压缩后再试');
      }
      const sourceLabel = {
        paste: '已粘贴',
        drop: '已拖入',
        clipboard: '已从剪贴板读取',
        upload: '已选择'
      }[source] || '已载入';
      const reader = new FileReader();
      reader.onload = () => {
        state.imageFile = { name: file.name, size: file.size, type: file.type, source };
        state.ocrText = '';
        state.ocrDone = false;
        preview.classList.add('show');
        preview.innerHTML = `
          <img src="${reader.result}" alt="图片预览" />
          <div class="image-meta">${escapeHTML(sourceLabel)} · ${escapeHTML(file.name || 'image')} · ${Math.round(file.size / 1024)} KB</div>
          <div class="ocr-panel" id="ocr-panel">
            <div class="ocr-status loading" id="ocr-status" aria-live="polite"><span class="spinner"></span> 正在识别图片文字…</div>
            <textarea class="ocr-text" id="ocr-text" placeholder="识别结果会出现在这里，可直接修改" disabled></textarea>
            <div class="ocr-actions">
              <button class="btn btn-primary btn-sm" id="use-ocr" type="button" disabled>用识别文字判定</button>
              <button class="btn btn-ghost btn-sm" id="retry-ocr" type="button" disabled>重新识别</button>
              <button class="btn btn-ghost btn-sm" id="remove-image" type="button">移除图片</button>
            </div>
            <p class="image-note" id="ocr-note">本地 OCR，不上传云端；识别后可修改再判定。</p>
          </div>`;
        preview.querySelector('#remove-image')?.addEventListener('click', () => {
          state.imageFile = null;
          state.ocrText = '';
          state.ocrDone = false;
          preview.classList.remove('show');
          preview.innerHTML = '';
        });
        preview.querySelector('#retry-ocr')?.addEventListener('click', () => runOcr(file));
        preview.querySelector('#use-ocr')?.addEventListener('click', () => {
          const text = ($('#ocr-text')?.value || '').trim();
          if (!text) {
            showToast('识别文字为空，请先重试或手动输入');
            return;
          }
          input.value = text;
          state.sampleCase = null;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          startAnalysis();
        });
        preview.querySelector('#ocr-text')?.addEventListener('input', (e) => {
          input.value = e.target.value;
          state.sampleCase = null;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const useBtn = $('#use-ocr');
          if (useBtn) useBtn.disabled = !e.target.value.trim();
        });
        runOcr(file);
        showToast(source === 'paste' ? '图片已粘贴，正在识别文字…' : '图片已载入，正在识别文字…');
      };
      reader.readAsDataURL(file);
    };
    state.showImage = showImage;

    $('#image-input')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) showImage(file, 'upload');
    });

    $('#paste-image-btn')?.addEventListener('click', async () => {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        showToast('浏览器不支持剪贴板读取，请用 Ctrl+V');
        return;
      }
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = (item.types || []).find(t => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1] || 'png';
            showImage(new File([blob], `clipboard.${ext}`, { type }), 'clipboard');
            return;
          }
        }
        showToast('剪贴板里没有图片');
      } catch (err) {
        showToast('无法读取剪贴板，请用 Ctrl+V');
      }
    });

    const card = $('#input-card');
    if (card) {
      ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      }));
      ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
      }));
      card.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) showImage(file, 'drop');
      });
    }

    $$('[data-case]').forEach(btn => {
      btn.addEventListener('click', () => openCase(btn.dataset.case));
    });
  }

  function startAnalysis() {
    const input = $('#claim-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) {
      showToast(state.imageFile ? '图片已载入：正在识别文字，请稍候；若识别失败，可在识别框中修改' : '先输入一句话，或点一个示例');
      input.focus();
      return;
    }
    // Only explicit sample/case selection uses curated case evidence; manually
    // typed text follows the user's own event date and optional input preset.
    const caseId = state.sampleCase || null;
    const preset = caseId ? null : (INPUT_PRESETS.find(item => item.test(text)) || null);
    state.pending = { text, caseId, preset, extracted: extract(text) };
    location.hash = '#/confirm';
  }

  function openCase(id) {
    const c = getCase(id);
    if (!c) return;
    state.pending = { text: c.input, caseId: c.id, extracted: extract(c.input) };
    state.sampleCase = c.id;
    location.hash = '#/confirm';
  }

  // ---------- confirm ----------
  function confirmView() {
    const p = state.pending;
    if (!p) return homeView();
    const c = p.caseId ? getCase(p.caseId) : null;
    const preset = p.preset || null;
    const ex = p.extracted;
    const rel = relativeTerm(p.text);
    const absInClaim = (p.text.match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/) || [])[0] || '';
    const v = {
      publish_time: c ? c.publish_time : (preset?.publish_time || (rel && absInClaim ? absInClaim : '')),
      event_time: c ? c.event_time : (preset?.event_time || (rel ? '' : (ex.time_raw !== '未说明' ? ex.time_raw : ''))),
      time_window: c ? c.time_window : (preset?.time_window || ex.time_window),
      time_scale: c ? c.time_scale : (preset?.time_scale || ex.time_scale),
      location: c ? c.location : (preset?.location || ex.location_raw),
      location_level: c ? c.location_level : (preset?.location_level || ex.location_level),
      source_url: c ? c.source_url : (preset?.source_url || ex.source_url),
      claim_type: c ? c.claim_type : (preset?.claim_type || ex.claim_type)
    };

    return `
      <section class="section" style="margin-top:24px">
        <div class="section-head">
          <div>
            <div class="section-kicker">第一步 · 输入确认</div>
            <h2>先把时间和地址锁死</h2>
            <p>“昨天”锚定发布时间；“北京”要追问是全市平均还是某个站。缺一项，系统会判 D。</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="back-home">← 返回修改</button>
        </div>

        <div class="panel">
          <div class="claim-preview">${escapeHTML(p.text)}</div>

          <div class="divider"></div>

          <form id="confirm-form">
            <div class="form-grid">
              <div class="field">
                <label for="f-publish">发布时间（相对时间的锚点）</label>
                <input id="f-publish" type="text" value="${escapeHTML(v.publish_time)}" placeholder="例：2025-10-10 17:04" />
                <span class="hint">截图状态栏时间只是截图时间，不是发布时间。</span>
              </div>
              <div class="field">
                <label for="f-event">事件时间</label>
                <input id="f-event" type="text" value="${escapeHTML(v.event_time)}" placeholder="${rel ? '填发布时间后自动算，如 2026-10-17' : '例：2025-10-08 04:00 至 2025-10-11 05:00'}" />
                ${rel ? `<span class="hint">这句话含“${escapeHTML(rel)}”，事件时间会按发布时间自动换算；也可以直接填事件时间。</span>` : ''}
              </div>
              <div class="field">
                <label for="f-window">时间窗口</label>
                <select id="f-window">
                  ${option(['未说明', '08—08', '20—20', '自然日', '滑动 24h', '过程累计', '1 小时'], v.time_window)}
                </select>
              </div>
              <div class="field">
                <label for="f-scale">时间尺度</label>
                <select id="f-scale">
                  ${option(['未说明', '3 秒', '1 分钟', '2 分钟', '10 分钟', '1 小时', '24 小时', '候（5 天）', '旬（10 天）', '月', '季', '3 个月滑动'], v.time_scale)}
                </select>
              </div>
              <div class="field">
                <label for="f-location">地点 / 区域</label>
                <input id="f-location" type="text" value="${escapeHTML(v.location)}" placeholder="例：北京市（全市平均）" />
              </div>
              <div class="field">
                <label for="f-level">地点级别</label>
                <select id="f-level">
                  ${option(['未说明', '国家/海区', '省/市', '省/市（区域平均）', '区县', '站点', '坐标'], v.location_level)}
                </select>
              </div>
              <div class="field">
                <label for="f-source">来源地址（URL / 账号）</label>
                <input id="f-source" type="text" value="${escapeHTML(v.source_url)}" placeholder="https://..." />
                <span class="hint">没有 URL 就写账号名；两者都没有会降低置信度。</span>
              </div>
              <div class="field">
                <label for="f-type">句子类型</label>
                <select id="f-type">
                  ${option(['未说明', '观测/观点', '预测', '影响', '混合（观测/预测/影响）'], v.claim_type)}
                </select>
              </div>
            </div>

            <div class="notice info" style="margin-top:16px">
              相对时间（昨天/今天/明天）必须锚定发布时间；否则系统不会把它当成今天。
            </div>

            <div class="actions" style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap">
              <button type="submit" class="btn btn-primary">确认并分析 →</button>
              <button type="button" class="btn btn-ghost" id="back-home-2">返回修改</button>
            </div>
          </form>
        </div>
      </section>`;
  }

  function option(values, selected) {
    const list = [...values];
    if (selected && !list.includes(String(selected))) list.push(String(selected));
    return list.map(v => `<option value="${escapeHTML(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('');
  }

  function bindConfirm() {
    const back = () => { location.hash = '#/home'; };
    const p = state.pending;
    const publishInput = $('#f-publish');
    const eventInput = $('#f-event');
    const initialPublish = publishInput?.value || '';
    const rel = relativeTerm(p?.text || '');
    $('#back-home')?.addEventListener('click', back);
    $('#back-home-2')?.addEventListener('click', back);

    const syncRelative = () => {
      if (!rel || !publishInput || !eventInput) return;
      const derived = deriveRelativeEvent(p.text, publishInput.value);
      if (derived && (!p?.caseId || publishInput.value.trim() !== initialPublish.trim())) {
        eventInput.value = derived;
      }
    };
    publishInput?.addEventListener('input', syncRelative);
    publishInput?.addEventListener('change', syncRelative);

    $('#confirm-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      let publish = $('#f-publish').value.trim();
      let eventTime = $('#f-event').value.trim();
      const derived = rel ? deriveRelativeEvent(p.text, publish) : null;

      const eventHasDate = /\d{4}-\d{2}-\d{2}/.test(eventTime);
      if (rel && !derived && !eventHasDate) {
        showToast(`这句话含“${rel}”，请填发布时间，或直接填事件时间（如 2026-10-17）`);
        ($('#f-publish') || $('#f-event'))?.focus();
        return;
      }
      if (derived && (!p.caseId || publish !== initialPublish.trim())) {
        eventTime = derived;
      }

      let caseId = p.caseId;
      if (caseId) {
        const c = getCase(caseId);
        if (!c || !caseMatchesMeta(c, { event_time: eventTime })) {
          caseId = null;
          p.caseId = null;
        }
      }

      const meta = {
        publish_time: publish,
        event_time: eventTime,
        time_anchor: rel ? (derived ? 'publish' : 'event') : 'absolute',
        time_window: $('#f-window').value,
        time_scale: $('#f-scale').value,
        location: $('#f-location').value.trim(),
        location_level: $('#f-level').value,
        source_url: $('#f-source').value.trim(),
        claim_type: $('#f-type').value
      };
      state.meta = meta;
      state.liveFacts = [];
      state.result = analyze(p.text, meta, caseId, p.preset);
      location.hash = '#/result';
    });
  }

  // ---------- result ----------
  function resultView() {
    const r = state.result;
    if (!r) return homeView();
    const urls = uniqueUrls(r.evidence || []);
    const verdictLabel = {
      A: '成立', B: '条件成立', C: '术语/逻辑不成立', D: '信息不足', E: '与事实不符'
    }[r.verdict] || '待判';

    return `
      <div class="result-wrap">
        <div class="result-header">
          <div class="verdict-letter ${escapeHTML(r.verdict)}">${escapeHTML(r.verdict)}</div>
          <div>
            <h2>${escapeHTML(r.title)}</h2>
            ${summaryPointsHTML(r.summary, 'result-header-points')}
            <p class="result-header-meta small muted" style="margin-top:7px">
              <b>判定：</b>${escapeHTML(verdictLabel)} · <b>置信度：</b>${escapeHTML(r.confidence)} · <b>类型：</b>${escapeHTML(r.meta.claim_type || '未说明')}
            </p>
          </div>
          <div class="result-actions">
            <button class="btn btn-primary btn-sm" id="download-report">下载报告</button>
            <button class="btn btn-ghost btn-sm" id="copy-report">复制结论</button>
            <button class="btn btn-ghost btn-sm" id="print-report">打印 / PDF</button>
            <button class="btn btn-ghost btn-sm" id="new-analysis">重新分析</button>
          </div>
        </div>

        ${r.caseId ? `<div class="notice warn" style="margin-top:10px">
          <b>历史案例：</b>本页官方来源与日期对应案例事件（${escapeHTML(r.meta?.event_time || '未说明')}），不是当前日期。
          如果要按 2026 年重新分析，请从首页手动输入同一句话并修改事件时间。
        </div>` : ''}

        <div class="result-grid">
          <div class="result-col">
            <div class="panel sentence-panel" data-role="sentence-panel">
              <div class="card-head">
                <h3>句子拆解</h3>
                <span class="small">${(r.decomposition || []).length} 个槽位</span>
              </div>
              <div class="kv-scroll">
                <dl class="kv">
                  ${(r.decomposition || []).map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v || '未说明')}</dd>`).join('')}
                </dl>
              </div>
            </div>

            <div class="panel logic-panel" data-role="logic-panel">
              <div class="card-head">
                <h3>逻辑漏洞</h3>
                <span class="small">先找漏洞，再看数据</span>
              </div>
              <div class="check-list logic-scroll">
                ${(r.loopholes || []).map(renderCheck).join('')}
              </div>
            </div>

            <div class="panel evidence-panel" data-role="official-evidence">
              <div class="card-head">
                <h3>官方证据 / 核验入口</h3>
                <span class="small">${urls.length} 条链接</span>
              </div>
              ${urls.length ? `
                <div class="evidence-list evidence-scroll">
                  ${urls.map(e => `
                    <div class="evidence-item">
                      <div class="evidence-top">
                        <strong>${escapeHTML(e.source || '官方来源')}</strong>
                        <span>${escapeHTML(e.date || '')}</span>
                      </div>
                      <p>${escapeHTML(e.data || '')}</p>
                      <a href="${escapeHTML(e.url)}" target="_blank" rel="noopener">${escapeHTML(e.url)}</a>
                    </div>`).join('')}
                </div>` : `
                <div class="notice warn">官方入口未列出；请到信源页查询。</div>`}
              ${urls.length ? `<p class="small muted" style="margin-top:8px"><b>官方核验链接</b>🔗</p>` : ''}
            </div>
          </div>

          <div class="result-col">
            <div class="panel term-panel" data-role="term-panel">
              <div class="card-head">
                <h3>模糊词判据卡</h3>
                <span class="small">${(r.terms || []).length} 张</span>
              </div>
              <div class="term-scroll">
                ${(r.terms || []).length ? (r.terms || []).map(renderTermCard).join('') : `
                  <div class="notice info">未匹配到标准术语。可以到 <a href="#/terms">词库</a> 搜索“极大 / 最大 / 特大暴雨 / 百年一遇”。</div>`}
              </div>
            </div>

            <div class="panel" data-role="conditions-panel">
              <div class="card-head">
                <h3>成立条件</h3>
                <span class="small">如果……则……</span>
              </div>
              <ul class="conditions">
                ${(r.conditions || []).map(c => `<li>${escapeHTML(c)}</li>`).join('')}
              </ul>
              <p class="verdict-note">“真/假”不足以定性，分析“在什么口径下才能成立”</p>
            </div>

            <div class="panel" data-role="next-steps">
              <div class="card-head">
                <h3>还要补什么</h3>
                <span class="small">缺失信息清单</span>
              </div>
              <ul class="conditions">
                ${(r.next_steps || []).map(c => `<li>${escapeHTML(c)}</li>`).join('')}
              </ul>
            </div>
          </div>
        </div>

        ${renderDataOverview(r)}
        ${renderLivePanel(r)}
        ${renderSummary(r)}

        <div class="panel" style="margin-top:14px">
          <div class="card-head">
            <h3>参考官方网址</h3>
            <span class="small">访问日期：${nowStamp()}</span>
          </div>
          ${urls.length ? `
            <ol class="conditions">
              ${urls.map(e => `<li>${escapeHTML(e.source)}：<a href="${escapeHTML(e.url)}" target="_blank" rel="noopener">${escapeHTML(e.url)}</a>（${escapeHTML(e.date || '待核验')}）</li>`).join('')}
            </ol>` : `
            <div class="notice info">暂无官方链接；请到 <a href="#/sources">信源库</a> 查询，或使用上方“实时核验”。</div>`}
          <p class="verdict-note">数据以官方页面最新发布为准；本报告保留访问日期，便于复核。</p>
        </div>
      </div>`;
  }

  function renderCheck(c) {
    const symbol = { pass: '✓', warn: '!', fail: '×', unknown: '?' }[c.status] || '?';
    return `
      <div class="check-item ${escapeHTML(c.status)}">
        <div class="check-dot">${symbol}</div>
        <div>
          <strong>${escapeHTML(c.name)}</strong>
          <p>${escapeHTML(c.note || '')}</p>
        </div>
      </div>`;
  }

  function renderTermCard(t) {
    const show = (value) => escapeHTML(value || '').replace(/\n/g, '<br>');
    const eqLabel = t.equivalents_label || '相当于';
    return `
      <article class="term-card" data-edit-id="term-${escapeHTML(t.id)}">
        <div class="term-head">
          <h4>${escapeHTML(t.term)}</h4>
          <span class="tag">${escapeHTML(t.category)}</span>
        </div>
        <p>${show(t.definition)}</p>
        <p><b>时间尺度：</b>${show(t.time_scale)}</p>
        <p><b>数值：</b>${show(t.range)}</p>
        ${(t.equivalents || []).length ? `<p><b>${escapeHTML(eqLabel)}：</b>${show((t.equivalents || []).join('；'))}</p>` : ''}
        ${(t.misuses || []).length ? `<p><b>常见误用：</b></p><ul>${(t.misuses || []).map(m => `<li>${show(m)}</li>`).join('')}</ul>` : ''}
        <div class="term-meta">
          <span><b>依据：</b>${show(t.standard)}</span>
          ${t.url ? `<span><a href="${escapeHTML(t.url)}" target="_blank" rel="noopener">查标准/来源 →</a></span>` : ''}
        </div>
      </article>`;
  }

  function fitResultRows() {
    const pairs = [
      ['sentence-panel', 'term-panel'],
      ['logic-panel', 'conditions-panel'],
      ['official-evidence', 'next-steps']
    ];
    const all = pairs.flat();
    const get = (role) => document.querySelector(`[data-role="${role}"]`);

    if (window.innerWidth <= 980) {
      all.forEach(role => { const el = get(role); if (el) el.style.height = ''; });
      return;
    }

    // Reset first, then measure natural heights.
    all.forEach(role => { const el = get(role); if (el) el.style.height = ''; });
    void document.body.offsetHeight;

    const heights = pairs.map(([leftRole, rightRole]) => {
      const left = get(leftRole);
      const right = get(rightRole);
      return {
        left, right,
        h: Math.max(260, Math.round(Math.min(
          left?.getBoundingClientRect().height || 0,
          right?.getBoundingClientRect().height || 0
        )))
      };
    });

    heights.forEach(({ left, right, h }) => {
      if (left) left.style.height = `${h}px`;
      if (right) right.style.height = `${h}px`;
    });
  }

  function bindResult() {
    $('#download-report')?.addEventListener('click', downloadReport);
    $('#copy-report')?.addEventListener('click', copyReport);
    $('#print-report')?.addEventListener('click', () => window.print());
    $('#new-analysis')?.addEventListener('click', () => {
      state.result = null;
      state.pending = null;
      state.meta = null;
      state.liveFacts = [];
      location.hash = '#/home';
    });
    bindLiveEvidence(state.result);
    requestAnimationFrame(() => {
      fitResultRows();
      setTimeout(fitResultRows, 120);
    });
    if (!state._resultRowsBound) {
      state._resultRowsBound = true;
      window.addEventListener('resize', fitResultRows);
    }
  }

  async function apiGet(path, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(path, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body.error) msg = body.error;
        } catch (_) { /* ignore */ }
        throw new Error(msg);
      }
      return res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function fmtDateISO(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function fmtDateCN(d) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function parseEventDate(r) {
    const raw = [r?.meta?.event_time, r?.meta?.publish_time, r?.claim].filter(Boolean).join(' ');
    let m = raw.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = raw.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*月/);
    if (m) return new Date(+m[1], +m[2] - 1, 1);
    const pubYear = (r?.meta?.publish_time || '').match(/(20\d{2})/);
    m = raw.match(/(\d{1,2})\s*月/);
    if (m) return new Date(pubYear ? +pubYear[1] : new Date().getFullYear(), +m[1] - 1, 1);
    return null;
  }

  function computeLiveFlags(r) {
    const claim = r?.claim || '';
    const phen = (r?.decomposition || []).find(x => x[0] === '现象')?.[1] || '';
    const type = r?.meta?.claim_type || '';
    const eventDate = parseEventDate(r);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isHistorical = eventDate ? eventDate < new Date(today.getTime() - 86400000) : false;
    const isFuture = eventDate ? eventDate > new Date(today.getTime() + 86400000) : false;
    const isENSO = /(厄尔尼诺|拉尼娜|ENSO|海温|ONI|Niño|Nino)/.test(claim) || /厄尔尼诺|拉尼娜/.test(phen);
    const isTyphoon = /(台风|热带气旋|超强台风|登陆)/.test(claim) || /台风/.test(phen);
    const isWarning = /(预警|红色|橙色|黄色|蓝色|停课|停工)/.test(claim);
    const isShortEvent = /(1\s*小时.*(?:下了|降水|雨量|雨强|\d+\s*(?:毫米|mm))|短时强降水|阵风\s*\d|极大风.{0,8}(?:达到|达|出现|实况)|1\s*小时.*\d+\s*(?:毫米|mm))/.test(claim);
    const isShort = isShortEvent;
    const locText = r?.meta?.location || '';
    const isSeaLocation = /(海|洋|太平洋|南海|东海|黄海|渤海|赤道|湾|海域)/.test(locText)
      || /(赤道中东太平洋|西北太平洋|南海|东海|黄海|渤海)/.test(claim);
    const isWeather = !isENSO && !isSeaLocation
      && (/(暴雨|降雨|降水|高温|寒潮|低温|干旱|大风|海浪|海雾|天气|毫米|mm|℃|度)/.test(claim) || /(暴雨|高温|寒潮|干旱|大风|海浪)/.test(phen));
    const isForecast = /(预计|未来|明天|后天|将|可能|或)/.test(claim) || type.includes('预测');
    const hasLocation = !!(r?.meta?.location && r.meta.location !== '未说明');
    const hasLandLocation = hasLocation && !isSeaLocation;
    const isMarine = isSeaLocation || /(海浪|风暴潮|海冰|海啸|海洋热浪|海温)/.test(claim);
    const eventContext = /(实况|观测|出现|达到|登陆|发生|今天|昨天|明天|这次|本次|下了|20\d{2}|月\s*\d|站点|站|市|县|区|海区)/.test(claim);
    const isDefinitional = (r?.terms || []).length > 0 && !hasLocation && !eventDate && !eventContext;
    return {
      claim, phen, type, eventDate, isHistorical, isFuture,
      isENSO, isTyphoon, isWarning, isShort, isWeather, isForecast,
      hasLocation, hasLandLocation, isSeaLocation, isMarine, isDefinitional,
      timeUnknown: !eventDate
    };
  }

  function renderDataOverview(r) {
    const claim = String(r.claim || '');
    const quick = QUICK_FACT_SETS.find(set => set.test(claim));
    if (quick) {
      return `
        <div class="panel data-overview" id="data-overview" style="margin-top:14px">
          <div class="card-head">
            <h3>数据速览</h3>
            <span class="small">${escapeHTML(quick.date)}</span>
          </div>
          <div class="overview-strip">
            ${quick.items.map(item => `
              <div class="overview-item">
                <span class="overview-label">${escapeHTML(item.label)}</span>
                <strong class="overview-value key-value" title="${escapeHTML(item.value)}">${escapeHTML(item.value)}</strong>
                <span class="overview-sub" title="${escapeHTML(item.sub)}">${escapeHTML(item.sub)}</span>
              </div>`).join('')}
          </div>
          <p class="small muted" style="margin:8px 0 0">来源：${escapeHTML(quick.source)}；仅展示核心实况数据。</p>
        </div>`;
    }

    const rainValues = [...claim.matchAll(/(\d+(?:\.\d+)?)\s*(mm|毫米)/gi)]
      .map(match => `${match[1]} mm`);
    const numericText = (r.decomposition || []).find(x => x[0] === '数值')?.[1] || '';
    const fallbackValues = numericText && !/未给出|未说明/.test(numericText)
      ? numericText.split(/[；;]/).map(item => item.trim()).filter(Boolean)
      : [];
    const values = rainValues.length ? [...new Set(rainValues)] : fallbackValues;
    const label = rainValues.length ? '关键雨量' : '关键数值';
    const valueText = values.length ? values.join(' / ') : '未给出';
    const subText = values.length ? '' : '需要具体数值才能核验';
    return `
      <div class="panel data-overview" id="data-overview" style="margin-top:14px">
        <div class="card-head">
          <h3>数据速览</h3>
          <span class="small">关键数据</span>
        </div>
        <div class="overview-strip">
          <div class="overview-item">
            <span class="overview-label">${label}</span>
            <strong class="overview-value key-value" title="${escapeHTML(valueText)}">${escapeHTML(valueText)}</strong>
            ${subText ? `<span class="overview-sub">${escapeHTML(subText)}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  function renderLivePanel(r) {
    const f = computeLiveFlags(r);
    const relevant = f.isENSO || f.isTyphoon || f.isWarning || f.isShort || f.isWeather || f.isMarine;
    if (!relevant || f.isDefinitional) return '';
    const periodText = (r?.decomposition || []).find(x => x[0] === '时段限定')?.[1] || '';
    const hasNonSummer = /非夏季|非汛期|非雨季/.test(periodText);

    const mode = f.isHistorical
      ? `历史（${fmtDateCN(f.eventDate)}）`
      : f.isFuture
        ? `预报（${fmtDateCN(f.eventDate)}）`
        : f.eventDate
          ? `当日/近期（${fmtDateCN(f.eventDate)}）`
          : '时间不明（按当前数据）';

    const locKey = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
    const wmoStation = WMO_STATIONS[locKey] || WMO_STATIONS[r?.meta?.location] || '';
    const cwCode = CHINA_WEATHER_CITIES[locKey] || CHINA_WEATHER_CITIES[r?.meta?.location] || '';
    const buttons = [];
    if (f.isENSO) buttons.push(`<button class="btn btn-soft btn-sm" id="live-oni">刷新 ONI${f.isHistorical ? '（事件月）' : ''}</button>`);
    if (f.isWeather && f.hasLandLocation && !f.isHistorical) buttons.push(`<button class="btn btn-primary btn-sm" id="live-nmc-weather">刷新城市预报</button>`);
    if (f.isWarning && !f.isHistorical && !f.isFuture) buttons.push(`<button class="btn btn-soft btn-sm" id="live-nmc-alarms">刷新预警</button>`);
    if (f.isShort && !f.isTyphoon && !f.isHistorical && !f.isFuture) buttons.push(`<button class="btn btn-soft btn-sm" id="live-nmc-rank">刷新 1 小时排行</button>`);
    if (f.isMarine && !f.isENSO) buttons.push(`<button class="btn btn-soft btn-sm" id="live-marine">刷新海洋警报</button>`);
    if (f.isWeather || f.isWarning || f.isTyphoon || f.isENSO) buttons.push(`<button class="btn btn-ghost btn-sm" id="live-piyao">重新检索辟谣</button>`);
    if (f.isTyphoon) {
      buttons.push(`<input id="cma-name" class="cma-input" type="text" placeholder="${f.isHistorical ? '历史台风名/编号（需填）' : '台风名/编号，留空=最新'}" />`);
      buttons.push(`<button class="btn btn-soft btn-sm" id="live-cma">${f.isHistorical ? '刷新 CMA 历史台风（按年份）' : '刷新 CMA 台风路径/强度'}</button>`);
    }
    if (f.isWeather && f.hasLandLocation) {
      const label = f.isHistorical ? '刷新 Open-Meteo 历史/再分析' : '刷新 Open-Meteo 预报/辅助';
      buttons.push(`<button class="btn btn-ghost btn-sm" id="live-weather">${label}</button>`);
      if (f.isHistorical) buttons.push(`<button class="btn btn-ghost btn-sm" id="live-nasa">刷新 NASA POWER 日值</button>`);
      if (f.isHistorical && hasNonSummer) buttons.push(`<button class="btn btn-soft btn-sm" id="live-non-summer">计算非夏季基准（2022—2026）</button>`);
      if (f.isHistorical && cwCode) buttons.push(`<button class="btn btn-soft btn-sm" id="live-china-weather">刷新中国天气网日值</button>`);
      if (f.isHistorical && cwCode) buttons.push(`<button class="btn btn-soft btn-sm" id="live-china-window">刷新中国天气网过程窗口</button>`);
      if (f.isHistorical && wmoStation) buttons.push(`<button class="btn btn-ghost btn-sm" id="live-gsod">刷新 NOAA GSOD 日值（回退）</button>`);
      if (f.isHistorical && wmoStation) buttons.push(`<button class="btn btn-ghost btn-sm" id="live-meteostat">刷新 Meteostat 逐时（第三方）</button>`);
      if (wmoStation) buttons.push(`<button class="btn btn-soft btn-sm" id="live-ogimet">刷新 SYNOP（${wmoStation}）</button>`);
    }

    const notes = [];
    if (f.timeUnknown) notes.push('未识别事件时间，默认按当前数据；如果是历史事件，请先补日期，否则可能张冠李戴。');
    if (r?.meta?.time_anchor === 'event') notes.push('未填发布时间：以你填的事件时间作为锚点；相对时间“昨天”按事件日期处理，置信度略降。');
    if (f.isENSO) notes.push('ENSO 判定只用 ONI（海温指数），不使用城市天气；城市预报在这里没有意义。');
    if (f.isSeaLocation && !f.isENSO) notes.push('海区/海洋数据（海浪、海温、海雾）需要海洋预报接口；城市天气不适用。');
    if (f.isMarine && !f.isENSO) notes.push('海洋警报只覆盖官方警报产品；海浪/海温预报场地图服务尚未接。');
    if (f.isWeather || f.isWarning || f.isTyphoon || f.isENSO) notes.push('辟谣案例按标题检索，并只保留发布时间不早于事件日的案例；只作背景参考，不作为事实判据。');
    if (f.isWeather) notes.push('官方公开接口会自动拉取；CMA 站点档案需账号/权限；Open-Meteo/NASA 只作辅助交叉核验。');
    if (f.isWeather && !f.hasLandLocation && !f.isSeaLocation) notes.push('需要城市/站点地点，才能拉取城市预报或历史/再分析数据。');
    if (f.isWeather && f.hasLandLocation && wmoStation) notes.push(`WMO SYNOP 可手动用站号 ${wmoStation} 做交叉核验；它是 GTS 报文，不是 CMA 官方站点档案，部分日期可能缺报。`);
    if (f.isWeather && f.hasLandLocation && f.isHistorical) notes.push('NASA POWER 是卫星/再分析日值，不是中国官方站点观测；与 Open-Meteo 交叉看量级。');
    if (f.isWeather && f.hasLandLocation && f.isHistorical && cwCode) notes.push('中国天气网日值是城市级官方媒体观测（rainobs/maxobs/minobs），不是 CMA 原始站点档案；可用于最近日期的交叉核验。');
    if (f.isWeather && f.hasLandLocation && f.isHistorical && wmoStation) notes.push(`Meteostat ${wmoStation} 是第三方整编，且 54511 绑定 ZBAA（首都机场），不是 CMA 54511 观象台；逐时风/湿度可能插值，只作过程核验。`);
    if (f.isHistorical) {
      if (f.isTyphoon) notes.push('历史台风：按事件年份查 NMC 年度列表；更早年份资料完整度可能不同。');
      if (f.isWarning) notes.push('历史预警：当前预警列表不适用；需官方档案。');
      if (f.isShort) notes.push('历史 1 小时排行：当前排行不适用；需历史观测。');
      if (f.isWeather && f.hasLandLocation) notes.push('中央气象台城市预报是“当前预报”，不适用于历史事件；已改用 Open-Meteo 历史/再分析。');
    }

    const actionCount = (buttons.join('').match(/<button/g) || []).length;
    buttons.unshift(`<button class="btn btn-primary btn-sm" id="live-refresh-all" type="button">刷新全部${actionCount ? `（${actionCount} 个来源）` : ''}</button>`);
    return `
      <div class="panel live-panel" id="live-panel" style="margin-top:14px">
        <div class="card-head">
          <h3>实时核验（自动拉取）</h3>
          <div class="live-head-right">
            <span class="small" id="live-status">检测中…</span>
            <button class="btn btn-ghost btn-sm" id="live-toggle" type="button" aria-expanded="false">展开</button>
          </div>
        </div>
        <div id="live-body" style="display:none">
          <p class="small muted">
            开始判定后自动拉取与本题相关的数据源；历史事件不会用今天的数据冒充。一键并行刷新全部来源。
            <span class="tag" style="margin-left:6px">数据时间：${escapeHTML(mode)}</span>
          </p>
          <div class="actions" id="live-action-list" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px">
            ${buttons.join('')}
          </div>
          <div class="live-legend" aria-label="数据源类型">
            <span class="live-legend-item official"><i></i>官方机构</span>
            <span class="live-legend-item aux"><i></i>辅助 / 再分析</span>
            <span class="live-legend-item third"><i></i>第三方 / GTS</span>
            <span class="live-legend-item context"><i></i>背景检索</span>
          </div>
          <div id="live-result" style="margin-top:10px"></div>
          ${notes.length ? `
            <details class="live-notes">
              <summary>口径与限制（${notes.length}）</summary>
              <ul>${notes.map(n => `<li>${escapeHTML(n)}</li>`).join('')}</ul>
            </details>` : ''}
        </div>
      </div>`;
  }

  function summaryPointsHTML(text, className = 'summary-points') {
    const points = (String(text || '').match(/[^。]+。?/g) || [])
      .map(item => item.trim())
      .filter(Boolean);
    if (!points.length) return '';
    return `<ul class="${className}">${points.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`;
  }

  function renderSummary(r) {
    const f = computeLiveFlags(r);
    const facts = state.liveFacts || [];
    const periodText = (r.decomposition || []).find(x => x[0] === '时段限定')?.[1] || '未说明';
    const verdictLabel = { A: '成立', B: '条件成立', C: '术语/逻辑不成立', D: '信息不足', E: '与事实不符' }[r.verdict] || '';
    const mode = f.isHistorical
      ? `历史（${fmtDateCN(f.eventDate)}）`
      : f.isFuture
        ? `预报（${fmtDateCN(f.eventDate)}）`
        : f.eventDate
          ? `当日/近期（${fmtDateCN(f.eventDate)}）`
          : '时间不明（按当前）';

    if (f.isDefinitional) {
      const termLines = (r.terms || []).slice(0, 4).map(t => `<li><b>${escapeHTML(t.term)}</b>：${escapeHTML(t.definition)}</li>`).join('');
      return `
        <div class="panel summary-panel" id="summary-panel" style="margin-top:14px">
          <div class="card-head">
            <h3>总结</h3>
            <span class="tag">术语定义 · 无需实时数据</span>
          </div>
          <p class="summary-lead">这是术语定义/比较，不需要事件时间、地点或实时数据；先把“词”和“量”分清。</p>
          <div class="summary-grid">
            <div class="summary-item">
              <h4>核心区别</h4>
              <ul>${termLines || '<li>未匹配到术语卡。</li>'}</ul>
            </div>
            <div class="summary-item">
              <h4>什么时候才需要实时数据</h4>
              <p class="small muted">当这句话指向某次具体天气事件（有日期、地点、来源）时，才需要补事件时间、地点、来源，再拉官方数据。纯定义/比较题不拉数据。</p>
            </div>
          </div>
          <p class="verdict-note">判定仍为 ${escapeHTML(r.verdict)}；术语判据见上方判据卡。</p>
        </div>`;
    }

    let lead = '';
    if (r.verdict === 'C') lead = `术语/口径不成立：${r.summary}`;
    else if (r.verdict === 'D') lead = `信息不足：${r.summary}`;
    else if (r.verdict === 'B') lead = `条件成立：${r.summary}`;
    else lead = r.summary;

    const claimRain = parseFloat((r.claim.match(/(\d{3,4}(?:\.\d+)?)\s*(?:mm|毫米)/i) || [])[1] || '0');
    const rainVals = facts.map(x => {
      const m = String(x.text || '').match(/降水[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*mm/);
      return m ? parseFloat(m[1]) : null;
    }).filter(v => v !== null && Number.isFinite(v));
    const quickFacts = QUICK_FACT_SETS.find(set => set.test(r.claim));
    const crossCheck = quickFacts ? '' : (claimRain >= 500 && rainVals.length >= 2
      ? `<div class="notice info" style="margin-bottom:10px">
          <b>量级交叉核验：</b>声称 ${claimRain.toFixed(0)} mm；两个独立公开源分别给出 ${rainVals.map(v => v.toFixed(1)).join(' mm / ')} mm，
          相差约 ${Math.round(claimRain / Math.max(...rainVals))} 倍。量级上不支持“${claimRain.toFixed(0)} mm 超级暴雨”；
          这些源不是中国官方站点观测，官方站点档案仍需 CMA 账号/权限。
        </div>`
      : (rainVals.length >= 2
        ? `<div class="notice info" style="margin-bottom:10px">
            <b>多源对照：</b>公开源给出 ${rainVals.map(v => v.toFixed(1)).join(' mm / ')} mm。
            它们分别代表再分析点/城市日值，不是同一个站的全市平均；只能看量级，不能直接当作“1959 年以来序列”的证明。
          </div>`
        : ''));

    const factsHtml = facts.length
      ? facts.map(x => `
          <div class="summary-fact">
            <b>${escapeHTML(x.label)}</b>
            <p>${escapeHTML(x.text)}</p>
            ${x.url ? `<a href="${escapeHTML(x.url)}" target="_blank" rel="noopener">来源</a>` : ''}
          </div>`).join('')
      : f.isDefinitional
        ? `<p class="small muted">这是术语定义/比较，不需要实时数据；请看上方判据卡。</p>`
        : `<p class="small muted">尚未拉取实时数据；当前结论只基于术语/口径与页面证据。</p>`;

    return `
      <div class="panel summary-panel" id="summary-panel" style="margin-top:14px">
        <div class="card-head">
          <h3>总结</h3>
          <span class="tag">判定 ${escapeHTML(r.verdict)} · ${escapeHTML(verdictLabel)} · 置信度 ${escapeHTML(r.confidence)}</span>
        </div>
        <p class="summary-lead">${escapeHTML(lead)}</p>
        ${crossCheck}
        ${f.timeUnknown ? `<div class="notice warn" style="margin-bottom:10px">事件时间未说明：实时数据按当前时间；如果这是历史事件，请先补日期，否则可能张冠李戴。</div>` : ''}
        <div class="summary-grid">
          <div class="summary-item">
            <h4>已锁定的口径</h4>
            <ul>
              <li>事件时间：${escapeHTML(r.meta?.event_time || '未说明')}</li>
              <li>时间锚点：${r.meta?.time_anchor === 'event' ? '事件时间（未填发布时间）' : (r.meta?.time_anchor === 'publish' ? '发布时间 + 相对词' : '绝对日期')}</li>
              <li>数据时间：${escapeHTML(mode)}</li>
              <li>时段限定：${escapeHTML(periodText)}</li>
              <li>地点：${escapeHTML(r.meta?.location || '未说明')}</li>
              <li>来源：${escapeHTML(r.meta?.source_url || '未提供')}</li>
              <li>类型：${escapeHTML(r.meta?.claim_type || '未说明')}</li>
            </ul>
          </div>
          <div class="summary-item">
            <h4>自动拉取结果（${facts.length} 项）</h4>
            ${factsHtml}
          </div>
          <div class="summary-item">
            <h4>关键缺口</h4>
            <ul>${(r.next_steps || []).slice(0, 5).map(x => `<li>${escapeHTML(x)}</li>`).join('') || '<li>无</li>'}</ul>
          </div>
          <div class="summary-item">
            <h4>建议</h4>
            <ul>${(r.conditions || []).slice(0, 4).map(x => `<li>${escapeHTML(x)}</li>`).join('') || '<li>按官方链接复核。</li>'}</ul>
          </div>
        </div>
        <p class="verdict-note">实时数据只用于事实核对，不自动改变术语判定；最终以官方页面为准。</p>
      </div>`;
  }

  const LIVE_SOURCE_META = {
    oni: { badge: 'NOAA', name: 'NOAA CPC ONI', kind: 'official', note: '官方 · 海温指数', color: '#2563eb', soft: '#eff6ff' },
    weather: { badge: 'OM', name: 'Open-Meteo 历史/再分析', kind: 'aux', note: '辅助 · 公开再分析/预报', color: '#7c3aed', soft: '#f5f3ff' },
    'nmc-weather': { badge: 'NMC', name: '中央气象台城市预报', kind: 'official', note: '官方 · 城市预报', color: '#dc2626', soft: '#fef2f2' },
    'nmc-alarms': { badge: 'NMC', name: '中央气象台预警', kind: 'official', note: '官方 · 预警', color: '#dc2626', soft: '#fef2f2' },
    'nmc-rank': { badge: 'NMC', name: '中央气象台 1 小时排行', kind: 'official', note: '官方 · 实况排行', color: '#ea580c', soft: '#fff7ed' },
    piyao: { badge: '辟谣', name: '辟谣平台检索', kind: 'context', note: '背景 · 不作为事实判据', color: '#b45309', soft: '#fffbeb' },
    marine: { badge: 'NMEFC', name: '国家海洋预报台', kind: 'official', note: '官方 · 海洋警报', color: '#0891b2', soft: '#ecfeff' },
    meteostat: { badge: 'MST', name: 'Meteostat 站点逐时', kind: 'third', note: '第三方 · 只作过程核验', color: '#64748b', soft: '#f1f5f9' },
    'china-weather': { badge: 'CWW', name: '中国天气网城市日值', kind: 'official', note: '官方媒体 · 城市日值', color: '#16a34a', soft: '#f0fdf4' },
    'china-window': { badge: 'CWW', name: '中国天气网过程窗口', kind: 'official', note: '官方媒体 · 事件前后日值', color: '#16a34a', soft: '#f0fdf4' },
    gsod: { badge: 'GSOD', name: 'NOAA GSOD 北京站点日值', kind: 'aux', note: '回退 · WMO/GTS 日汇总（非 CMA）', color: '#d97706', soft: '#fffbeb' },
    'non-summer': { badge: 'OM', name: '非夏季基准（2022—2026）', kind: 'aux', note: '辅助 · 再分析单点', color: '#7c3aed', soft: '#f5f3ff' },
    nasa: { badge: 'NASA', name: 'NASA POWER 日值', kind: 'aux', note: '辅助 · 卫星/再分析', color: '#9333ea', soft: '#faf5ff' },
    ogimet: { badge: 'SYNOP', name: 'WMO 站点 SYNOP', kind: 'third', note: 'GTS 报文 · 非 CMA 档案', color: '#475569', soft: '#f8fafc' },
    cma: { badge: 'CMA', name: 'CMA 台风路径/强度', kind: 'official', note: '官方 · 台风', color: '#0f766e', soft: '#f0fdfa' }
  };

  function liveSlot(id, title) {
    const container = $('#live-result');
    if (!container) return document.createElement('div');
    let root = container.querySelector(`[data-live-slot="${id}"]`);
    if (!root) {
      const meta = LIVE_SOURCE_META[id] || {
        badge: 'DATA', name: title || '数据源', kind: 'aux', note: '外部数据', color: '#64748b', soft: '#f8fafc'
      };
      root = document.createElement('section');
      root.className = 'live-block';
      root.dataset.liveSlot = id;
      root.dataset.kind = meta.kind;
      root.dataset.source = id;
      root.style.setProperty('--live', meta.color);
      root.style.setProperty('--live-soft', meta.soft);
      root.innerHTML = `
        <div class="live-block-head">
          <div class="live-source">
            <span class="live-source-badge">${escapeHTML(meta.badge)}</span>
            <div class="live-source-title">
              <b>${escapeHTML(meta.name)}</b>
              <small>${escapeHTML(meta.note)}</small>
            </div>
          </div>
          <span class="live-block-status">自动拉取中…</span>
        </div>
        <div class="live-block-body"></div>`;
      container.appendChild(root);
    }
    return root.querySelector('.live-block-body');
  }

  function markLiveSlot(id, status, ok = true) {
    const root = document.querySelector(`[data-live-slot="${id}"]`);
    const el = root?.querySelector('.live-block-status');
    if (!el) return;
    el.textContent = status;
    const warn = ok && /异常|无|缺|未|部分|仅|第三方/.test(status);
    el.classList.toggle('ok', ok && !warn);
    el.classList.toggle('warn', warn);
    el.classList.toggle('bad', !ok);
  }

  function pushLiveFact(r, label, text, url) {
    const fact = { label, text, url };
    const i = (state.liveFacts || []).findIndex(x => x.label === label);
    if (i >= 0) state.liveFacts[i] = fact;
    else state.liveFacts.push(fact);
    const overview = $('#data-overview');
    if (overview) overview.outerHTML = renderDataOverview(r);
    const panel = $('#summary-panel');
    if (panel) panel.outerHTML = renderSummary(r);
  }

  function bindLiveEvidence(r) {
    const status = $('#live-status');
    if (!status) return;
    const f = computeLiveFlags(r);
    const editMode = new URLSearchParams(location.search).get('edit') === 'result';

    $('#live-toggle')?.addEventListener('click', () => {
      const body = $('#live-body');
      const button = $('#live-toggle');
      if (!body || !button) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      button.textContent = collapsed ? '收起' : '展开';
      button.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    });

    const health = fetch('/api/health', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : Promise.reject(new Error('offline')))
      .then(() => { status.textContent = '后端已连接'; status.style.color = 'var(--ok)'; return true; })
      .catch(() => { status.textContent = '静态模式（未接后端）'; status.style.color = 'var(--muted)'; return false; });

    $('#live-refresh-all')?.addEventListener('click', () => {
      const actions = [...document.querySelectorAll('#live-action-list button[id^="live-"]')]
        .filter(button => button.id !== 'live-refresh-all');
      if (!actions.length) return;
      status.textContent = `正在并行刷新 ${actions.length} 个来源…`;
      status.style.color = 'var(--accent)';
      actions.forEach(button => button.click());
      setTimeout(() => {
        if (status.textContent.includes('正在并行刷新')) {
          status.textContent = `已同时发起 ${actions.length} 个来源`;
          status.style.color = 'var(--ok)';
        }
      }, 1800);
    });

    $('#live-oni')?.addEventListener('click', async () => {
      const box = liveSlot('oni', 'NOAA CPC ONI（官方）');
      box.innerHTML = '<div class="notice info">正在拉取 NOAA CPC ONI…</div>';
      try {
        const dateParam = f.eventDate ? `?date=${fmtDateISO(f.eventDate)}` : '';
        const body = await apiGet('/api/evidence/oni' + dateParam);
        const d = body.data;
        const latest = d.selected || d.latest;
        const warmest = d.record_warmest;
        const label = d.selected
          ? `事件月 ${d.query?.year || ''}-${String(d.query?.month || '').padStart(2, '0')} → ${d.selected.season} ${d.selected.year}`
          : '最新可用';
        const explain2026 = String(r?.title || '').includes('厄尔尼诺')
          && latest.anom >= 0.5
          && (!d.query || d.query.year === 2026);
        box.innerHTML = `
          <div class="notice info">
            <b>CPC ONI（${escapeHTML(label)}）：</b>${escapeHTML(latest.season)} ${latest.year} = <b>${latest.anom.toFixed(2)}℃</b>
            （NOAA：${escapeHTML(latest.classification_noaa)}；中国标准：${escapeHTML(latest.classification_cn)}）<br>
            <b>记录最高：</b>${escapeHTML(warmest.season)} ${warmest.year} = ${warmest.anom.toFixed(2)}℃<br>
            <b>来源：</b><a href="${escapeHTML(d.data_url)}" target="_blank" rel="noopener">${escapeHTML(d.data_url)}</a>
            · 拉取时间：${escapeHTML(d.fetched_at)} · cache：${escapeHTML(d.cache || '')}
            ${d.query?.error ? `<br><span class="small">${escapeHTML(d.query.error)}</span>` : ''}
          </div>
          ${explain2026 ? `
            <div class="notice warn" style="margin-top:8px">
              <b>为什么这里显示“强”，新闻却说“超强”？</b><br>
              CPC ONI ${latest.anom.toFixed(2)}℃：NOAA 分类为 ${escapeHTML(latest.classification_noaa)}；中国标准分类为 ${escapeHTML(latest.classification_cn)}。<br>
              中国国家气候中心 2026 年 7—9 月 Niño3.4 = <b>2.54℃</b>：按中国标准（≥2.5）=“超强”。<br>
              两者不是矛盾，是“指数 / 数据集 / 基准期”不同；比较“最强”必须注明数据集。
              <a href="https://www.news.cn/20261009/98c648578a5642daa590642766fc2463/c.html" target="_blank" rel="noopener">NCC 官方发布</a>
            </div>` : ''}
          ${d.selected && d.query && d.selected.season !== d.query.season ? `<div class="notice warn" style="margin-top:8px">事件月（${escapeHTML(d.query.season)} ${d.query.year}）尚无精确值，显示最近可用：${escapeHTML(d.selected.season)} ${d.selected.year}。</div>` : ''}
          ${!d.selected && f.eventDate ? `<div class="notice warn" style="margin-top:8px">事件月没有精确匹配的 ONI 记录，显示的是“该日期之前最近可用值”，不是事件月观测。</div>` : ''}
          <p class="small muted" style="margin-top:6px">${escapeHTML(d.note)}</p>`;
        pushLiveFact(r, 'ONI', `${latest.season} ${latest.year} = ${latest.anom.toFixed(2)}℃（NOAA：${latest.classification_noaa}；中国标准：${latest.classification_cn}）`, d.data_url);
        markLiveSlot('oni', '已拉取');
      } catch (err) {
        markLiveSlot('oni', '失败', false);
        box.innerHTML = `<div class="notice bad">拉取失败：${escapeHTML(err.message)}。请用 <code>python backend/server.py</code> 启动后端。</div>`;
      }
    });

    $('#live-weather')?.addEventListener('click', async () => {
      const box = liveSlot('weather', 'Open-Meteo 历史/再分析（辅助）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      if (!loc || loc === '未说明') {
        box.innerHTML = '<div class="notice warn">需要先填地点，才能拉取当地天气。</div>';
        return;
      }
      box.innerHTML = `<div class="notice info">正在解析地点“${escapeHTML(loc)}”…</div>`;
      try {
        const geo = (await apiGet(`/api/evidence/geocode?name=${encodeURIComponent(loc)}`)).data;
        const dates = (r?.meta?.event_time || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
        const eventIsExact = /\d{4}-\d{2}-\d{2}/.test(r?.meta?.event_time || '');
        const rawTime = [r?.meta?.event_time, r?.claim].filter(Boolean).join(' ');
        const monthOnly = !eventIsExact && /\d{1,2}\s*月/.test(rawTime) && !/\d{1,2}\s*日/.test(rawTime);
        let start = null;
        let end = null;
        if (f.isHistorical && f.eventDate) {
          start = fmtDateISO(f.eventDate);
          end = dates.length >= 2 ? dates[dates.length - 1] : (monthOnly ? fmtDateISO(endOfMonth(f.eventDate)) : start);
        } else if (dates.length >= 2) {
          start = dates[0];
          end = dates[dates.length - 1];
        }
        let weather;
        if (start) {
          weather = (await apiGet(`/api/evidence/weather?lat=${geo.latitude}&lon=${geo.longitude}&start=${start}&end=${end}`)).data;
        } else {
          weather = (await apiGet(`/api/evidence/weather?lat=${geo.latitude}&lon=${geo.longitude}&days=7`)).data;
        }
        const daily = weather.daily || {};
        const times = daily.time || [];
        const rows = times.map((t, i) => `
          <tr>
            <td>${escapeHTML(t)}</td>
            <td>${daily.precipitation_sum?.[i] ?? '—'} mm</td>
            <td>${daily.temperature_2m_max?.[i] ?? '—'} ℃</td>
            <td>${daily.temperature_2m_min?.[i] ?? '—'} ℃</td>
          </tr>`).join('');
        const isProvince = geo.source_type === 'province_capital';
        const sameName = geo.admin1 === geo.name;
        const isMunicipality = ['北京', '上海', '天津', '重庆'].includes(geo.admin1);
        const locLabel = isProvince
          ? (sameName ? `${geo.name}（直辖市代表点）` : `${geo.admin1}省级代表点：${geo.name}`)
          : `${geo.name || loc}（${geo.admin1 || ''} ${geo.country || ''}）`;
        const levelWarn = isProvince
          ? (isMunicipality
            ? '直辖市代表点，不代表全市平均；正式判断请用全市格点/站点数据。'
            : '省级代表点（省会/首府），不代表全省平均；正式判断请用省级格点/站点数据。')
          : '';
        box.innerHTML = `
          <div class="notice ${isProvince ? 'warn' : 'info'}">
            <b>地点：</b>${escapeHTML(locLabel)} · ${geo.latitude}, ${geo.longitude}<br>
            <b>类型：</b>${start ? '历史/再分析' : '未来 7 天预报'} · ${escapeHTML(weather.note || '')}
            ${levelWarn ? `<br><b>注意：</b>${escapeHTML(levelWarn)}` : ''}
            ${!isProvince && geo.note ? `<br><span class="small">${escapeHTML(geo.note)}</span>` : ''}
            ${isProvince && /平均/.test(r?.meta?.location_level || '') ? `<br><b>口径提醒：</b>你填的是“区域平均”，但这里用的是${isMunicipality ? '直辖市' : '省会'}代表点，不能代表${isMunicipality ? '全市' : '全省'}平均。` : ''}
          </div>
          <table class="table" style="margin-top:8px">
            <thead><tr><th>日期</th><th>降水</th><th>最高温</th><th>最低温</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="small muted">来源：<a href="${escapeHTML(weather.source_url)}" target="_blank" rel="noopener">Open-Meteo</a> · 拉取时间：${escapeHTML(weather.fetched_at)}</p>`;
        const rainVals = (daily.precipitation_sum || []).filter(v => typeof v === 'number');
        const rainSum = rainVals.reduce((a, b) => a + b, 0);
        const tmaxVals = (daily.temperature_2m_max || []).filter(v => typeof v === 'number');
        pushLiveFact(r, 'Open-Meteo', `${start ? '历史/再分析' : '预报'} ${times[0] || ''} 至 ${times[times.length - 1] || ''}：降水合计 ${rainSum.toFixed(1)} mm；最高温 ${tmaxVals.length ? Math.max(...tmaxVals) : '—'}℃`, weather.source_url);
        markLiveSlot('weather', '已拉取');
      } catch (err) {
        markLiveSlot('weather', '失败', false);
        box.innerHTML = `<div class="notice bad">地点/天气拉取失败：${escapeHTML(err.message)}。如果是 ENSO 或海区，不需要城市天气，请用 ONI/海洋数据；如果后端未启动，请运行 <code>python backend/server.py</code>。</div>`;
      }
    });

    const nmcUrl = (u) => {
      if (!u) return '#';
      return String(u).startsWith('http') ? u : `https://www.nmc.cn${u}`;
    };

    $('#live-nmc-weather')?.addEventListener('click', async () => {
      const box = liveSlot('nmc-weather', '中央气象台城市预报（官方）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      if (!loc || loc === '未说明') {
        box.innerHTML = '<div class="notice warn">需要先填地点，才能拉取中央气象台城市预报。</div>';
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取中央气象台城市预报（${escapeHTML(loc)}）…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/nmc/weather?city=${encodeURIComponent(loc)}`)).data;
        const st = d.station || {};
        const real = d.real || {};
        const rows = (d.forecast || []).map(f => `
          <tr>
            <td>${escapeHTML(f.date || '')}</td>
            <td>${escapeHTML(f.day_weather || '—')} ${f.day_temp ?? '—'}℃ / ${escapeHTML(f.night_weather || '—')} ${f.night_temp ?? '—'}℃</td>
            <td>${escapeHTML(f.day_wind || '')} ${escapeHTML(f.day_power || '')}</td>
            <td>${f.precipitation ?? '—'} mm</td>
          </tr>`).join('');
        const warning = d.warning ? `
          <div class="notice warn" style="margin-top:8px">
            <b>当前预警：</b>${escapeHTML(d.warning.alert || '')} ${escapeHTML(d.warning.signaltype || '')} ${escapeHTML(d.warning.signallevel || '')} · ${escapeHTML(d.warning.issuetime || '')}<br>
            ${escapeHTML(d.warning.content || '')}<br>
            <a href="${escapeHTML(nmcUrl(d.warning.url))}" target="_blank" rel="noopener">查看预警原文</a>
          </div>` : '';
        box.innerHTML = `
          <div class="notice info">
            <b>中央气象台：</b>${escapeHTML((st.province || '') + (st.city || ''))} · 发布时间 ${escapeHTML(d.publish_time || '—')}<br>
            实况：${real.temperature ?? '—'}℃ · ${escapeHTML(real.weather || '—')} · 湿度 ${real.humidity ?? '—'}% · ${escapeHTML(real.wind_direct || '')} ${escapeHTML(real.wind_power || '')} · 1h 雨量 ${real.rain ?? '—'} mm
            ${st.source === 'province_capital' && st.city !== loc ? '<br><b>注意：</b>省级名称默认取省会代表点，不代表全省平均。' : ''}
          </div>
          ${warning}
          <table class="table" style="margin-top:8px">
            <thead><tr><th>日期</th><th>白天 / 夜间</th><th>风</th><th>降水</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">中央气象台城市页</a>
            · API：<a href="${escapeHTML(d.api_url)}" target="_blank" rel="noopener">rest/weather</a>
            · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, '中央气象台城市预报', `${st.province || ''}${st.city || ''} · ${d.publish_time || ''}：${real.temperature ?? '—'}℃，${real.weather || '—'}，${real.wind_direct || ''}${real.wind_power || ''}${d.warning ? `；当前预警：${d.warning.alert || ''}` : '；当前无预警'}`, d.source_url);
        markLiveSlot('nmc-weather', '已拉取');
      } catch (err) {
        markLiveSlot('nmc-weather', '失败', false);
        box.innerHTML = `<div class="notice bad">中央气象台拉取失败：${escapeHTML(err.message)}。可改用 Open-Meteo 辅助。</div>`;
      }
    });

    $('#live-nmc-alarms')?.addEventListener('click', async () => {
      const box = liveSlot('nmc-alarms', '中央气象台预警（官方）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      box.innerHTML = `<div class="notice info">正在拉取中央气象台预警${loc ? `（${escapeHTML(loc)}）` : ''}…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/nmc/alarms?province=${encodeURIComponent(loc || '')}&pages=2`)).data;
        const rows = (d.items || []).map(x => `
          <tr>
            <td>${escapeHTML(x.issuetime || '')}</td>
            <td>${escapeHTML(x.title || '')}</td>
            <td><a href="${escapeHTML(nmcUrl(x.url))}" target="_blank" rel="noopener">原文</a></td>
          </tr>`).join('');
        box.innerHTML = `
          <div class="notice info">
            <b>中央气象台预警：</b>${d.count} 条 · 过滤：${escapeHTML(d.province_filter || '全国')}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${rows ? `<table class="table" style="margin-top:8px"><thead><tr><th>发布时间</th><th>标题</th><th>链接</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="notice warn" style="margin-top:8px">当前未匹配到预警；可查看全国列表。</div>'}
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">中央气象台预警页</a> · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, '中央气象台预警', `${d.count} 条（${d.province_filter || '全国'}）${d.items?.[0]?.title ? `；最新：${d.items[0].title}` : ''}`, d.source_url);
        markLiveSlot('nmc-alarms', '已拉取');
      } catch (err) {
        markLiveSlot('nmc-alarms', '失败', false);
        box.innerHTML = `<div class="notice bad">预警拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-nmc-rank')?.addEventListener('click', async () => {
      const box = liveSlot('nmc-rank', '中央气象台 1 小时排行（官方）');
      box.innerHTML = '<div class="notice info">正在拉取中央气象台 1 小时实况排行…</div>';
      try {
        const d = (await apiGet('/api/evidence/nmc/rank1h')).data;
        const block = (title, b) => `
          <div class="live-rank">
            <h4>${escapeHTML(title)}</h4>
            <ol>
              ${(b.list || []).map(x => `<li><span>${escapeHTML(x.name || '')}</span><b>${x.value ?? '—'} ${escapeHTML(b.unit || '')}</b></li>`).join('')}
            </ol>
          </div>`;
        box.innerHTML = `
          <div class="notice info">
            <b>中央气象台 1 小时实况排行：</b>${escapeHTML(d.obs_time || '')} · ${escapeHTML(d.source || '')}<br>
            ${escapeHTML(d.note || '')}
          </div>
          <div class="live-rank-grid">
            ${block('1 小时降水 Top10', d.pre_1h || {})}
            ${block('最高气温 Top10', d.tem_max || {})}
            ${block('最大风速 Top10', d.win_s || {})}
          </div>
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">中央气象台实况排行</a> · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        const top1 = (b) => (b?.list?.[0] ? `${b.list[0].name} ${b.list[0].value}${b.unit || ''}` : '—');
        pushLiveFact(r, '1小时实况排行', `${d.obs_time || ''}；降水 ${top1(d.pre_1h)}；最高温 ${top1(d.tem_max)}；最大风 ${top1(d.win_s)}`, d.source_url);
        markLiveSlot('nmc-rank', '已拉取');
      } catch (err) {
        markLiveSlot('nmc-rank', '失败', false);
        box.innerHTML = `<div class="notice bad">排行拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-piyao')?.addEventListener('click', async () => {
      const box = liveSlot('piyao', '辟谣平台检索（背景）');
      const claim = r?.claim || '';
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const phen = (claim.match(/(暴雨|台风|高温|寒潮|干旱|海浪|厄尔尼诺|拉尼娜)/) || [])[0] || '';
      const num = (claim.match(/(\d{3,4}(?:\.\d+)?)\s*(?:mm|毫米)/i) || [])[1] || '';
      const keys = Array.from(new Set([
        loc && phen ? `${loc}${phen}` : '',
        loc && loc.length > 2 ? loc.slice(-2) : '',
        num ? `${num}mm${phen || '暴雨'}` : '',
        /超级暴雨/.test(claim) ? '超级暴雨' : '',
        loc ? `${loc}暴雨` : '',
        phen || '气象'
      ].filter(Boolean))).slice(0, 6);
      box.innerHTML = `<div class="notice info">正在按标题自动检索：${keys.map(k => `“${escapeHTML(k)}”`).join('、')}…</div>`;
      try {
        const batches = await Promise.all(keys.map(async q => {
          try {
            const d = (await apiGet(`/api/evidence/piyao/search?q=${encodeURIComponent(q)}&limit=5`)).data;
            return (d.items || []).map(x => ({ ...x, _query: q, _page: d.page_url, _fetched: d.fetched_at }));
          } catch (_) {
            return [];
          }
        }));
        const all = [];
        const seen = new Set();
        batches.flat().forEach(x => {
          const key = x.url || `${x.title}|${x.publish_time}`;
          if (!seen.has(key)) { seen.add(key); all.push(x); }
        });
        const eventISO = f.eventDate ? fmtDateISO(f.eventDate) : '';
        const pubISO = (x) => {
          const m = String(x.publish_time || '').match(/(20\d{2})-(\d{2})-(\d{2})/);
          return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
        };
        const timeFiltered = eventISO
          ? all.filter(x => {
            const d = pubISO(x);
            return d && d >= eventISO;
          })
          : [];
        const excludedBefore = all.length - timeFiltered.length;
        const strict = timeFiltered.filter(x => {
          const s = `${x.title || ''} ${x.summary || ''}`;
          return (loc && s.includes(loc))
            || (num && s.includes(num))
            || (/超级暴雨/.test(claim) && s.includes('超级暴雨'));
        });
        const picked = (strict.length ? strict : (loc || num ? [] : timeFiltered)).slice(0, 3);
        const rows = picked.map(x => `
          <div class="evidence-item">
            <div class="evidence-top"><strong>${escapeHTML(x.title || '')}</strong><span>${escapeHTML(x.publish_time || '')}</span></div>
            <p>${escapeHTML((x.summary || '').slice(0, 140))}${(x.summary || '').length > 140 ? '…' : ''}</p>
            ${x.url ? `<a href="${escapeHTML(x.url)}" target="_blank" rel="noopener">查看原文</a>` : ''}
          </div>`).join('');
        const timeNote = eventISO
          ? `只保留发布时间 ≥ ${eventISO} 的案例；已排除 ${excludedBefore} 条事件发生前或日期不明的案例。`
          : '未锁定事件日期，无法确认辟谣是否发生在事件后，因此不展示案例。';
        const note = picked.length
          ? `只显示标题/摘要中同时出现地点、数值或“超级暴雨”的案例。${timeNote}`
          : `${timeNote} 没有检索到符合时间与标题条件的案例。平台只做标题检索，不能据此判定真假；可点下方链接做全文检索。`;
        const pageUrl = picked[0]?._page || 'https://www.piyao.org.cn/pysjk/frontsql.htm';
        const fetched = picked[0]?._fetched || new Date().toLocaleString('zh-CN');
        box.innerHTML = `
          <div class="notice ${picked.length ? 'info' : 'warn'}">
            <b>中国互联网联合辟谣平台：</b>自动检索 ${keys.length} 组关键词 · 命中 ${picked.length} 条<br>
            ${escapeHTML(note)}
          </div>
          ${rows ? `<div class="evidence-list" style="margin-top:8px">${rows}</div>` : ''}
          <p class="small muted" style="margin:8px 0 0">说明：辟谣平台提供的是通报/案例文本，不提供原始雨量、水位数据表；雨量和水位应以应急、气象或水文部门的原始核查数据为准。</p>
          <p class="small muted">关键词：${keys.map(k => `“${escapeHTML(k)}”`).join('、')} · 来源：<a href="${escapeHTML(pageUrl)}" target="_blank" rel="noopener">辟谣平台检索页</a> · 拉取时间：${escapeHTML(fetched)}</p>`;
        pushLiveFact(r, '辟谣案例检索', `自动检索 ${keys.length} 组关键词，时间过滤后命中 ${picked.length} 条${picked[0] ? `；${picked[0].title}` : '；无事件后相关标题'}`, pageUrl);
        markLiveSlot('piyao', picked.length ? '已命中' : '无直接命中');
      } catch (err) {
        markLiveSlot('piyao', '失败', false);
        box.innerHTML = `<div class="notice bad">辟谣案例检索失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-marine')?.addEventListener('click', async () => {
      const box = liveSlot('marine', '国家海洋预报台（官方）');
      const claim = r?.claim || '';
      const type = /风暴潮/.test(claim) ? 'storm' : /海冰/.test(claim) ? 'ice' : /海啸/.test(claim) ? 'bore' : 'wave';
      const typeCN = { wave: '海浪', storm: '风暴潮', ice: '海冰', bore: '海啸' }[type] || type;
      const year = f.isHistorical && f.eventDate ? f.eventDate.getFullYear() : null;
      box.innerHTML = `<div class="notice info">正在拉取国家海洋预报台${year ? `${year} 年` : '当前'}${typeCN}警报…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/nmefc/warnings?type=${type}${year ? `&year=${year}` : ''}`)).data;
        const items = d.items || [];
        const rows = items.slice(0, 8).map(x => `
          <div class="evidence-item">
            <div class="evidence-top"><strong>${escapeHTML(x.title || '')} ${escapeHTML(x.subtitle || '')}</strong><span>${escapeHTML(x.alarm_date || x.date || '')}</span></div>
            <p>${escapeHTML((x.description || '').slice(0, 260))}${(x.description || '').length > 260 ? '…' : ''}</p>
            <span class="tag">${escapeHTML(x.level || '')}</span>
          </div>`).join('');
        box.innerHTML = `
          <div class="notice info">
            <b>国家海洋预报台：</b>${escapeHTML(typeCN)} · ${year ? `${year} 年历史` : '当前'} · ${items.length} 条<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${rows ? `<div class="evidence-list" style="margin-top:8px">${rows}</div>` : '<div class="notice warn" style="margin-top:8px">该接口未返回警报；可到官网查看。</div>'}
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">${escapeHTML(d.source_url)}</a> · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, '国家海洋预报台', `${typeCN} ${year || '当前'}：${items.length} 条${items[0] ? `；最新：${items[0].title || ''} ${items[0].level || ''}` : ''}`, d.source_url);
        markLiveSlot('marine', '已拉取');
      } catch (err) {
        markLiveSlot('marine', '失败', false);
        box.innerHTML = `<div class="notice bad">海洋警报拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-meteostat')?.addEventListener('click', async () => {
      const box = liveSlot('meteostat', 'Meteostat 站点逐时（第三方）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const station = WMO_STATIONS[loc] || WMO_STATIONS[r?.meta?.location] || '';
      const date = f.eventDate ? fmtDateISO(f.eventDate) : '';
      if (!station || !date) {
        box.innerHTML = '<div class="notice warn">Meteostat 需要 WMO 站号和事件日期。</div>';
        markLiveSlot('meteostat', '缺站号/日期', false);
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取 Meteostat ${station} ${date} 逐时数据（首次约 3–5 秒）…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/meteostat/hourly?station=${encodeURIComponent(station)}&date=${encodeURIComponent(date)}`, 90000)).data;
        const s = d.summary || {};
        const rows = (d.rows || []).map(x => `
          <tr>
            <td>${escapeHTML(x.time_bjt || '')}</td>
            <td>${x.temp ?? '—'}℃</td>
            <td>${x.prcp ?? '—'} mm</td>
            <td>${x.rhum ?? '—'}%</td>
            <td>${x.wspd ?? '—'} km/h</td>
            <td>${x.pres ?? '—'} hPa</td>
          </tr>`).join('');
        const detail = rows
          ? `<details style="margin-top:8px"><summary class="small">查看 ${d.count} 小时明细</summary><table class="table" style="margin-top:8px"><thead><tr><th>北京时</th><th>气温</th><th>降水</th><th>湿度</th><th>风速</th><th>气压</th></tr></thead><tbody>${rows}</tbody></table></details>`
          : `<div class="notice warn" style="margin-top:8px">该日期没有数据；Meteostat 当前批量数据最后日期为 ${escapeHTML(d.last_date || '未知')}。它通常滞后 1–2 个月，不能覆盖最近事件。</div>`;
        box.innerHTML = `
          <div class="notice info">
            <b>Meteostat：</b>${escapeHTML(loc)}（${station}） · ${escapeHTML(date)} · ${d.count || 0} 小时<br>
            最高 ${s.temp_max ?? '—'}℃ / 最低 ${s.temp_min ?? '—'}℃ / 平均 ${s.temp_avg ?? '—'}℃ · 降水合计 ${s.precip_sum ?? '—'} mm · 最大风速 ${s.wind_max ?? '—'} km/h<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${detail}
          <p class="small muted">来源：<a href="${escapeHTML(d.page_url)}" target="_blank" rel="noopener">Meteostat Bulk</a> · 批量数据最后日期：${escapeHTML(d.last_date || '—')} · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, 'Meteostat 站点', `${loc}（${station}）${date}：${d.count} 小时；降水 ${s.precip_sum ?? '—'} mm；最高 ${s.temp_max ?? '—'}℃ / 最低 ${s.temp_min ?? '—'}℃`, d.page_url);
        markLiveSlot('meteostat', d.count ? '已拉取' : '无该日数据');
      } catch (err) {
        markLiveSlot('meteostat', '失败', false);
        box.innerHTML = `<div class="notice bad">Meteostat 拉取失败：${escapeHTML(err.message)}。首次下载 3.5 MB，网络慢时可稍后重试。</div>`;
      }
    });

    $('#live-china-weather')?.addEventListener('click', async () => {
      const box = liveSlot('china-weather', '中国天气网城市日值（官方媒体）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const date = f.eventDate ? fmtDateISO(f.eventDate) : '';
      if (!loc || !date) {
        box.innerHTML = '<div class="notice warn">中国天气网日值需要城市和事件日期。</div>';
        markLiveSlot('china-weather', '缺城市/日期', false);
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取中国天气网：${escapeHTML(loc)} ${date}…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/china-weather/daily?city=${encodeURIComponent(loc)}&date=${encodeURIComponent(date)}`, 20000)).data;
        const item = d.item;
        const hasObs = item && item.class === 'obs' && item.rain_mm !== null;
        const fmtObs = (value) => {
          const s = String(value || '');
          return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || '未知');
        };
        const latestLabel = `${fmtObs(d.last_observed_date)}${d.last_observed_month ? `（${d.last_observed_month}）` : ''}`;
        const monthOnly = d.target_month_obs_count === 0;
        const details = hasObs
          ? `<table class="table" style="margin-top:8px"><thead><tr><th>日期</th><th>降水</th><th>最高温</th><th>最低温</th></tr></thead><tbody>
              <tr><td>${escapeHTML(item.date)}</td><td>${item.rain_mm ?? '—'} mm</td><td>${item.temp_max_c ?? '—'} ℃</td><td>${item.temp_min_c ?? '—'} ℃</td></tr>
            </tbody></table>`
          : `<div class="notice warn" style="margin-top:8px">
              该日期没有观测值。${monthOnly ? '该月档案只有历史均值，不含逐日 obs。' : '该日不在已发布的逐日观测范围内。'}<br>
              最近有观测的日期：<b>${escapeHTML(latestLabel)}</b>。
            </div>`;
        box.innerHTML = `
          <div class="notice ${hasObs ? 'info' : 'warn'}">
            <b>中国天气网：</b>${escapeHTML(loc)} · ${escapeHTML(date)}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${details}
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">中国天气网 calendar</a>
            ${!hasObs && d.last_observed_source_url && d.last_observed_source_url !== d.source_url ? ` · <a href="${escapeHTML(d.last_observed_source_url)}" target="_blank" rel="noopener">最近观测月</a>` : ''}
            · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, '中国天气网', hasObs
          ? `${loc} ${date}：降水 ${item.rain_mm} mm；最高 ${item.temp_max_c ?? '—'}℃ / 最低 ${item.temp_min_c ?? '—'}℃`
          : `${loc} ${date}：无日观测值；最近观测 ${latestLabel}`, d.page_url);
        markLiveSlot('china-weather', hasObs ? '已拉取' : (monthOnly ? '仅历史均值' : '无该日观测'));
      } catch (err) {
        markLiveSlot('china-weather', '失败', false);
        box.innerHTML = `<div class="notice bad">中国天气网拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-china-window')?.addEventListener('click', async () => {
      const box = liveSlot('china-window', '中国天气网过程窗口（官方媒体）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const date = f.eventDate ? fmtDateISO(f.eventDate) : '';
      const cwCode = CHINA_WEATHER_CITIES[loc] || CHINA_WEATHER_CITIES[r?.meta?.location] || '';
      const dsUrl = cwCode ? `https://datashareclub.com/location/${cwCode}/weatherd.html` : 'https://datashareclub.com/';
      if (!loc || !date) {
        box.innerHTML = '<div class="notice warn">过程窗口需要城市和事件日期。</div>';
        markLiveSlot('china-window', '缺城市/日期', false);
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取中国天气网过程窗口：${escapeHTML(loc)} ${escapeHTML(date)} 前后…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/china-weather/window?city=${encodeURIComponent(loc)}&date=${encodeURIComponent(date)}&before=2&after=1`, 25000)).data;
        let ds = null;
        if ((d.obs_days || 0) < (d.rows || []).length) {
          try {
            ds = (await apiGet(`/api/evidence/datashareclub/window?city=${encodeURIComponent(loc)}&date=${encodeURIComponent(date)}&before=2&after=1`, 25000)).data;
          } catch (_) { /* auxiliary only */ }
        }
        const dsMap = new Map((ds?.rows || []).map(row => [row.date, row]));
        const merged = (d.rows || []).map(row => {
          const chinaObs = row.class === 'obs' && row.rain_mm !== null;
          if (chinaObs) return { ...row, source: '中国天气网', sourceKind: 'official' };
          const alt = dsMap.get(row.date);
          if (alt && (alt.rain_mm !== null || alt.temp_max_c !== null)) {
            return {
              date: row.date,
              class: 'aux',
              rain_mm: alt.rain_mm,
              temp_max_c: alt.temp_max_c,
              temp_min_c: alt.temp_min_c,
              source: 'datashareclub（辅助）',
              sourceKind: 'aux'
            };
          }
          return {
            ...row,
            source: row.class === 'history' ? '历史均值' : '无记录',
            sourceKind: 'none'
          };
        });
        const valid = merged.filter(row => row.rain_mm !== null || row.temp_max_c !== null);
        const auxCount = merged.filter(row => row.sourceKind === 'aux').length;
        const rainVals = merged.map(row => row.rain_mm).filter(value => value !== null && value !== undefined);
        const tmaxVals = merged.map(row => row.temp_max_c).filter(value => value !== null && value !== undefined);
        const tminVals = merged.map(row => row.temp_min_c).filter(value => value !== null && value !== undefined);
        const rainSum = rainVals.length ? rainVals.reduce((a, b) => a + b, 0) : null;
        const table = merged.length ? `
          <table class="table" style="margin-top:8px">
            <thead><tr><th>日期</th><th>来源</th><th>降水</th><th>最高温</th><th>最低温</th></tr></thead>
            <tbody>
              ${merged.map(row => `
                <tr class="${row.date === date ? 'event-row' : ''}">
                  <td>${escapeHTML(row.date)}</td>
                  <td>${escapeHTML(row.source)}</td>
                  <td>${row.rain_mm ?? '—'} mm</td>
                  <td>${row.temp_max_c ?? '—'} ℃</td>
                  <td>${row.temp_min_c ?? '—'} ℃</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '';
        box.innerHTML = `
          <div class="notice info">
            <b>过程窗口：</b>${escapeHTML(loc)} · ${escapeHTML(d.start)} 至 ${escapeHTML(d.end)}
            · 中国天气网 ${d.obs_days || 0} 天 obs${auxCount ? ` + datashareclub ${auxCount} 天辅助` : ''}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${table}
          <div class="notice ${valid.length ? 'info' : 'warn'}" style="margin-top:8px">
            ${valid.length
              ? `窗口降水合计 <b>${rainSum !== null ? rainSum.toFixed(1) : '—'} mm</b>；最大 <b>${rainVals.length ? Math.max(...rainVals).toFixed(1) : '—'} mm</b>；最小 ${rainVals.length ? Math.min(...rainVals).toFixed(1) : '—'} mm；平均 ${rainVals.length ? (rainSum / rainVals.length).toFixed(1) : '—'} mm；最高温 ${tmaxVals.length ? Math.max(...tmaxVals) : '—'}℃ / 最低温 ${tminVals.length ? Math.min(...tminVals) : '—'}℃。`
              : '窗口内没有可用的逐日值；较早月份中国天气网通常只有历史均值。'}
            ${auxCount ? `<br>其中 ${auxCount} 天由中国天气网缺失，已用 datashareclub 第三方日值补充；它来源/精度未公开，不是官方观测。` : ''}
          </div>
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">中国天气网 calendar</a>
            ${ds?.available ? ` · <a href="${escapeHTML(ds.source_url)}" target="_blank" rel="noopener">datashareclub 近30天</a>` : ` · <a href="${escapeHTML(dsUrl)}" target="_blank" rel="noopener">datashareclub 近30天</a>`}
            · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, '中国天气网过程窗口', valid.length
          ? `${loc} ${d.start} 至 ${d.end}：降水合计 ${rainSum !== null ? rainSum.toFixed(1) : '—'} mm，最大 ${rainVals.length ? Math.max(...rainVals).toFixed(1) : '—'} mm${auxCount ? `（含 datashareclub ${auxCount} 天辅助）` : ''}`
          : `${loc} ${d.start} 至 ${d.end}：无逐日值`, d.page_url);
        markLiveSlot('china-window', valid.length ? (auxCount ? '含第三方补充' : '已拉取') : '无观测');
      } catch (err) {
        markLiveSlot('china-window', '失败', false);
        box.innerHTML = `<div class="notice bad">中国天气网过程窗口拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-gsod')?.addEventListener('click', async () => {
      const box = liveSlot('gsod', 'NOAA GSOD 北京站点日值（回退）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const station = WMO_STATIONS[loc] || WMO_STATIONS[r?.meta?.location] || '';
      if (!station || !f.eventDate) {
        box.innerHTML = '<div class="notice warn">GSOD 回退需要 WMO 站号和事件日期。</div>';
        markLiveSlot('gsod', '缺站号/日期', false);
        return;
      }
      const start = fmtDateISO(new Date(f.eventDate.getTime() - 2 * 86400000));
      const end = fmtDateISO(new Date(f.eventDate.getTime() + 86400000));
      box.innerHTML = `<div class="notice info">正在拉取 NOAA GSOD ${escapeHTML(station)} ${escapeHTML(start)} 至 ${escapeHTML(end)}；首次约需数十秒…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/gsod/daily?station=${encodeURIComponent(station)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, 120000)).data;
        const rows = d.rows || [];
        const s = d.summary || {};
        const table = rows.length ? `
          <table class="table" style="margin-top:8px">
            <thead><tr><th>日期</th><th>降水</th><th>最高温</th><th>最低温</th><th>平均风</th></tr></thead>
            <tbody>
              ${rows.map(row => `
                <tr class="${row.date === fmtDateISO(f.eventDate) ? 'event-row' : ''}">
                  <td>${escapeHTML(row.date)}</td>
                  <td>${row.prcp_mm ?? '—'} mm</td>
                  <td>${row.temp_max_c ?? '—'} ℃</td>
                  <td>${row.temp_min_c ?? '—'} ℃</td>
                  <td>${row.wind_ms ?? '—'} m/s</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '';
        box.innerHTML = `
          <div class="notice ${rows.length ? 'info' : 'warn'}">
            <b>NOAA GSOD：</b>${escapeHTML(loc)}（${escapeHTML(d.gsod_station || station)}） · ${escapeHTML(start)} 至 ${escapeHTML(end)}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${table}
          <div class="notice ${rows.length ? 'info' : 'warn'}" style="margin-top:8px">
            ${rows.length
              ? `窗口降水合计 <b>${s.rain_sum_mm ?? '—'} mm</b>；最大 ${s.rain_max_mm ?? '—'} mm；最高温 ${s.temp_max_c ?? '—'}℃ / 最低温 ${s.temp_min_c ?? '—'}℃。`
              : 'GSOD 这个窗口没有数据；2026 年档案尚未发布，2025 年也可能不完整。'}
          </div>
          <p class="small muted">来源：<a href="${escapeHTML(d.archive_url)}" target="_blank" rel="noopener">NOAA NCEI GSOD</a>
            · <a href="${escapeHTML(d.page_url)}" target="_blank" rel="noopener">数据检索</a>
            · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, 'NOAA GSOD', rows.length
          ? `${loc}（${d.gsod_station}）${start} 至 ${end}：降水合计 ${s.rain_sum_mm ?? '—'} mm；最高 ${s.temp_max_c ?? '—'}℃ / 最低 ${s.temp_min_c ?? '—'}℃`
          : `${loc} ${start} 至 ${end}：GSOD 无数据`, d.page_url);
        markLiveSlot('gsod', rows.length ? '已拉取' : '无数据');
      } catch (err) {
        markLiveSlot('gsod', '失败', false);
        box.innerHTML = `<div class="notice bad">NOAA GSOD 拉取失败：${escapeHTML(err.message)}。首次查询较慢，可稍后重试。</div>`;
      }
    });

    $('#live-non-summer')?.addEventListener('click', async () => {
      const box = liveSlot('non-summer', '非夏季基准（2022—2026）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      if (!loc || loc === '未说明') {
        box.innerHTML = '<div class="notice warn">非夏季基准需要城市/地点。</div>';
        markLiveSlot('non-summer', '缺地点', false);
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取 ${escapeHTML(loc)} 2022—2026 非夏季日降水（Open-Meteo 再分析单点）…</div>`;
      try {
        const geo = (await apiGet(`/api/evidence/geocode?name=${encodeURIComponent(loc)}`, 20000)).data;
        const end = fmtDateISO(new Date());
        const weather = (await apiGet(`/api/evidence/weather?lat=${geo.latitude}&lon=${geo.longitude}&start=2022-01-01&end=${end}`, 60000)).data;
        const daily = weather.daily || {};
        const times = daily.time || [];
        const rain = daily.precipitation_sum || [];
        const byYear = new Map();
        times.forEach((time, index) => {
          const [year, month] = String(time).split('-').map(Number);
          if (!year || !month || (month >= 6 && month <= 8)) return;
          if (!Number.isFinite(rain[index])) return;
          if (!byYear.has(year)) byYear.set(year, []);
          byYear.get(year).push({ date: time, rain: rain[index] });
        });
        const eventISO = f.eventDate ? fmtDateISO(f.eventDate) : '';
        const eventValue = eventISO
          ? (times.indexOf(eventISO) >= 0 && Number.isFinite(rain[times.indexOf(eventISO)]) ? rain[times.indexOf(eventISO)] : null)
          : null;
        const stats = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, items]) => {
          const values = items.map(item => item.rain).sort((a, b) => a - b);
          const sum = values.reduce((a, b) => a + b, 0);
          const p95 = values.length ? values[Math.min(values.length - 1, Math.floor(0.95 * (values.length - 1)))] : null;
          return {
            year,
            days: values.length,
            avg: values.length ? sum / values.length : null,
            max: values.length ? values[values.length - 1] : null,
            p95
          };
        });
        const y2026 = byYear.get(2026) || [];
        const rank2026 = eventValue === null || !y2026.length
          ? null
          : y2026.filter(item => item.rain > eventValue).length + 1;
        const overallMax = stats.reduce((best, item) => (
          item.max !== null && (!best || item.max > best.max) ? item : best
        ), null);
        box.innerHTML = `
          <div class="notice info">
            <b>非夏季基准：</b>${escapeHTML(loc)} · 6—8 月以外 · 2022-01-01 至 ${escapeHTML(end)}<br>
            Open-Meteo 历史/再分析单点，不是 CMA 站点档案，也不是 ${escapeHTML(loc)} 全市平均；2026 为截至 ${escapeHTML(end)} 的年内数据，未含 11—12 月，不能直接和 2025 全年平均比较。
          </div>
          <table class="table" style="margin-top:8px">
            <thead><tr><th>年份</th><th>非夏季天数</th><th>平均日降水</th><th>最大日降水</th><th>P95</th></tr></thead>
            <tbody>
              ${stats.map(item => `
                <tr class="${item.year === 2025 || item.year === 2026 ? 'event-row' : ''}">
                  <td>${item.year}${item.year === 2026 ? `（截至 ${escapeHTML(end)}）` : ''}</td>
                  <td>${item.days}</td>
                  <td><b>${item.avg !== null ? item.avg.toFixed(2) : '—'} mm</b></td>
                  <td>${item.max !== null ? item.max.toFixed(1) : '—'} mm</td>
                  <td>${item.p95 !== null ? item.p95.toFixed(1) : '—'} mm</td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${eventValue !== null ? `<div class="notice info" style="margin-top:8px">
            <b>事件日 ${escapeHTML(eventISO)}：</b>${eventValue.toFixed(1)} mm${rank2026 ? `；在 <b>2026 年内</b>非夏季序列中排第 ${rank2026} 位（共 ${y2026.length} 天）` : ''}。
            ${overallMax && overallMax.max > eventValue ? `<br><b>跨年对照：</b>2022—2026 全段最大日降水是 ${overallMax.year} 年的 ${overallMax.max.toFixed(1)} mm；${eventValue.toFixed(1)} mm 只是 2026 年内最高，不是这五年第一。` : ''}
          </div>` : ''}
          <p class="small muted">来源：<a href="${escapeHTML(weather.source_url)}" target="_blank" rel="noopener">Open-Meteo 历史/再分析</a>
            · 拉取时间：${escapeHTML(weather.fetched_at)}</p>`;
        pushLiveFact(r, '非夏季基准', stats.length
          ? `2022—2026 非夏季平均日降水：${stats.map(item => `${item.year}=${item.avg !== null ? item.avg.toFixed(2) : '—'} mm`).join('；')}`
          : '非夏季基准无数据', weather.source_url);
        markLiveSlot('non-summer', stats.length ? '已计算' : '无数据');
      } catch (err) {
        markLiveSlot('non-summer', '失败', false);
        box.innerHTML = `<div class="notice bad">非夏季基准计算失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-nasa')?.addEventListener('click', async () => {
      const box = liveSlot('nasa', 'NASA POWER 日值（辅助）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      if (!loc || loc === '未说明') {
        box.innerHTML = '<div class="notice warn">需要地点才能查询 NASA POWER。</div>';
        markLiveSlot('nasa', '缺地点', false);
        return;
      }
      const start = f.eventDate ? fmtDateISO(f.eventDate) : fmtDateISO(new Date(Date.now() - 2 * 86400000));
      const end = f.eventDate ? fmtDateISO(f.eventDate) : fmtDateISO(new Date());
      box.innerHTML = `<div class="notice info">正在拉取 NASA POWER：${escapeHTML(loc)} ${start}…</div>`;
      try {
        const geo = (await apiGet(`/api/evidence/geocode?name=${encodeURIComponent(loc)}`)).data;
        const d = (await apiGet(`/api/evidence/nasa/power?lat=${geo.latitude}&lon=${geo.longitude}&start=${start}&end=${end}`)).data;
        const rows = (d.rows || []).map(x => `
          <tr>
            <td>${escapeHTML(x.date || '')}</td>
            <td>${x.PRECTOTCORR ?? '—'} mm</td>
            <td>${x.T2M ?? '—'} ℃</td>
            <td>${x.T2M_MAX ?? '—'} ℃</td>
            <td>${x.T2M_MIN ?? '—'} ℃</td>
          </tr>`).join('');
        const rainVals = (d.rows || [])
          .map(x => x.PRECTOTCORR)
          .filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 500);
        const rainSum = rainVals.length ? rainVals.reduce((a, b) => a + b, 0) : null;
        const flags = d.quality_flags || [];
        const quality = flags.length
          ? `<div class="notice warn" style="margin-top:8px"><b>数据质控：</b>${flags.map(x => `${escapeHTML(x.date)} 的 ${escapeHTML(x.field || '降水')}=${x.value}，${escapeHTML(x.reason || '疑似异常')}`).join('；')}</div>`
          : '';
        box.innerHTML = `
          <div class="notice info">
            <b>NASA POWER：</b>${escapeHTML(loc)} · ${escapeHTML(start)} 至 ${escapeHTML(end)}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${quality}
          ${rows ? `<table class="table" style="margin-top:8px"><thead><tr><th>日期</th><th>降水</th><th>平均温</th><th>最高温</th><th>最低温</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="notice warn" style="margin-top:8px">该日期没有返回日值。</div>'}
          <p class="small muted">来源：<a href="${escapeHTML(d.page_url)}" target="_blank" rel="noopener">NASA POWER</a> · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, 'NASA POWER', rainSum !== null
          ? `${loc} ${start}：降水 ${rainSum.toFixed(1)} mm；平均温 ${d.rows?.[0]?.T2M ?? '—'}℃`
          : `${loc} ${start}：降水数据异常/缺测，未纳入交叉核验`, d.page_url);
        markLiveSlot('nasa', flags.length ? '数据异常' : (d.rows?.length ? '已拉取' : '无数据'));
      } catch (err) {
        markLiveSlot('nasa', '失败', false);
        box.innerHTML = `<div class="notice bad">NASA POWER 拉取失败：${escapeHTML(err.message)}。</div>`;
      }
    });

    $('#live-ogimet')?.addEventListener('click', async () => {
      const box = liveSlot('ogimet', 'WMO 站点 SYNOP（GTS）');
      const loc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
      const station = WMO_STATIONS[loc] || WMO_STATIONS[r?.meta?.location] || '';
      if (!station) {
        box.innerHTML = '<div class="notice warn">没有把地点映射到 WMO 站号；请在确认页填写具体站点，或改看 Open-Meteo。</div>';
        markLiveSlot('ogimet', '无站号', false);
        return;
      }
      const dates = (r?.meta?.event_time || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
      const start = f.isHistorical && f.eventDate ? fmtDateISO(f.eventDate) : fmtDateISO(new Date());
      const end = dates.length >= 2 ? dates[dates.length - 1] : start;
      box.innerHTML = `<div class="notice info">正在拉取 WMO SYNOP：${escapeHTML(loc)}（${station}） ${start}…</div>`;
      try {
        const d = (await apiGet(`/api/evidence/ogimet/synop?station=${encodeURIComponent(station)}&start=${start}&end=${end}`, 12000)).data;
        const items = d.items || [];
        const rows = items.map(x => `
          <tr>
            <td>${escapeHTML(x.datetime_utc || '')}</td>
            <td>${x.temperature_c ?? '—'}℃</td>
            <td>${x.dewpoint_c ?? '—'}℃</td>
            <td>${x.pressure_msl_hpa ?? '—'} hPa</td>
            <td>${x.wind_dir_deg ?? '—'}° ${x.wind_speed_ms ?? '—'} m/s</td>
            <td>${x.precip_mm ?? '—'} mm</td>
          </tr>`).join('');
        const maxRain = Math.max(...items.map(x => Number(x.precip_mm)).filter(Number.isFinite), 0);
        box.innerHTML = `
          <div class="notice ${items.length ? 'info' : 'warn'}">
            <b>WMO SYNOP：</b>${escapeHTML(loc)}（${station}） · ${items.length} 条 · 最大降水 ${maxRain ? `${maxRain.toFixed(1)} mm` : '—'}<br>
            ${escapeHTML(d.note || '')}
          </div>
          ${rows ? `<table class="table" style="margin-top:8px"><thead><tr><th>UTC</th><th>气温</th><th>露点</th><th>海平面气压</th><th>风</th><th>降水</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="notice warn" style="margin-top:8px">该站该时段没有返回 SYNOP 报文；可能是缺报或站号不匹配。</div>'}
          <details style="margin-top:8px"><summary class="small">查看原始报文（前 3 条）</summary><pre style="overflow:auto;font-size:11px;background:#f8fbfd;padding:8px;border-radius:8px">${items.slice(0, 3).map(x => escapeHTML(x.raw || '')).join('\n')}</pre></details>
          <p class="small muted">来源：<a href="${escapeHTML(d.source_url)}" target="_blank" rel="noopener">Ogimet / WMO SYNOP</a> · 拉取时间：${escapeHTML(d.fetched_at)}</p>`;
        pushLiveFact(r, 'WMO SYNOP', `${loc}（${station}）${start}：${items.length} 条；最大降水 ${maxRain ? `${maxRain.toFixed(1)} mm` : '—'}`, d.source_url);
        markLiveSlot('ogimet', items.length ? '已拉取' : '无报文');
      } catch (err) {
        markLiveSlot('ogimet', '失败', false);
        box.innerHTML = `<div class="notice bad">SYNOP 拉取失败：${escapeHTML(err.message)}。这可能是网络超时或该站缺报；不影响术语判定。</div>`;
      }
    });

    $('#live-cma')?.addEventListener('click', async () => {
      const box = liveSlot('cma', 'CMA 台风（官方）');
      const name = ($('#cma-name')?.value || '').trim();
      const year = f.isHistorical && f.eventDate ? f.eventDate.getFullYear() : null;
      if (year && !name) {
        box.innerHTML = '<div class="notice warn">历史台风需要先输入台风名/编号（如“山竹”“MANGKHUT”“1822”），才能按年份查 NMC 年度列表。</div>';
        return;
      }
      box.innerHTML = `<div class="notice info">正在拉取 CMA 台风${name ? `（${escapeHTML(name)}${year ? `，${year} 年` : ''}）` : '（最新）'}…</div>`;
      try {
        const url = name
          ? `/api/evidence/cma/typhoon?name=${encodeURIComponent(name)}${year ? `&year=${year}` : ''}`
          : '/api/evidence/cma/latest';
        const d = (await apiGet(url)).data;
        const t = d.track || d;
        const isHist = Boolean(year);
        const latest = t.latest || {};
        const max = t.max_wind || {};
        const minp = t.min_pressure || {};
        const focus = isHist ? max : latest;
        const firstForecast = (t.forecast || [])[0];
        const rows = (t.forecast || []).map(f => `
          <tr>
            <td>${f.lead_hours}h</td>
            <td>${escapeHTML(f.valid_time_cn || '')}</td>
            <td>${f.lat}°N ${f.lon}°E</td>
            <td>${f.pressure_hpa} hPa</td>
            <td>${f.wind_ms} m/s</td>
            <td>${escapeHTML(f.grade_cn || '')}</td>
          </tr>`).join('');
        const claim = r?.claim || '';
        let claimNote = '';
        if (/17\s*级/.test(claim) && focus.wind_ms) {
          claimNote = `<div class="notice warn" style="margin-top:8px">
            你说“17 级”；CMA ${isHist ? '过程峰值' : '最新'} ${focus.wind_ms} m/s（${focus.wind_kmh} km/h）。
            按风力等级，17 级 = 56.1–61.2 m/s；${focus.wind_ms > 61.2
              ? 'CMA 已达“17 级以上”，但 CMA 台风业务强度是 2 分钟平均，风力等级是 10 分钟平均，不能直接等同。'
              : '需按平均时长换算后再比较。'}
            ${isHist ? '历史个例的登陆强度尚未自动判定（需轨迹与海岸线相交）；过程峰值不等于登陆强度。' : ''}
          </div>`;
        }
        box.innerHTML = `
          <div class="notice info">
            <b>CMA ${isHist ? '历史台风' : '台风'}：</b>${escapeHTML(t.name_cn || '')}（${escapeHTML(t.name_en || '')}，${escapeHTML(t.number || '')}号）
            · ${t.status === 'start' ? '活动中' : '已结束'}<br>
            ${isHist ? '轨迹最后一点' : '最新'}：${escapeHTML(latest.time_cn || '')} · ${latest.lat}°N ${latest.lon}°E
            · ${escapeHTML(latest.grade_cn || '')} · ${latest.wind_ms} m/s（${latest.wind_kmh} km/h）
            · ${latest.pressure_hpa} hPa · ${escapeHTML(latest.move_dir || '')} ${latest.move_speed} km/h<br>
            ${isHist ? '过程峰值' : '巅峰'}：${max.wind_ms} m/s / ${minp.pressure_hpa} hPa
          </div>
          ${claimNote}
          <div class="notice warn" style="margin-top:8px">${escapeHTML(t.note || '')}</div>
          ${rows ? `
          <div class="notice info" style="margin-top:8px">
            <b>时间说明：</b>上面“最新”是当前实况 ${escapeHTML(latest.time_cn || '')}；
            下面是未来预报，首个预报有效时间 ${escapeHTML(firstForecast?.valid_time_cn || '')}
            （${firstForecast?.lead_hours ?? '—'} 小时后）。跨日只是预报有效时间，不是另一个台风编号。
          </div>
          <table class="table" style="margin-top:8px">
            <thead><tr><th>时效</th><th>预报有效时间（未来）</th><th>位置</th><th>气压</th><th>风速</th><th>等级</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>` : `<div class="notice info" style="margin-top:8px">历史轨迹无预报；以上为实况轨迹。</div>`}
          <p class="small muted">来源：<a href="${escapeHTML(t.source_url)}" target="_blank" rel="noopener">${escapeHTML(t.source_url)}</a>
            · API：<a href="${escapeHTML(t.api_url)}" target="_blank" rel="noopener">rest/view</a>
            · 拉取时间：${escapeHTML(t.fetched_at)}</p>
          ${d.news?.description ? `<p class="small muted">台风快讯：${escapeHTML(d.news.description)}</p>` : ''}`;
        pushLiveFact(r, isHist ? 'CMA 历史台风' : 'CMA 台风', `${t.name_cn || ''}（${t.number || ''}）${isHist ? '过程峰值' : latest.time_cn || ''}：${focus.wind_ms} m/s，${focus.pressure_hpa} hPa，${focus.grade_cn || ''}${isHist ? '；轨迹最后一点 ' + (latest.time_cn || '') + ' ' + latest.wind_ms + ' m/s' : ''}`, t.source_url);
        markLiveSlot('cma', '已拉取');
      } catch (err) {
        markLiveSlot('cma', '失败', false);
        box.innerHTML = `<div class="notice bad">CMA 台风拉取失败：${escapeHTML(err.message)}。可留空查最新台风，或输入“蔷琵/CHAMPI/2630”。</div>`;
      }
    });

    // 开始判定时自动拉取，不用逐项点击。手动按钮保留为“刷新”。
    const autoLoc = (r?.meta?.location || '').replace(/（.*?）/g, '').replace(/\s+/g, '').replace(/(省|市|自治区|特别行政区)$/, '').trim();
    const autoStation = WMO_STATIONS[autoLoc] || WMO_STATIONS[r?.meta?.location] || '';
    const autoCw = CHINA_WEATHER_CITIES[autoLoc] || CHINA_WEATHER_CITIES[r?.meta?.location] || '';
    const autoPeriod = (r?.decomposition || []).find(x => x[0] === '时段限定')?.[1] || '';
    const autoTargets = new Set();
    if (f.isENSO) autoTargets.add('#live-oni');
    if (f.isWeather && f.hasLandLocation) {
      if (f.isHistorical) autoTargets.add('#live-weather');
      else {
        autoTargets.add('#live-nmc-weather');
        autoTargets.add('#live-weather');
      }
      if (f.isHistorical) {
        autoTargets.add('#live-nasa');
        if (/非夏季|非汛期|非雨季/.test(autoPeriod)) autoTargets.add('#live-non-summer');
        if (autoCw) autoTargets.add('#live-china-weather');
        if (autoStation) autoTargets.add('#live-meteostat');
      }
    }
    if (f.isWarning && !f.isHistorical && !f.isFuture) {
      autoTargets.add('#live-nmc-alarms');
      if (f.isWeather && f.hasLandLocation) autoTargets.add('#live-nmc-weather');
    }
    if (f.isShort && !f.isTyphoon && !f.isHistorical && !f.isFuture) autoTargets.add('#live-nmc-rank');
    if (f.isMarine && !f.isENSO) autoTargets.add('#live-marine');
    if (f.isWeather || f.isWarning || f.isTyphoon || f.isENSO) autoTargets.add('#live-piyao');
    if (f.isTyphoon && !f.isHistorical) autoTargets.add('#live-cma');

    health.then(ok => {
      if (editMode) {
        status.textContent = '编辑模式：未自动拉取';
        status.style.color = 'var(--muted)';
        return;
      }
      if (!ok || autoTargets.size === 0) return;
      const selectors = [...autoTargets];
      status.textContent = `自动拉取中（${selectors.length} 个来源）…`;
      status.style.color = 'var(--accent)';
      setTimeout(() => selectors.forEach(sel => $(sel)?.click()), 80);
      setTimeout(() => {
        if (status.textContent.includes('自动拉取中')) {
          status.textContent = `已自动发起 ${selectors.length} 个来源`;
          status.style.color = 'var(--ok)';
        }
      }, 1800);
    });
  }

  // ---------- report ----------
  function plainReport(r) {
    const lines = [];
    lines.push('气象信息判别器 · 判据报告');
    lines.push('作者：CallMeSUCH');
    lines.push(`生成时间：${nowStamp()}`);
    lines.push('');
    lines.push(`原文：${r.claim}`);
    lines.push(`判定：${r.verdict}（${r.confidence}）`);
    lines.push(`摘要：${r.summary}`);
    lines.push('');
    lines.push('【句子拆解】');
    (r.decomposition || []).forEach(([k, v]) => lines.push(`${k}：${v || '未说明'}`));
    lines.push('');
    lines.push('【逻辑漏洞】');
    (r.loopholes || []).forEach(c => lines.push(`- [${c.status}] ${c.name}：${c.note || ''}`));
    lines.push('');
    lines.push('【模糊词判据卡】');
    (r.terms || []).forEach(t => {
      lines.push(`- ${t.term}：${t.definition}`);
      lines.push(`  时间尺度：${t.time_scale}；数值：${t.range}`);
      lines.push(`  依据：${t.standard}`);
    });
    lines.push('');
    lines.push('【官方证据 / 核验入口】');
    (r.evidence || []).forEach(e => lines.push(`- ${e.source}（${e.date}）：${e.data}\n  ${e.url}`));
    lines.push('');
    lines.push('【成立条件】');
    (r.conditions || []).forEach(c => lines.push(`- ${c}`));
    lines.push('');
    lines.push('【还要补什么】');
    (r.next_steps || []).forEach(c => lines.push(`- ${c}`));
    lines.push('');
    lines.push('【实时核验事实】');
    if ((state.liveFacts || []).length) {
      (state.liveFacts || []).forEach(f => lines.push(`- ${f.label}：${f.text}${f.url ? `\n  ${f.url}` : ''}`));
    } else {
      lines.push('- 尚未拉取实时数据。');
    }
    lines.push('');
    lines.push('说明：本原型不接入在线大模型；判定由规则与知识库完成。官方数据以链接页面最新发布为准。');
    return lines.join('\n');
  }

  async function copyReport() {
    const text = plainReport(state.result);
    try {
      await navigator.clipboard.writeText(text);
      showToast('结论已复制到剪贴板');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('结论已复制');
    }
  }

  function buildReportHTML(r) {
    const rows = (r.decomposition || []).map(([k, v]) => `<tr><th>${escapeHTML(k)}</th><td>${escapeHTML(v || '未说明')}</td></tr>`).join('');
    const checks = (r.loopholes || []).map(c => `<li><b>[${escapeHTML(c.status)}] ${escapeHTML(c.name)}</b>：${escapeHTML(c.note || '')}</li>`).join('');
    const terms = (r.terms || []).map(t => `<div class="term"><h4>${escapeHTML(t.term)}</h4><p>${escapeHTML(t.definition)}</p><p><b>时间尺度：</b>${escapeHTML(t.time_scale)}；<b>数值：</b>${escapeHTML(t.range)}</p><p><b>依据：</b>${escapeHTML(t.standard)}</p></div>`).join('');
    const evidence = (r.evidence || []).map(e => `<li><b>${escapeHTML(e.source)}</b>（${escapeHTML(e.date || '')}）：${escapeHTML(e.data || '')}<br><a href="${escapeHTML(e.url)}">${escapeHTML(e.url)}</a></li>`).join('');
    const conditions = (r.conditions || []).map(c => `<li>${escapeHTML(c)}</li>`).join('');
    const next = (r.next_steps || []).map(c => `<li>${escapeHTML(c)}</li>`).join('');
    const facts = (state.liveFacts || []).map(f => `<li><b>${escapeHTML(f.label)}</b>：${escapeHTML(f.text)}${f.url ? `<br><a href="${escapeHTML(f.url)}">${escapeHTML(f.url)}</a>` : ''}</li>`).join('');

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>判据报告 · ${escapeHTML(r.title)}</title>
      <style>
        body{font-family:"Microsoft YaHei",system-ui,sans-serif;line-height:1.75;color:#0d1b2a;max-width:820px;margin:36px auto;padding:0 24px}
        h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:24px 0 8px;border-left:3px solid #0f766e;padding-left:9px}
        .meta{color:#62748a;font-size:13px}.verdict{display:inline-block;padding:5px 12px;border-radius:8px;background:#fdf3e2;color:#b45309;font-weight:700}
        table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #eaf0f6;text-align:left;padding:6px 8px;vertical-align:top}
        th{width:88px;color:#62748a;font-weight:600}ul{padding-left:18px;font-size:13px}.term{border:1px solid #eaf0f6;border-radius:8px;padding:10px 12px;margin:8px 0}
        a{color:#0f766e;word-break:break-all}.note{color:#62748a;font-size:12px;border-top:1px dashed #dbe4ee;margin-top:20px;padding-top:10px}
      </style></head><body>
      <h1>气象信息判别器 · 判据报告</h1>
      <p class="meta">作者：CallMeSUCH · 生成时间：${nowStamp()}</p>
      <p><span class="verdict">判定 ${escapeHTML(r.verdict)} · 置信度 ${escapeHTML(r.confidence)}</span></p>
      <p><b>原文：</b>${escapeHTML(r.claim)}</p>
      <p><b>摘要：</b>${escapeHTML(r.summary)}</p>
      <h2>句子拆解</h2><table>${rows}</table>
      <h2>逻辑漏洞</h2><ul>${checks}</ul>
      <h2>模糊词判据卡</h2>${terms}
      <h2>官方证据 / 核验入口</h2><ul>${evidence}</ul>
      <h2>实时核验事实</h2><ul>${facts || '<li>尚未拉取实时数据。</li>'}</ul>
      <h2>成立条件</h2><ul>${conditions}</ul>
      <h2>还要补什么</h2><ul>${next}</ul>
      <p class="note">说明：本原型不接入在线大模型；判定由规则与知识库完成。官方数据以链接页面最新发布为准。作者：CallMeSUCH。</p>
      </body></html>`;
  }

  function downloadReport() {
    if (!state.result) return;
    const html = buildReportHTML(state.result);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `判据报告_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('报告已下载（可用浏览器打开后打印为 PDF）');
  }

  // ---------- terms ----------
  function termsView() {
    const cats = ['全部', ...Array.from(new Set(state.data.terms.map(t => t.category)))];
    return `
      <section class="section" style="margin-top:24px" data-edit-id="terms">
        <div class="section-head" data-edit-id="terms-head">
          <div>
            <div class="section-kicker">知识库</div>
            <h2>气象知识判据卡</h2>
            <p>包含：基础定义、时间尺度、数值、等价换算、相关知识、常见误用、标准依据。</p>
          </div>
        </div>
        <div class="toolbar" data-edit-id="terms-toolbar">
          <input id="term-search" class="search-input" type="search" placeholder="搜索：极大、最大、特大暴雨、17级、百年一遇、厄尔尼诺……" value="${escapeHTML(state.termQuery)}" />
          <div class="sample-row" style="margin:0">
            ${cats.map(c => `<button class="chip ${c === state.termCat ? 'hot' : ''}" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('')}
          </div>
        </div>
        <div id="term-grid" class="term-grid" data-edit-id="term-grid"></div>
      </section>`;
  }

  function bindTerms() {
    const input = $('#term-search');
    input?.addEventListener('input', () => {
      state.termQuery = input.value;
      renderTermGrid();
    });
    $$('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.termCat = btn.dataset.cat;
        $$('[data-cat]').forEach(b => b.classList.toggle('hot', b.dataset.cat === state.termCat));
        renderTermGrid();
      });
    });
    renderTermGrid();
  }

  function renderTermGrid() {
    const grid = $('#term-grid');
    if (!grid) return;
    const q = state.termQuery.trim().toLowerCase();
    const list = state.data.terms.filter(t => {
      const catOk = state.termCat === '全部' || t.category === state.termCat;
      const text = [t.term, ...(t.aliases || []), t.definition, t.category].join(' ').toLowerCase();
      return catOk && (!q || text.includes(q));
    });
    grid.innerHTML = list.length
      ? list.map(renderTermCard).join('')
      : `<div class="notice info">没有匹配的词。试试“极大”“特大暴雨”“百年一遇”“厄尔尼诺”。</div>`;
  }

  // ---------- cases ----------
  function casesView() {
    return `
      <section class="section" style="margin-top:24px">
        <div class="section-head">
          <div>
            <div class="section-kicker">案例库</div>
            <h2>真实说法，不同判据路径</h2>
            <p>北京暴雨是“精确声明”，厄尔尼诺是“感官声明”；都不适合用“真/假”两个字打发。</p>
          </div>
        </div>
        <div class="case-grid">
          ${state.data.cases.filter(c => !c.hidden).map(c => caseCard(c)).join('')}
        </div>
        <div class="panel" style="margin-top:16px">
          <div class="card-head"><h3>案例对照</h3><span class="small">口径 × 证据</span></div>
          <table class="table">
            <thead><tr><th>案例</th><th>口径完整度</th><th>证据支持度</th><th>判定</th><th>关键缺口</th></tr></thead>
            <tbody>
              <tr><td>北京“最大暴雨”</td><td>高</td><td>部分</td><td><span class="tag">B</span></td><td>24h 窗口、站网、1959 基准</td></tr>
              <tr><td>“最强超强厄尔尼诺”</td><td>中低</td><td>高</td><td><span class="tag">B</span></td><td>候/旬/月/ONI、预测当事实、生成图</td></tr>
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function bindCases() {
    $$('[data-case]').forEach(btn => {
      btn.addEventListener('click', () => openCase(btn.dataset.case));
    });
  }

  // ---------- sources ----------
  function sourcesView() {
    const groups = [
      { level: 'L1', title: '国家级业务 / 标准 / 法规', desc: '最高优先级；能直接作为判据依据。' },
      { level: 'L2', title: '国际权威', desc: '用于交叉验证与全球对比。' },
      { level: 'L3', title: '学术文献', desc: '只用于方法，不用于事实判定。' },
      { level: 'L4', title: '媒体 / 自媒体', desc: '只能作为“待核对象”，不能作为证据。' },
      { level: 'L5', title: '商业聚合 / 可视化', desc: '可作地图展示与辅助参考，不作为官方观测判据。' },
      { level: 'L6', title: '科学数据中心 / 科研数据', desc: '科研数据集，常用于长期背景/空间分析；需注册或申请，不等同于业务观测。' }
    ];
    const typeClass = (type) => ({
      '实时': 'live',
      '开放接口': 'open',
      '待接': 'pending',
      '需登录': 'login',
      '离线知识库': 'offline'
    }[type] || 'link');
    const adapters = state.data.adapters || [];
    return `
      <section class="section" style="margin-top:24px">
        <div class="section-head">
          <div>
            <div class="section-kicker">信源库</div>
            <h2>从哪里查，按什么等级信</h2>
            <p>每条证据写：网址 + 访问日期 + 原文/数据 + 发布机构。</p>
          </div>
        </div>

        <div class="panel" style="margin-bottom:14px">
          <div class="card-head">
            <h3>已接入的数据查询</h3>
            <span class="small">本地接口需后端 8766</span>
          </div>
          <table class="table">
            <thead><tr><th>数据</th><th>提供方</th><th>类型</th><th>官方页面</th><th>本地接口</th><th>说明</th></tr></thead>
            <tbody>
              ${adapters.map(a => `
                <tr>
                  <td><b>${escapeHTML(a.name)}</b><br><span class="small muted">${escapeHTML(a.data)}</span></td>
                  <td>${escapeHTML(a.provider)}</td>
                  <td><span class="type-badge ${typeClass(a.type)}">${escapeHTML(a.type)}</span></td>
                  <td><a href="${escapeHTML(a.official_url)}" target="_blank" rel="noopener">${escapeHTML(a.official_url)}</a></td>
                  <td>${a.app_endpoint ? `<code>${escapeHTML(a.app_endpoint)}</code>` : '—'}</td>
                  <td class="small muted">${escapeHTML(a.note)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <p class="small muted" style="margin-top:8px">“实时”=可自动查询；“开放接口”=可查但不是中国官方站点；“待接”=有官方数据但未接；“需登录”=需账号/权限；“离线知识库”=预抽取标准。</p>
        </div>

        ${groups.map(g => {
          const list = state.data.sources.filter(s => s.level === g.level);
          if (!list.length) return '';
          return `
            <div class="panel" style="margin-bottom:14px">
              <div class="card-head">
                <h3><span class="level ${g.level}">${g.level}</span> ${escapeHTML(g.title)}</h3>
                <span class="small">${escapeHTML(g.desc)}</span>
              </div>
              <table class="table">
                <thead><tr><th>来源</th><th>用途</th><th>网址</th></tr></thead>
                <tbody>
                  ${list.map(s => `<tr><td>${escapeHTML(s.name)}</td><td>${escapeHTML(s.use)}</td><td><a href="${escapeHTML(s.url)}" target="_blank" rel="noopener">${escapeHTML(s.url)}</a></td></tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        }).join('')}
      </section>`;
  }

  // ---------- method ----------
  function methodView() {
    const groups = [
      { title: 'A. 语义层', items: ['术语混用：极大/最大/阵风/平均', '等级混用：17级/超强台风；暴雨/特大暴雨', '词义模糊：极寒/最严重/罕见', '单位换算：m/s、km/h、级、mm', '同义词陷阱：最强 vs 最严重'] },
      { title: 'B. 时空层', items: ['时间尺度：1h/24h/过程；3s/1min/2min/10min', '时段限定：夏季/非夏季、汛期/非汛期、雨季/非雨季、上半年/下半年', '时态：巅峰/登陆/影响', '空间：单站/全市/全省/全球', '基准期：今年/30年/1959以来', '观测/预测/影响'] },
      { title: 'C. 证据层', items: ['来源权威性：官方/自媒体/模型', '数据版本：ONI vs Niño3.4', '不确定性与样本：集合/概率'] },
      { title: 'D. 逻辑层', items: ['比较不成立：不同指标/时段/范围', '因果错配：相关≠因果', '概率误读：百年一遇'] },
      { title: 'E. 传播层', items: ['标题党：删掉“或/可能”', '视觉误导：AI图/旧图/裁图例', '以偏概全：单站/单次/幸存者偏差'] }
    ];
    return `
      <section class="section" style="margin-top:24px">
        <div class="section-head">
          <div>
            <div class="section-kicker">方法</div>
            <h2>先找漏洞，再翻词典，最后查官网</h2>
            <p>不争“谁在造谣”，只回答“这句话在什么条件下成立”。</p>
          </div>
        </div>

        <div class="panel" style="margin-bottom:14px">
          <div class="card-head"><h3>判定五级</h3><span class="small">A–E</span></div>
          <table class="table">
            <thead><tr><th>等级</th><th>含义</th><th>典型</th></tr></thead>
            <tbody>
              <tr><td><span class="tag">A</span></td><td>成立：术语、口径、证据都支持</td><td>24h 260 mm，达特大暴雨</td></tr>
              <tr><td><span class="tag">B</span></td><td>条件成立：某种口径下成立</td><td>巅峰 17 级成立；登陆 17 级待查</td></tr>
              <tr><td><span class="tag">C</span></td><td>术语/逻辑不成立</td><td>1 小时“特大暴雨”；18 级</td></tr>
              <tr><td><span class="tag">D</span></td><td>信息不足：缺关键口径/证据</td><td>“史上最强台风”</td></tr>
              <tr><td><span class="tag">E</span></td><td>与事实不符</td><td>最佳路径登陆 14 级，传说 17 级</td></tr>
            </tbody>
          </table>
        </div>

        <div class="method-grid">
          ${groups.map(g => `
            <div class="check-group">
              <h4>${escapeHTML(g.title)}</h4>
              <ol>${g.items.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</ol>
            </div>`).join('')}
        </div>

        <div class="panel" style="margin-top:14px">
          <div class="card-head"><h3>技术路线</h3><span class="small">不依赖在线 AI</span></div>
          <p class="small muted">
            信源库 + 定时采集 + 本地缓存 + 规则引擎。运行时只查本地缓存/官方 API；报告给出原始网址、访问日期、快照。
          </p>
          <pre style="overflow:auto;background:#f8fbfd;border:1px solid #eaf0f6;border-radius:10px;padding:14px;font-size:12px;line-height:1.6">输入（文字/图片/URL）
  → OCR（Windows 本地，已接） + 图表识别（待接） + 句子拆解
  → 智能归类（现象/参数/模糊词/句子类型）
  → 逻辑漏洞检查（19 项，MVP 14 项）
  → 决策树补问（时间/地点/来源）
  → 知识库（术语/阈值/等级）
  → 数据网关（本地缓存/官方 API）
  → 验证（单位/口径/交叉源/物理一致性）
  → A–E + 置信度 + 成立条件
  → 报告（含官方网址/访问日期/快照）</pre>
          <p class="verdict-note">AI 只用于开发阶段的文献抽取、代码生成、测试用例；运行时判定由规则引擎完成，保证可复现、可审计。</p>
        </div>

        <div class="panel" style="margin-top:14px">
          <div class="card-head"><h3>规则自测</h3><span class="small">MVP 回归测试</span></div>
          <p class="small muted">用 ${state.data.testset?.length || 0} 条固定说法检查规则是否按预期判定；这是回归测试，不是正式验证集。</p>
          <button class="btn btn-soft btn-sm" id="run-tests">运行自测</button>
          <div id="test-result" style="margin-top:10px"></div>
        </div>

        <div class="panel" style="margin-top:14px">
          <div class="card-head"><h3>局限</h3><span class="small">必须写进作品</span></div>
          <ul class="conditions">
            <li>本原型已接公开实时/历史数据；CMA 站点档案需账号/权限，不能用再分析冒充官方观测。</li>
            <li>标准会更新；引用需注明年份/版本。</li>
            <li>“正确”是条件性的；信息不足时判 D，不强行下结论。</li>
            <li>测试集不是全网代表样本；需在正式版扩到 50–100 条。</li>
          </ul>
        </div>
      </section>`;
  }

  // ---------- method self-test ----------
  function bindMethod() {
    $('#run-tests')?.addEventListener('click', runSelfTests);
  }

  function runSelfTests() {
    const box = $('#test-result');
    if (!box) return;
    const items = state.data.testset || [];
    const rows = items.map(item => {
      const ex = extract(item.claim);
      const meta = {
        publish_time: '',
        event_time: ex.time_raw !== '未说明' ? ex.time_raw : '',
        time_window: ex.time_window,
        time_scale: ex.time_scale,
        location: ex.location_raw,
        location_level: ex.location_level,
        source_url: ex.source_url,
        claim_type: ex.claim_type
      };
      const r = analyze(item.claim, meta, item.caseId || null);
      const ok = r.verdict === item.expected;
      return {
        claim: item.claim,
        expected: item.expected,
        actual: r.verdict,
        ok,
        note: item.note
      };
    });
    const pass = rows.filter(r => r.ok).length;
    const allOk = pass === rows.length;
    box.innerHTML = `
      <div class="notice ${allOk ? 'info' : 'warn'}">
        自测结果：<b>${pass} / ${rows.length}</b> 通过。
        ${allOk ? '规则与预期一致。' : '有偏差，说明规则或预期需要校准。'}
      </div>
      <table class="table" style="margin-top:8px">
        <thead><tr><th>说法</th><th>预期</th><th>实际</th><th>结果</th><th>备注</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHTML(r.claim)}</td>
              <td><b>${escapeHTML(r.expected)}</b></td>
              <td><b>${escapeHTML(r.actual)}</b></td>
              <td>${r.ok ? '<span class="tag">通过</span>' : '<span class="tag" style="background:var(--bad-soft);color:var(--bad)">偏差</span>'}</td>
              <td class="small muted">${escapeHTML(r.note || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ---------- start ----------
  boot();
})();
