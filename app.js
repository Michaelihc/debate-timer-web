/* Debate Timer – web port of https://github.com/Michaelihc/debate-timer */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Defaults, i18n, storage
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = "debate-timer-save";
  const DEFAULT_AUDIO = {
    warning: "assets/audio/warning.wav",
    end: "assets/audio/bell.ogg",
  };

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------
  // A preset is the round itself: topic, both teams (name, colour, speakers),
  // the order of speeches and its times. Language, timer format, background and
  // sounds belong to this screen, not to the round, so presets leave them alone.
  // A preset file is a save file holding only those fields plus a name and icon.
  const ROUND_SETTINGS = [
    "pro_label",
    "con_label",
    "pro_label_zh",
    "con_label_zh",
    "pro_colors",
    "con_colors",
    "time_warning",
    "warning_tone",
    "extra_cues",
    "time_grace",
    "overtime_cap",
    "time_prep",
    "time_free",
    "free_exclusive",
  ];
  // Bells: the two sound files, or a knock played by the browser.
  const TONES = ["warning", "end", "soft", "single", "double", "triple"];
  const EV_KINDS = ["speech", "prep", "free", "shared", "break"];
  // Shared clocks (e.g. crossfire) and breaks have no setting of their own to fall back on.
  const KIND_DEFAULT_TIME = { shared: 180, break: 300 };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const CN_NUM = "一二三四五六七八九十";
  // Default speaker names follow the screen language: 正一 / 反一 in Chinese,
  // Pro 1 / Con 1 in English. A speaker saved with an empty name uses them.
  function defaultSpeakerName(side, i, lang) {
    if (lang === "zh") return (side === "pro" ? "正" : "反") + (i < CN_NUM.length ? CN_NUM[i] : String(i + 1));
    return (side === "pro" ? "Pro " : "Con ") + (i + 1);
  }
  const isDefaultName = (side, i, name) =>
    name === defaultSpeakerName(side, i, "zh") || name === defaultSpeakerName(side, i, "en");
  const team = (side, times) => times.map((time) => ({ name: "", time }));

  function makeRound(o) {
    return {
      title: "",
      title_zh: "",
      settings: {
        pro_label: "",
        con_label: "",
        pro_label_zh: "",
        con_label_zh: "",
        pro_colors: "#0000FF",
        con_colors: "#FF0000",
        time_warning: o.warning,
        warning_tone: "warning",
        extra_cues: [],
        time_grace: 0,
        overtime_cap: 300,
        time_prep: o.prep,
        time_free: o.free,
        free_exclusive: false,
      },
      pro_side: team("pro", o.times),
      con_side: team("con", o.times),
      event_order: o.order,
    };
  }

  const BUILTIN_PRESETS = [
    {
      id: "builtin:default",
      builtin: true,
      icon: "⚖️",
      nameKey: "presetDefault",
      round: makeRound({ times: [180, 120, 120, 180], order: [1, -1, -2, 3, 2, -3, "free", 4, -4], warning: 30, prep: 300, free: 300 }),
    },
    {
      id: "builtin:round_robin",
      builtin: true,
      icon: "⚡",
      nameKey: "presetRoundRobin",
      round: makeRound({ times: [120, 60, 60, 120], order: [1, -1, 2, -2, 3, -3, 4, -4], warning: 15, prep: 300, free: 300 }),
    },
  ];

  // The round part of a save, as a fresh copy.
  function roundOf(save) {
    const settings = {};
    ROUND_SETTINGS.forEach((k) => (settings[k] = save.settings[k]));
    return clone({
      title: save.title,
      title_zh: save.title_zh || "",
      settings,
      pro_side: save.pro_side,
      con_side: save.con_side,
      event_order: save.event_order,
    });
  }

  // Loads a round into a save. A round without a topic keeps the current one.
  function applyRound(save, round) {
    const r = clone(round);
    Object.assign(save.settings, r.settings);
    if (r.title) {
      save.title = r.title;
      save.title_zh = r.title_zh || "";
    }
    save.pro_side = r.pro_side;
    save.con_side = r.con_side;
    save.event_order = r.event_order;
  }

  // True when the save is set up exactly like the preset (its topic too, if it has one).
  function presetMatches(preset, save) {
    const key = (r, withTitle) =>
      JSON.stringify([
        ROUND_SETTINGS.map((k) => r.settings[k]),
        r.pro_side,
        r.con_side,
        r.event_order,
        withTitle ? [r.title, r.title_zh || ""] : "",
      ]);
    const withTitle = Boolean(preset.round.title);
    return key(preset.round, withTitle) === key(save, withTitle);
  }

  // Chinese if the browser's preferred language is Chinese, otherwise English.
  function browserLang() {
    try {
      const l = (navigator.languages && navigator.languages[0]) || navigator.language || "";
      return /^zh\b/i.test(l) ? "zh" : "en";
    } catch (_) {
      return "en";
    }
  }

  const DEFAULT_SAVE = {
    title: "",
    title_zh: "",
    settings: {
      background_color: "#000000",
      display_minutes: true,
      language: browserLang(),
      sound: true,
      audio_warning: "",
      audio_end: "",
      advance_starts: true,
      overtime: false,
    },
  };
  applyRound(DEFAULT_SAVE, BUILTIN_PRESETS[0].round);
  const DEFAULT_TEXT = JSON.stringify(DEFAULT_SAVE, null, 2);

  // ---------------------------------------------------------------------------
  // Parts of the round
  // ---------------------------------------------------------------------------
  // An entry in event_order is a speaker number (1 is Pro 1, -2 is Con 2),
  // "prep" or "free", or an object for a part with settings of its own:
  //   { speaker: 1, time, protected, cues, label, label_zh }      a speech
  //   { kind: "prep", side: "pro" | "con", time, cues, label, label_zh }
  //   { kind: "free", first: "pro" | "con", time, cues, label, label_zh }  (time per team)
  //   { kind: "shared", live: ["pro"], time, cues, label, label_zh }      one clock, e.g. crossfire
  //   { kind: "break", time, cues, label, label_zh }
  // Anything left out falls back to the round's settings. `cues` replaces the
  // round's warnings for that part; an empty list means no warnings at all.
  function evKind(ev) {
    if (ev === "prep" || ev === "free") return ev;
    if (typeof ev === "number") return "speech";
    if (ev && typeof ev === "object") return ev.kind || "speech";
    return null;
  }
  const evOpts = (ev) => (ev && typeof ev === "object" ? ev : {});
  const evSpeaker = (ev) => (evKind(ev) !== "speech" ? null : typeof ev === "number" ? ev : Number(ev.speaker));
  // The long form of an entry, as a fresh object to edit.
  function expandEvent(ev) {
    if (typeof ev === "number") return { speaker: ev };
    if (ev === "prep" || ev === "free") return { kind: ev };
    return clone(ev);
  }

  const secs = (v) => Math.max(0, Math.round(Number(v) || 0));
  function normalizeCues(arr) {
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((c) => c && typeof c === "object")
      .map((c) => ({ at: Math.max(1, secs(c.at)), tone: TONES.includes(c.tone) ? c.tone : "warning" }));
  }

  // Cleans one entry, and writes it the short way when it has nothing of its own.
  function normalizeEvent(e) {
    if (e === "prep" || e === "free") return e;
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      const n = Number(e);
      return Number.isInteger(n) && n !== 0 ? n : null;
    }
    const kind = e.kind || (e.speaker != null ? "speech" : null);
    if (!EV_KINDS.includes(kind)) return null;
    const o = kind === "speech" ? {} : { kind };
    if (kind === "speech") {
      const n = Number(e.speaker);
      if (!Number.isInteger(n) || n === 0) return null;
      o.speaker = n;
    }
    if (e.time != null && e.time !== "") o.time = secs(e.time);
    if (kind === "speech" && secs(e.protected) > 0) o.protected = secs(e.protected);
    if (kind === "prep" && (e.side === "pro" || e.side === "con")) o.side = e.side;
    if (kind === "free" && (e.first === "pro" || e.first === "con")) o.first = e.first;
    if (kind === "shared" && Array.isArray(e.live)) {
      const live = ["pro", "con"].filter((s) => e.live.includes(s));
      if (live.length === 1) o.live = live;
    }
    const cues = normalizeCues(e.cues);
    if (cues) o.cues = cues;
    if (e.label) o.label = String(e.label);
    if (e.label_zh) o.label_zh = String(e.label_zh);
    const own = Object.keys(o).filter((k) => k !== "kind" && k !== "speaker");
    if (!own.length && kind === "speech") return o.speaker;
    if (!own.length && (kind === "prep" || kind === "free")) return kind;
    return o;
  }

  function speakerOf(d, id) {
    if (id > 0) return d.pro_side[id - 1] || null;
    if (id < 0) return d.con_side[-id - 1] || null;
    return null;
  }

  // How long a part runs (per team, for free debate).
  function evTime(d, ev) {
    const o = evOpts(ev);
    if (o.time != null) return o.time;
    const k = evKind(ev);
    if (k === "prep") return d.settings.time_prep;
    if (k === "free") return d.settings.time_free;
    if (k === "shared" || k === "break") return KIND_DEFAULT_TIME[k];
    const p = speakerOf(d, evSpeaker(ev));
    return p ? p.time : 0;
  }

  // The team a part belongs to, if it belongs to one.
  function evSide(ev) {
    const k = evKind(ev);
    const o = evOpts(ev);
    if (k === "speech") return evSpeaker(ev) > 0 ? "pro" : "con";
    if (k === "prep") return o.side || null;
    if (k === "shared") return o.live && o.live.length === 1 ? o.live[0] : null;
    return null;
  }

  function evColor(d, ev) {
    const side = evSide(ev);
    if (side) return side === "pro" ? d.settings.pro_colors : d.settings.con_colors;
    return { prep: "var(--lime)", free: "var(--yellow)", shared: "var(--violet)", break: "var(--grey)" }[evKind(ev)] || "var(--grey)";
  }

  // The warnings a part rings: its own, or the round's.
  function cuesFor(d, ev) {
    const o = evOpts(ev);
    if (o.cues) return o.cues.slice();
    const s = d.settings;
    const first = s.time_warning > 0 ? [{ at: s.time_warning, tone: s.warning_tone }] : [];
    return first.concat(s.extra_cues);
  }

  const I18N = {
    en: {
      menu: "Settings",
      menuTitle: "Settings (S)",
      reload: "Reload Scene",
      begin: "Begin",
      next: "Next",
      save: "Save",
      saveApply: "Save & Apply",
      done: "Done",
      discard: "Discard changes",
      reset: "Reset",
      resetDefaults: "Reset to defaults",
      pause: "Pause",
      resume: "Resume",
      start: "Start",
      invert: "Invert",
      editSave: "Settings",
      timeout: "Time ran out",
      prep: "Preparation Time",
      free: "Free Debate Time",
      ended: "Debate Ended",
      close: "Close",
      download: "Download settings file",
      upload: "Open settings file…",
      langBtn: "中文",
      invalidJson: "The settings file has a mistake: ",
      proDefault: "Pro",
      conDefault: "Con",
      speakerTurn: (name) => `${name}’s Turn`,
      idleHint: "Press {begin} when the first speaker is ready.",
      firstUp: "First up",
      roundTotal: (n, min) => `${n} ${n === 1 ? "part" : "parts"} · about ${min} min in all`,
      invertTitle: "Invert (I)",
      timelineTitle: "Order of speeches",
      back: "Back",
      motion: "Motion",
      partOf: (i, n) => `Part ${i} of ${n}`,
      backTitle: "Back (P)",
      prepShort: "Prep",
      freeShort: "Free debate",
      eachSide: (time) => `${time} each`,
      minutes: "Minutes",
      seconds: "Seconds",
      minShort: "min",
      secShort: "sec",
      // navigation
      navPresets: "Presets",
      navDebate: "Teams & speakers",
      navOrder: "Order & times",
      navDisplay: "Display & sound",
      navAdvanced: "Advanced",
      // presets page
      presetsTitle: "Presets",
      presetsIntro: "A preset is a ready-made round: the teams, speakers, order and times. Click one to load it, then press Save & Apply.",
      currentSetup: "Current setup",
      customSetup: "Custom setup",
      saveAsPreset: "Save as preset",
      builtinPresets: "Built in",
      myPresets: "My presets",
      openPresetFile: "Open preset file…",
      noPresets: "No saved presets yet. Set up a round the way you like it, then press “Save as preset”.",
      inUse: "In use",
      usePreset: "Click to load",
      editPreset: "Rename",
      downloadPreset: "Download file",
      deletePreset: "Delete",
      presetDefault: "Default",
      presetRoundRobin: "Round robin (quick)",
      summary: (n, min) => `${n} ${n === 1 ? "speech" : "speeches"} · about ${min} min`,
      presetLoaded: (name) => `Loaded “${name}”.`,
      presetSaved: (name) => `Saved preset “${name}”.`,
      presetsAdded: (n) => `Added ${n} ${n === 1 ? "preset" : "presets"}.`,
      presetImportFailed: "Could not open: ",
      notAPreset: "no speakers found",
      newPresetName: "My preset",
      newPresetTitle: "Save as preset",
      savePreset: "Save preset",
      newPresetText: "Saves the teams, speakers, order and times so you can load them again later.",
      editPresetTitle: "Edit preset",
      editPresetText: "Change the name or icon.",
      deletePresetTitle: (name) => `Delete “${name}”?`,
      deletePresetText: "This removes the preset from this browser. Download it first if you might need it again.",
      pdName: "Name",
      pdIcon: "Icon",
      pdUpdate: "Also replace what it holds with the current setup",
      // teams page
      debateTitle: "Teams & speakers",
      debateIntro: "Set the topic, name each team, and list who speaks and for how long.",
      fTitle: "Topic",
      fTitlePlaceholder: "Shown at the top of the screen",
      fProSide: "Pro team name",
      fConSide: "Con team name",
      fColor: "Team colour",
      fName: "Name",
      fSpeakingTime: "Speaking time",
      fAdd: "Add speaker",
      fRemove: "Remove",
      noSpeakers: "No speakers yet.",
      notInOrder: "Not in order",
      notInOrderHint: "This speaker never speaks. Add them under Order & times.",
      // order page
      orderTitle: "Order & times",
      orderIntro: "Choose who speaks when, and set the other timers.",
      fEvents: "Order of speeches",
      fEventsHint: "Drag to reorder. Click an item below to add it to the end.",
      viewSimple: "Compact",
      viewDetailed: "Detailed",
      perSide: "per side",
      fAddLabel: "Add",
      fPhases: "Phases",
      fEmptyOrder: "Nothing here yet. Click an item below to add it.",
      fNoSpeaker: "Speaker does not exist",
      orderTotal: (n, min) => `${n} ${n === 1 ? "part" : "parts"} · about ${min} min`,
      orderAlternate: "Alternate Pro and Con",
      orderAlternateTitle: "Replace the order?",
      orderAlternateText: "The order becomes Pro 1, Con 1, Pro 2, Con 2 and so on, with no preparation or free debate.",
      orderClear: "Clear",
      orderClearTitle: "Clear the order?",
      orderClearText: "Removes every item from the order of speeches.",
      fTimes: "Other timers",
      fWarning: "Warning",
      fWarningHint: "A sound plays when this much time is left.",
      fPrep: "Preparation",
      fPrepHint: "Length of each preparation phase.",
      fFree: "Free debate",
      fFreeHint: "Time for each team in free debate.",
      // display page
      displayTitle: "Display & sound",
      displayIntro: "How the timer looks and sounds on this screen. Presets don't change these.",
      fScreen: "Screen",
      fLanguage: "Language",
      fClock: "Timer shows",
      clockMinutes: "Minutes (3:00)",
      clockSeconds: "Seconds (180)",
      fBackground: "Background colour",
      fSounds: "Sounds",
      fWarningSound: "Warning sound",
      fEndSound: "Time's up sound",
      fBuiltinSound: "Built-in sound (or paste a link)",
      fUploadedFile: "Your sound file",
      fChooseFile: "Choose file…",
      fDefault: "Default",
      fPlay: "Play",
      fFileTooBig: "That sound file is too large (2 MB max). Paste a link to it instead.",
      fCannotPlay: "Could not play that sound. Check the link or choose another file.",
      // advanced page
      advancedTitle: "Advanced",
      advancedIntro: "Tools for experienced users. You never need these to run a debate.",
      fJson: "Settings file (JSON)",
      fJsonHint: "Everything on the other pages, as text. Edits here show up there too.",
      fShortcuts: "Keyboard shortcuts",
      kSpace: "Pause or resume the timer",
      kNext: "Next speech",
      kPrev: "Previous speech",
      kInvert: "Switch sides in free debate",
      kFull: "Full screen",
      kSettings: "Open settings",
      kSave: "Save & Apply (in settings)",
      kEsc: "Close settings or a dialog",
      fReset: "Start over",
      fResetHint: "Puts every setting back to how it was the first time you opened the timer. Your saved presets are kept.",
      resetTitle: "Reset all settings?",
      resetText: "Every setting goes back to its default. Nothing changes until you press Save & Apply.",
      // footer and prompts
      unsavedNote: "Unsaved changes.",
      unsavedRestart: "Unsaved changes. Saving restarts the debate in progress.",
      unsavedTitle: "Save your changes?",
      unsavedText: "You changed the settings. Save and apply them?",
      invalidTitle: "The settings file has a mistake",
      invalidText: "The text on the Advanced page can't be read, so it can't be saved. Throw away the changes?",
      keepEditing: "Keep editing",
      reloadTitle: "Restart the debate?",
      reloadText: "A debate is in progress. Reload Scene resets it to the beginning.",
      reloadConfirm: "Reload",
      cancel: "Cancel",
      saveFailed: "Could not save (storage full?): ",
      invalidEvents: "The order of speeches includes speakers who don't exist: ",
      fullscreen: "Fullscreen (F)",
      // restored part and timing settings
      prepOf: (team) => `${team} preparation`,
      shared: "Shared time",
      sharedShort: "Shared",
      breakName: "Break",
      protectedNow: "Protected time",
      partTitle: (i, name) => `Part ${i}: ${name}`,
      partSettings: "Settings for this part",
      partCustom: "Has its own settings",
      pTime: "Time",
      pTimePerTeam: "Time for each team",
      pUsualTime: (time) => `Usual time (${time})`,
      pSpeakerTime: (name, time) => `${name}'s time (${time})`,
      pOwnTime: "Own time for this part",
      pThisSpeech: "This speech only",
      pTimeHint: "Changes only this part. The usual time is set on the other pages.",
      pProtected: "Protected time",
      pProtectedHint: "A single knock this long after the start and again this long before the end. 0 means none.",
      pPrepFor: "Preparation for",
      pBothTeams: "Both teams",
      pFirst: "Who starts",
      pOperator: "Operator chooses",
      pFirstHint: "That team's clock starts with the part, or when you press Space.",
      pLive: "Who speaks",
      pLabel: "Name",
      pLabelZh: "Name in Chinese",
      pLabelHint: "Replaces the usual name. The Chinese name is used when the screen is in Chinese.",
      pCues: "Warnings",
      pCuesRound: "Same as the round",
      pCuesOwn: "Own warnings",
      cuesNone: "No warnings.",
      cueAdd: "Add warning",
      cueLeft: "left",
      cueTone: "Tone",
      toneWarning: "Warning sound",
      toneEnd: "Time's up sound",
      toneSoft: "Soft knock",
      toneSingle: "Single knock",
      toneDouble: "Double knock",
      toneTriple: "Triple knock",
      fBells: "Warnings and bells",
      fBellsHint: "What rings, and when, in every part that has no warnings of its own.",
      fWarningTone: "Warning tone",
      fMoreWarnings: "More warnings",
      fMoreWarningsHint: "Each rings once when that much time is left. The ring turns yellow at the earliest one.",
      fGrace: "Grace bell",
      fGraceHint: "A triple knock this long after time runs out. 0 means none.",
      fBehaviour: "Timing behaviour",
      fAdvance: "When you press Next",
      advStart: "Start the clock",
      advPause: "Load it paused",
      fAdvanceHint: "Paused: the next part waits at its full time until you press Start or Space.",
      fFreeClocks: "Free debate clocks",
      freeBoth: "Both may run at once",
      freeOne: "One team at a time",
      fFreeClocksHint: "One team at a time: starting one team's clock pauses the other.",
      fOvertime: "When time runs out",
      otStop: "Stop at zero",
      otCount: "Count overtime",
      fOvertimeHint: "Overtime counts up in red, e.g. +0:12.",
      fCap: "Stop bells after",
      fCapHint: "No bell rings once a part is this far over time, the grace bell included.",
      fBilingual: "Chinese names",
      fBilingualHint: "Shown instead of the usual names when the screen is in Chinese. Leave empty to use the same names in both languages.",
      fTitleZh: "Topic in Chinese",
      fProZh: "Pro team name in Chinese",
      fConZh: "Con team name in Chinese",
      fSoundOn: "Play sounds",
      on: "On",
      off: "Off",
    },
    zh: {
      menu: "设置",
      menuTitle: "设置 (S)",
      reload: "刷新",
      begin: "开始",
      next: "下一项",
      save: "保存",
      saveApply: "保存并应用",
      done: "完成",
      discard: "放弃更改",
      reset: "重置",
      resetDefaults: "恢复默认",
      pause: "暂停",
      resume: "继续",
      start: "开始",
      invert: "翻转",
      editSave: "设置",
      timeout: "时间到",
      prep: "准备时间",
      free: "自由辩论",
      ended: "辩论结束",
      close: "关闭",
      download: "下载设置文件",
      upload: "打开设置文件…",
      langBtn: "English",
      invalidJson: "设置文件有错误：",
      proDefault: "正方",
      conDefault: "反方",
      speakerTurn: (name) => `辩手 ${name} 发言`,
      idleHint: "第一位辩手准备好后，按{begin}。",
      firstUp: "第一项",
      roundTotal: (n, min) => `共 ${n} 项 · 全程约 ${min} 分钟`,
      invertTitle: "翻转 (I)",
      timelineTitle: "发言顺序",
      back: "上一项",
      motion: "辩题",
      partOf: (i, n) => `第 ${i} / ${n} 项`,
      backTitle: "上一项 (P)",
      prepShort: "准备",
      freeShort: "自由辩论",
      eachSide: (time) => `每方 ${time}`,
      minutes: "分钟",
      seconds: "秒",
      minShort: "分",
      secShort: "秒",
      navPresets: "预设",
      navDebate: "队伍与辩手",
      navOrder: "流程与时间",
      navDisplay: "显示与声音",
      navAdvanced: "高级",
      presetsTitle: "预设",
      presetsIntro: "预设是一套现成的赛制：队伍、辩手、流程和时间。点击即可载入，然后按“保存并应用”。",
      currentSetup: "当前设置",
      customSetup: "自定义设置",
      saveAsPreset: "存为预设",
      builtinPresets: "内置",
      myPresets: "我的预设",
      openPresetFile: "打开预设文件…",
      noPresets: "还没有保存的预设。按需要设置好比赛后，点击“存为预设”。",
      inUse: "使用中",
      usePreset: "点击载入",
      editPreset: "重命名",
      downloadPreset: "下载文件",
      deletePreset: "删除",
      presetDefault: "默认",
      presetRoundRobin: "循环赛（快速）",
      summary: (n, min) => `${n} 次发言 · 约 ${min} 分钟`,
      presetLoaded: (name) => `已载入“${name}”。`,
      presetSaved: (name) => `已保存预设“${name}”。`,
      presetsAdded: (n) => `已添加 ${n} 个预设。`,
      presetImportFailed: "无法打开：",
      notAPreset: "没有找到辩手",
      newPresetName: "我的预设",
      newPresetTitle: "存为预设",
      savePreset: "保存预设",
      newPresetText: "保存队伍、辩手、流程和时间，以后可以再次载入。",
      editPresetTitle: "编辑预设",
      editPresetText: "修改名称或图标。",
      deletePresetTitle: (name) => `删除“${name}”？`,
      deletePresetText: "将从此浏览器中删除该预设。如果以后可能还要用，请先下载。",
      pdName: "名称",
      pdIcon: "图标",
      pdUpdate: "同时用当前设置替换其内容",
      debateTitle: "队伍与辩手",
      debateIntro: "填写辩题、队伍名称，以及每位辩手的发言时间。",
      fTitle: "辩题",
      fTitlePlaceholder: "显示在屏幕顶部",
      fProSide: "正方名称",
      fConSide: "反方名称",
      fColor: "队伍颜色",
      fName: "姓名",
      fSpeakingTime: "发言时间",
      fAdd: "添加辩手",
      fRemove: "删除",
      noSpeakers: "还没有辩手。",
      notInOrder: "未排入流程",
      notInOrderHint: "该辩手不会发言。请在“流程与时间”中添加。",
      orderTitle: "流程与时间",
      orderIntro: "安排发言顺序，并设置其他计时。",
      fEvents: "发言顺序",
      fEventsHint: "拖动调整顺序。点击下方项目添加到末尾。",
      viewSimple: "简洁",
      viewDetailed: "详细",
      perSide: "每方",
      fAddLabel: "添加",
      fPhases: "环节",
      fEmptyOrder: "暂无流程，点击下方项目添加。",
      fNoSpeaker: "辩手不存在",
      orderTotal: (n, min) => `共 ${n} 项 · 约 ${min} 分钟`,
      prepOf: (team) => `${team}准备时间`,
      shared: "共用计时",
      sharedShort: "共用",
      breakName: "休息",
      protectedNow: "保护时间",
      partTitle: (i, name) => `第 ${i} 项：${name}`,
      partSettings: "本项设置",
      partCustom: "有单独设置",
      pTime: "时长",
      pTimePerTeam: "每方时长",
      pUsualTime: (time) => `默认时长（${time}）`,
      pSpeakerTime: (name, time) => `${name}的时长（${time}）`,
      pOwnTime: "本项单独设置",
      pThisSpeech: "仅本次发言",
      pTimeHint: "只改变这一项。默认时长在其他页面设置。",
      pProtected: "保护时间",
      pProtectedHint: "开始后和结束前各到这个时长时敲一下。0 表示不设。",
      pPrepFor: "准备方",
      pBothTeams: "双方",
      pFirst: "先发言方",
      pOperator: "由计时员选择",
      pFirstHint: "该方的计时随本项开始，或在按空格时开始。",
      pLive: "发言方",
      pLabel: "名称",
      pLabelZh: "中文名称",
      pLabelHint: "替换默认名称。界面为中文时使用中文名称。",
      pCues: "提示",
      pCuesRound: "与全场相同",
      pCuesOwn: "单独设置",
      cuesNone: "没有提示。",
      cueAdd: "添加提示",
      cueLeft: "剩余",
      cueTone: "音色",
      toneWarning: "提示音",
      toneEnd: "结束铃",
      toneSoft: "轻敲一下",
      toneSingle: "敲一下",
      toneDouble: "敲两下",
      toneTriple: "敲三下",
      fBells: "提示与铃声",
      fBellsHint: "没有单独设置提示的环节，在什么时候响什么。",
      fWarningTone: "提示音色",
      fMoreWarnings: "更多提示",
      fMoreWarningsHint: "剩余时间到达时各响一次。圆环在最早的提示时变黄。",
      fGrace: "宽限铃",
      fGraceHint: "时间到后再过这么久，敲三下。0 表示不设。",
      fBehaviour: "计时方式",
      fAdvance: "按“下一项”时",
      advStart: "立即开始计时",
      advPause: "载入后暂停",
      fAdvanceHint: "暂停：下一项显示完整时长并等待，按开始或空格后计时。",
      fFreeClocks: "自由辩论计时",
      freeBoth: "双方可同时计时",
      freeOne: "一次只计一方",
      fFreeClocksHint: "一次只计一方：开始一方计时会暂停另一方。",
      fOvertime: "时间到后",
      otStop: "停在零",
      otCount: "继续计超时",
      fOvertimeHint: "超时以红色正数显示，例如 +0:12。",
      fCap: "超时多久后不再响铃",
      fCapHint: "超时达到这个时长后不再响任何铃，包括宽限铃。",
      fBilingual: "中文名称",
      fBilingualHint: "界面为中文时代替上面的名称显示。留空则两种语言使用相同名称。",
      fTitleZh: "中文辩题",
      fProZh: "正方中文名称",
      fConZh: "反方中文名称",
      fSoundOn: "播放声音",
      on: "开",
      off: "关",
      orderAlternate: "正反方交替",
      orderAlternateTitle: "替换发言顺序？",
      orderAlternateText: "顺序将变为正一、反一、正二、反二……，不含准备时间和自由辩论。",
      orderClear: "清空",
      orderClearTitle: "清空发言顺序？",
      orderClearText: "将删除发言顺序中的所有项目。",
      fTimes: "其他计时",
      fWarning: "提醒",
      fWarningHint: "剩余这么多时间时播放提示音。",
      fPrep: "准备时间",
      fPrepHint: "每个准备环节的时长。",
      fFree: "自由辩论",
      fFreeHint: "自由辩论中每方的时间。",
      displayTitle: "显示与声音",
      displayIntro: "计时器在本屏幕上的外观和声音。预设不会改变这些。",
      fScreen: "屏幕",
      fLanguage: "语言",
      fClock: "计时显示",
      clockMinutes: "分钟 (3:00)",
      clockSeconds: "秒 (180)",
      fBackground: "背景颜色",
      fSounds: "声音",
      fWarningSound: "提醒音效",
      fEndSound: "结束音效",
      fBuiltinSound: "内置音效（或粘贴链接）",
      fUploadedFile: "你的音频文件",
      fChooseFile: "选择文件…",
      fDefault: "默认",
      fPlay: "试听",
      fFileTooBig: "音频文件过大（最大 2 MB），请改为粘贴链接。",
      fCannotPlay: "无法播放该音效，请检查链接或换一个文件。",
      advancedTitle: "高级",
      advancedIntro: "供熟练用户使用的工具，正常比赛不需要。",
      fJson: "设置文件 (JSON)",
      fJsonHint: "其他页面的全部内容，以文本形式显示。在这里的修改也会同步到其他页面。",
      fShortcuts: "键盘快捷键",
      kSpace: "暂停或继续计时",
      kNext: "下一项",
      kPrev: "上一项",
      kInvert: "自由辩论中切换双方",
      kFull: "全屏",
      kSettings: "打开设置",
      kSave: "保存并应用（在设置中）",
      kEsc: "关闭设置或对话框",
      fReset: "重新开始",
      fResetHint: "把所有设置恢复为第一次打开时的样子。已保存的预设会保留。",
      resetTitle: "恢复所有默认设置？",
      resetText: "所有设置都会恢复默认。按“保存并应用”之前不会生效。",
      unsavedNote: "有未保存的更改。",
      unsavedRestart: "有未保存的更改。保存后正在进行的辩论会重新开始。",
      unsavedTitle: "保存更改？",
      unsavedText: "设置已修改，是否保存并应用？",
      invalidTitle: "设置文件有错误",
      invalidText: "“高级”页面中的文本无法读取，因此不能保存。是否放弃更改？",
      keepEditing: "继续编辑",
      reloadTitle: "重新开始辩论？",
      reloadText: "辩论正在进行中，刷新将回到开始状态。",
      reloadConfirm: "刷新",
      cancel: "取消",
      saveFailed: "保存失败（存储空间不足？）：",
      invalidEvents: "发言顺序中包含不存在的辩手：",
      fullscreen: "全屏 (F)",
    },
  };

  // Original Unity build: language 0 = Chinese (Simplified), 1 = English.
  function normalizeLang(v) {
    if (v === 0 || v === "0" || v === "zh" || v === "zh-Hans") return "zh";
    return "en";
  }

  function loadText() {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t === null) {
      localStorage.setItem(STORAGE_KEY, DEFAULT_TEXT);
      return DEFAULT_TEXT;
    }
    return t;
  }
  // Returns an error message on failure (e.g. storage quota exceeded), else null.
  function saveText(t) {
    try {
      localStorage.setItem(STORAGE_KEY, t);
      return null;
    } catch (e) {
      return e && e.message ? e.message : String(e);
    }
  }

  // ---- Debate progress (survives a page refresh, cleared by Reload Scene) ----
  const PROGRESS_KEY = "debate-timer-progress";

  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  function readProgress() {
    try {
      const p = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || "null");
      return p && typeof p === "object" ? p : null;
    } catch (_) {
      return null;
    }
  }
  function clearProgress() {
    try {
      sessionStorage.removeItem(PROGRESS_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function normalizeColor(v, fallback) {
    const s = String(v || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
    if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7).toUpperCase();
    return fallback;
  }

  function parseSave(text) {
    const raw = typeof text === "string" ? JSON.parse(text) : text;
    if (!raw || typeof raw !== "object") throw new Error("root must be an object");
    const s = Object.assign({}, DEFAULT_SAVE.settings, raw.settings || {});
    const list = (arr, side) =>
      Array.isArray(arr)
        ? arr.map((p, i) => {
            const name = p && p.name != null ? String(p.name) : "";
            return { name: isDefaultName(side, i, name) ? "" : name, time: Math.max(0, Number(p && p.time) || 0) };
          })
        : [];
    const events = Array.isArray(raw.event_order) ? raw.event_order.map(normalizeEvent).filter((e) => e !== null) : [];
    return {
      settings: {
        pro_colors: normalizeColor(s.pro_colors, "#0000FF"),
        con_colors: normalizeColor(s.con_colors, "#FF0000"),
        pro_label: String(s.pro_label || ""),
        con_label: String(s.con_label || ""),
        pro_label_zh: String(s.pro_label_zh || ""),
        con_label_zh: String(s.con_label_zh || ""),
        background_color: normalizeColor(s.background_color, "#000000"),
        time_warning: Math.max(0, Number(s.time_warning) || 0),
        warning_tone: TONES.includes(s.warning_tone) ? s.warning_tone : "warning",
        extra_cues: normalizeCues(s.extra_cues) || [],
        time_grace: secs(s.time_grace),
        overtime_cap: s.overtime_cap == null ? 300 : secs(s.overtime_cap),
        time_prep: Math.max(0, Number(s.time_prep) || 0),
        time_free: Math.max(0, Number(s.time_free) || 0),
        free_exclusive: s.free_exclusive === true,
        display_minutes: Boolean(s.display_minutes),
        language: normalizeLang(s.language),
        sound: s.sound !== false,
        audio_warning: String(s.audio_warning || ""),
        audio_end: String(s.audio_end || ""),
        advance_starts: s.advance_starts !== false,
        overtime: s.overtime === true,
      },
      title: raw.title != null ? String(raw.title) : "",
      title_zh: raw.title_zh != null ? String(raw.title_zh) : "",
      pro_side: list(raw.pro_side, "pro"),
      con_side: list(raw.con_side, "con"),
      event_order: events,
    };
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => el.classList.toggle("hidden", !on);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const els = {
    title: $("title"),
    titleText: $("title-text"),
    titleEyebrow: $("title-eyebrow"),
    titleDot: $("title-dot"),
    flash: $("flash"),
    proCol: $("pro-column"),
    conCol: $("con-column"),
    proLabel: $("pro-label"),
    conLabel: $("con-label"),
    ringTimer: $("ring-timer"),
    doubleTimer: $("double-timer"),
    ringBg: $("ring-bg"),
    ringFg: $("ring-fg"),
    ringText: $("ring-text"),
    btnNext: $("btn-next"),
    timeline: $("timeline-buttons"),
    menuOverlay: $("menu-overlay"),
    endOverlay: $("end-overlay"),
    editorError: $("editor-error"),
    btnLang: $("btn-lang"),
    fileInput: $("file-input"),
    audioFileInput: $("audio-file-input"),
    audioWarning: $("audio-warning"),
    audioEnd: $("audio-end"),
    form: $("settings-form"),
    nav: $("settings-nav"),
    idleHint: $("idle-hint"),
    idleName: $("idle-name"),
    idleTime: $("idle-time"),
    idleBar: $("idle-bar"),
    idleTotal: $("idle-total"),
    idleText: $("idle-text"),
    btnNextLabel: $("btn-next-label"),
    btnNextSub: $("btn-next-sub"),
    btnPrev: $("btn-prev"),
    btnPrevSub: $("btn-prev-sub"),
    btnSave: $("btn-save"),
    btnDiscard: $("btn-discard"),
    panelFoot: $("panel-foot"),
    footNote: $("foot-note"),
  };
  const RING_CIRC = 2 * Math.PI * 44;

  // ---------------------------------------------------------------------------
  // Pictograms: one colour each, details cut out with a mask, so they work on
  // any background. Masks need ids, so each copy gets its own.
  // ---------------------------------------------------------------------------
  let iconSeq = 0;
  const PICTO = {
    // Free debate: a thought cloud with "…": anyone on the team can jump in.
    thinking: (id) => `<svg viewBox="0 0 64 46" aria-hidden="true"><defs><mask id="${id}"><rect width="64" height="46" fill="#fff"/><circle cx="27" cy="17.5" r="3.2" fill="#000"/><circle cx="37" cy="17.5" r="3.2" fill="#000"/><circle cx="47" cy="17.5" r="3.2" fill="#000"/></mask></defs><g fill="currentColor"><path mask="url(#${id})" d="M21 30.5c-5.2 0-9-3.4-9-8 0-3.9 2.8-7 6.6-7.8C20 8.3 25.7 4 32.5 4c5.3 0 9.9 2.6 12.3 6.4 1-.3 2.1-.4 3.2-.4 6.6 0 12 4.4 12 10.2 0 5.8-5.4 10.3-12 10.3Z"/><circle cx="11.5" cy="35" r="3.6"/><circle cx="5" cy="41.5" r="2.3"/></g></svg>`,
    // Up next: two rounded chevrons pointing at the speaker.
    next: () => `<svg viewBox="0 0 48 48" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5 22 24 6 38.5Z"/><path d="M24 9.5 40 24 24 38.5Z"/></svg>`,
    // This side's free-debate clock is running.
    stopwatch: (id) => `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><mask id="${id}"><rect width="48" height="48" fill="#fff"/><path d="M24 28V18.5" stroke="#000" stroke-width="3.4" stroke-linecap="round"/><circle cx="24" cy="28" r="3" fill="#000"/></mask></defs><g fill="currentColor"><rect x="19" y="2" width="10" height="5" rx="2"/><rect x="22" y="5" width="4" height="5"/><path d="M36.6 9.8a2.2 2.2 0 0 1 3.1 0l2.5 2.5a2.2 2.2 0 0 1 0 3.1l-1.6 1.6-5.6-5.6Z"/><circle mask="url(#${id})" cx="24" cy="28" r="17"/></g></svg>`,
    // …pointing at that side's bar.
    go: () => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 24h30M27 12l12 12-12 12"/></svg>`,
    // Preparation (timeline): notepad with lines and a pencil.
    prep: (id) => `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><mask id="${id}"><rect width="48" height="48" fill="#fff"/><rect x="15" y="3" width="12" height="7" rx="2.5" fill="#000"/><path d="M12.5 19h17M12.5 26h17M12.5 33h10" stroke="#000" stroke-width="3" stroke-linecap="round"/><path d="M30 44 44.5 29.5" stroke="#000" stroke-width="11" stroke-linecap="round"/></mask></defs><g fill="currentColor"><rect mask="url(#${id})" x="5" y="6" width="32" height="38" rx="6"/><rect x="17" y="2" width="8" height="6" rx="2"/><path d="M41.2 25.9a3 3 0 0 1 4.2 0l.7.7a3 3 0 0 1 0 4.2L33.9 43l-6.4 1.5a.9.9 0 0 1-1.1-1.1L28 37.1Z"/></g></svg>`,
    // Done (timeline).
    done: () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>`,

    // Two speech bubbles: both teams share one clock.
    shared: () => `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M4 10a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-7 6v-6.2A5 5 0 0 1 4 20Z"/><path d="M36 15h3a5 5 0 0 1 5 5v10a5 5 0 0 1-4 4.9V41l-7-6H23a5 5 0 0 1-5-5v-1h9a9 9 0 0 0 9-9Z"/></svg>`,
    // A cup: a break.
    break: () => `<svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M6 14h28v13a13 13 0 0 1-13 13h-2A13 13 0 0 1 6 27Z"/><path d="M34 18h3a7 7 0 0 1 0 14h-3.5l.5-4.5h3a2.5 2.5 0 0 0 0-5h-3Z"/><rect x="4" y="42" width="32" height="3.5" rx="1.75"/></svg>`,
  };
  const picto = (name) => PICTO[name](`ic${++iconSeq}`);

  document.querySelectorAll(".bar-label").forEach((el) => {
    el.innerHTML = `<span class="icon-timer">${picto("stopwatch")}</span><span class="icon-arrow">${picto("go")}</span>`;
  });

  // Sounds are off when the screen's "Play sounds" setting is off.
  const soundOn = () => !state.data || state.data.settings.sound !== false;

  function playSound(audio) {
    if (!soundOn()) return;
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } catch (_) {
      /* autoplay restrictions – ignore */
    }
  }

  // A knock made by the browser: soft, or one, two or three firm strikes.
  let audioCtx = null;
  function knock(tone) {
    const strikes = { soft: 1, single: 1, double: 2, triple: 3 }[tone] || 1;
    const soft = tone === "soft";
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.02;
      for (let i = 0; i < strikes; i++) {
        const at = t0 + i * 0.3;
        const gain = audioCtx.createGain();
        gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(soft ? 0.16 : 0.45, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + (soft ? 0.5 : 0.9));
        // A bell-like strike: a fundamental with two inharmonic partials.
        [
          [1, 1],
          [2.76, 0.35],
          [5.4, 0.12],
        ].forEach(([ratio, level]) => {
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.value = (soft ? 620 : 880) * ratio;
          g.gain.value = level;
          osc.connect(g).connect(gain);
          osc.start(at);
          osc.stop(at + 1);
        });
      }
    } catch (_) {
      /* no Web Audio – ignore */
    }
  }

  function playTone(tone) {
    if (!soundOn()) return;
    if (tone === "warning") playSound(els.audioWarning);
    else if (tone === "end") playSound(els.audioEnd);
    else knock(tone);
  }

  function formatTime(seconds, displayMinutes) {
    const s = Math.max(0, seconds);
    if (!displayMinutes) return String(Math.floor(s));
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
  }

  // ---------------------------------------------------------------------------
  // Timer (mirrors TimerController.cs)
  // ---------------------------------------------------------------------------
  class Timer {
    constructor(ui) {
      this.ui = ui;
      this.total = 180;
      this.cues = []; // [{ at: seconds left, tone, flash }]
      this.warnAt = 30; // the ring turns yellow from here
      this.grace = 0; // a triple knock this long after time runs out
      this.cap = 300; // no bells past this much overtime
      this.overtime = false; // keep counting after zero
      this.protectedSec = 0; // protected time at each end, shown on the ring
      this.displayMinutes = true;
      this.remaining = 0;
      this.running = false;
      this.timedOut = false;
      this.warned = false;
      this.wire();
      this.reset();
    }

    wire() {
      const u = this.ui;
      u.start.addEventListener("click", () => this.start());
      u.pause.addEventListener("click", () => this.stop());
      u.resume.addEventListener("click", () => this.resume());
      u.reset.addEventListener("click", () => this.reset());
    }

    // The clock keeps going past zero to count overtime, or until the grace bell.
    get graceDue() {
      return this.grace > 0 && this.grace <= this.cap;
    }

    tick(dt) {
      if (!this.running) return;
      const wasTimedOut = this.timedOut;
      const before = this.remaining;
      this.remaining -= dt;
      const now = this.remaining;
      const crossed = (at) => now <= at && before > at;
      for (const c of this.cues) {
        if (!crossed(c.at)) continue;
        playTone(c.tone);
        if (c.flash !== false) triggerFlash();
      }
      if (this.warnAt > 0 && crossed(this.warnAt)) this.warned = true;
      if (crossed(0)) {
        this.timedOut = true;
        playSound(els.audioEnd);
      }
      if (this.timedOut) {
        if (this.graceDue && crossed(-this.grace)) playTone("triple");
        if (!this.overtime && !(this.graceDue && now > -this.grace)) this.running = false;
      }
      if (this.timedOut !== wasTimedOut || !this.running) this.syncButtons();
    }

    get fresh() {
      return !this.running && !this.timedOut && this.remaining === this.total;
    }

    // Only overtime can be paused and resumed once the time is up.
    get canRun() {
      return !this.timedOut || this.overtime;
    }

    start() {
      this.remaining = this.total;
      this.running = true;
      this.timedOut = false;
      if (this.ui.onStart) this.ui.onStart(this);
      this.syncButtons();
    }
    stop() {
      this.running = false;
      this.syncButtons();
    }
    resume() {
      if (!this.canRun) return;
      this.running = true;
      if (this.ui.onStart) this.ui.onStart(this);
      this.syncButtons();
    }
    reset() {
      this.remaining = this.total;
      this.running = false;
      this.timedOut = false;
      this.warned = this.warnAt > 0 && this.total <= this.warnAt;
      this.syncButtons();
    }
    toggle() {
      if (this.running) this.stop();
      else if (!this.canRun) return;
      else if (this.fresh) this.start();
      else this.resume();
    }

    syncButtons() {
      const u = this.ui;
      const fresh = this.fresh;
      show(u.start, fresh);
      show(u.pause, this.running && this.canRun);
      show(u.resume, !this.running && !fresh && this.canRun);
      show(u.out, this.timedOut);
      if (u.onRunningChange) u.onRunningChange(this.running);
    }

    render() {
      const u = this.ui;
      const over = this.overtime && this.remaining < 0;
      u.text.textContent = over ? "+" + formatTime(-this.remaining, this.displayMinutes) : formatTime(this.remaining, this.displayMinutes);
      u.text.classList.toggle("over", over);
      u.fg.classList.toggle("warning", this.warned);
      u.bg.classList.toggle("timeout", this.timedOut);
      const frac = this.total > 0 ? Math.min(1, Math.max(0, this.remaining / this.total)) : 0;
      u.paint(frac);
      if (u.note) {
        const p = this.protectedSec;
        const inProtected = p > 0 && this.remaining > 0 && (this.total - this.remaining < p || this.remaining <= p);
        u.note.textContent = inProtected ? t("protectedNow") : "";
      }
    }
  }

  // Sets a timer up for one part of the round.
  function setupTimer(tm, d, ev, total) {
    const s = d.settings;
    const cues = cuesFor(d, ev);
    tm.total = total;
    tm.warnAt = cues.reduce((m, c) => Math.max(m, c.at), 0);
    tm.cues = cues;
    const prot = evOpts(ev).protected || 0;
    tm.protectedSec = prot;
    if (prot > 0 && prot * 2 < total) {
      tm.cues = cues.concat([
        { at: total - prot, tone: "single", flash: false },
        { at: prot, tone: "single", flash: false },
      ]);
    }
    tm.grace = s.time_grace;
    tm.cap = s.overtime_cap;
    tm.overtime = s.overtime;
    tm.displayMinutes = s.display_minutes;
  }

  const ringTimer = new Timer({
    fg: els.ringFg,
    bg: els.ringBg,
    text: els.ringText,
    start: $("ring-start"),
    pause: $("ring-pause"),
    resume: $("ring-resume"),
    out: $("ring-out"),
    reset: $("ring-reset"),
    note: $("ring-note"),
    paint: (frac) => {
      els.ringFg.style.strokeDashoffset = String(RING_CIRC * (1 - frac));
      // The rounded ends would leave a dot at the top once the time is up.
      els.ringFg.style.opacity = frac > 0.001 ? "" : "0";
    },
  });

  function makeBarTimer(root) {
    const label = root.querySelector(".bar-label");
    const fg = root.querySelector(".bar-fg");
    return new Timer({
      fg,
      bg: root.querySelector(".bar-bg"),
      text: root.querySelector(".bar-text"),
      start: root.querySelector(".bar-start"),
      pause: root.querySelector(".bar-pause"),
      resume: root.querySelector(".bar-resume"),
      out: root.querySelector(".bar-out"),
      reset: root.querySelector(".bar-reset"),
      paint: (frac) => {
        fg.style.height = `${frac * 100}%`;
      },
      onRunningChange: (running) => label.classList.toggle("show", running),
      // One team at a time: starting one clock pauses the other.
      onStart: (tm) => {
        if (state.data && state.data.settings.free_exclusive) barTimers.forEach((bt) => bt !== tm && bt.running && bt.stop());
      },
    });
  }
  const barTimers = Array.from(els.doubleTimer.querySelectorAll(".bar-timer")).map(makeBarTimer);
  const [barPro, barCon] = barTimers;

  // InvertTimer.swap()
  function invert() {
    if (barPro.running && !barCon.running) {
      barPro.stop();
      barCon.resume();
    } else if (barCon.running && !barPro.running) {
      barCon.stop();
      barPro.resume();
    }
  }
  $("btn-invert").addEventListener("click", invert);

  function triggerFlash() {
    els.flash.classList.remove("go");
    void els.flash.offsetWidth; // restart the animation
    els.flash.classList.add("go");
  }

  // ---------------------------------------------------------------------------
  // Debate state (mirrors MenuController.cs)
  // ---------------------------------------------------------------------------
  const state = {
    data: null,
    lang: "en",
    eventIndex: -1,
    currentSpeaker: null, // signed index: +n pro, -n con
    nextSpeaker: null,
    prepPhase: true,
    prepSide: null, // a preparation for one team only
    freePhase: false,
    sharedLive: null, // the teams on a shared clock
    speakers: { pro: [], con: [] },
    timelineButtons: [],
  };

  function t(key) {
    const v = I18N[state.lang][key];
    if (v === undefined) {
      console.warn("Missing text: " + key);
      return key;
    }
    return v;
  }

  function applyI18n() {
    document.documentElement.lang = state.lang === "zh" ? "zh-Hans" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = I18N[state.lang][el.dataset.i18n];
      if (typeof v === "string") el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const v = I18N[state.lang][el.dataset.i18nTitle];
      if (typeof v === "string") {
        el.title = v;
        el.setAttribute("aria-label", v);
      }
    });
    els.btnLang.textContent = t("langBtn");
    updateNextButton();
    if (state.data) {
      els.proLabel.textContent = teamName(state.data, "pro");
      els.conLabel.textContent = teamName(state.data, "con");
    }
    updateTitle();
  }

  function speakerIdAt(index) {
    const order = state.data.event_order;
    if (index < 0 || index >= order.length) return null;
    return evSpeaker(order[index]);
  }

  const participant = (id) => speakerOf(state.data, id);

  // A speaker's name as shown, falling back to the default for the language.
  function nameOf(id, p) {
    return (p && p.name) || defaultSpeakerName(id > 0 ? "pro" : "con", Math.abs(id) - 1, state.lang);
  }

  // Names with a Chinese version use it while the screen is in Chinese.
  const inLang = (base, zh) => (state.lang === "zh" && zh) || base || "";
  const teamName = (d, side) =>
    inLang(d.settings[side + "_label"], d.settings[side + "_label_zh"]) || t(side === "pro" ? "proDefault" : "conDefault");
  const topicOf = (d) => inLang(d.title, d.title_zh);
  const labelOf = (ev) => inLang(evOpts(ev).label, evOpts(ev).label_zh);

  // What a part is called, e.g. "Alice", "Pro preparation", "Crossfire".
  function partNameIn(d, ev, short) {
    const label = labelOf(ev);
    if (label) return label;
    const k = evKind(ev);
    if (k === "prep") {
      const side = evSide(ev);
      return side ? t("prepOf")(teamName(d, side)) : t(short ? "prepShort" : "prep");
    }
    if (k === "free") return t(short ? "freeShort" : "free");
    if (k === "shared") return t(short ? "sharedShort" : "shared");
    if (k === "break") return t("breakName");
    const id = evSpeaker(ev);
    const p = speakerOf(d, id);
    return p ? nameOf(id, p) : `${t("fNoSpeaker")} (${id})`;
  }

  // Before the round, the empty centre says what comes first and what to press.
  function updateIdleHint() {
    const d = state.data;
    const idle = Boolean(d) && state.eventIndex < 0 && d.event_order.length > 0;
    show(els.idleHint, idle);
    if (!idle) return;
    const s = d.settings;
    const ev = d.event_order[0];
    els.idleHint.style.setProperty("--first", evColor(d, ev));
    els.idleName.textContent = partNameIn(d, ev);
    els.idleTime.textContent = formatTime(evTime(d, ev), s.display_minutes);
    // The whole round as one bar, each part as long as it lasts.
    const stats = roundStats(d);
    els.idleBar.innerHTML = stats.segs.map((g) => `<i style="flex-grow:${g.sec || 1};background:${g.color}"></i>`).join("");
    els.idleTotal.textContent = t("roundTotal")(d.event_order.length, Math.round(stats.total / 60));
    // "Begin" looks like the button it refers to.
    els.idleText.innerHTML = esc(t("idleHint")).replace("{begin}", `<span class="idle-begin">${esc(t("begin"))}</span>`);
  }

  function updateTitle() {
    const d = state.data;
    if (!d) return;
    updateIdleHint();
    const order = d.event_order;
    const i = state.eventIndex;
    // Two tiers: a small line for context (the motion, or the part and the
    // motion during the round) over the main line, which carries a dot in
    // the colour of whoever has the floor.
    const set = (eyebrow, text, dot) => {
      els.titleEyebrow.textContent = eyebrow;
      els.titleText.textContent = text;
      els.titleDot.style.background = dot || "";
      els.title.classList.toggle("has-dot", Boolean(dot));
    };
    const topic = topicOf(d);
    if (i < 0 || i >= order.length) {
      set(topic ? t("motion") : "", topic, "");
      return;
    }
    const ev = order[i];
    const eyebrow = t("partOf")(i + 1, order.length) + (topic ? " · " + topic : "");
    const p = evKind(ev) === "speech" ? participant(evSpeaker(ev)) : null;
    const text = p && !labelOf(ev) ? t("speakerTurn")(nameOf(evSpeaker(ev), p)) : partNameIn(d, ev);
    set(eyebrow, text, evColor(d, ev));
  }

  function configHash() {
    return hashString(JSON.stringify(state.data));
  }

  function timerSnap(tm) {
    return { total: tm.total, remaining: tm.remaining, running: tm.running, timedOut: tm.timedOut, warned: tm.warned };
  }

  function persistProgress() {
    if (!state.data || state.eventIndex < 0) {
      clearProgress();
      return;
    }
    const p = {
      hash: configHash(),
      savedAt: Date.now(),
      eventIndex: state.eventIndex,
      currentSpeaker: state.currentSpeaker,
      nextSpeaker: state.nextSpeaker,
      prepPhase: state.prepPhase,
      freePhase: state.freePhase,
      ringVisible: !els.ringTimer.classList.contains("hidden"),
      doubleVisible: !els.doubleTimer.classList.contains("hidden"),
      ring: timerSnap(ringTimer),
      bars: barTimers.map(timerSnap),
    };
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    } catch (_) {
      /* ignore */
    }
  }

  function applyTimerSnap(tm, s, elapsed) {
    if (!s) return;
    tm.total = Number(s.total) || 0;
    tm.remaining = Number(s.remaining) || 0;
    tm.running = Boolean(s.running);
    tm.timedOut = Boolean(s.timedOut);
    tm.warned = Boolean(s.warned);
    if (tm.running) {
      // Time kept passing while the page was gone.
      tm.remaining -= elapsed;
      if (tm.remaining <= tm.warnAt) tm.warned = true;
      if (tm.remaining <= 0) {
        tm.timedOut = true;
        if (!tm.overtime) {
          tm.remaining = 0;
          tm.running = false;
        }
      }
    }
    tm.syncButtons();
  }

  function restoreProgress(p) {
    if (!p || p.hash !== configHash()) return false;
    const idx = Number(p.eventIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.data.event_order.length) return false;
    const elapsed = Math.max(0, (Date.now() - (Number(p.savedAt) || Date.now())) / 1000);
    state.eventIndex = idx;
    enterEvent(state.data.event_order[idx], false);
    state.currentSpeaker = p.currentSpeaker ?? null;
    state.nextSpeaker = p.nextSpeaker ?? null;
    state.prepPhase = Boolean(p.prepPhase);
    state.freePhase = Boolean(p.freePhase);
    applyTimerSnap(ringTimer, p.ring, elapsed);
    (p.bars || []).forEach((s, i) => barTimers[i] && applyTimerSnap(barTimers[i], s, elapsed));
    show(els.ringTimer, Boolean(p.ringVisible));
    show(els.doubleTimer, Boolean(p.doubleVisible));
    updateTitle();
    updateNextButton();
    updateTimelineActive();
    updateSpeakerIndicators();
    return true;
  }

  function applyTheme(settings) {
    const bg = settings.background_color;
    document.documentElement.style.setProperty("--bg", bg);
    // Pick a readable foreground for light backgrounds.
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    document.documentElement.classList.toggle("light-bg", lum > 0.6);
  }

  function applyAudio(settings) {
    const w = settings.audio_warning || DEFAULT_AUDIO.warning;
    const e = settings.audio_end || DEFAULT_AUDIO.end;
    if (els.audioWarning.getAttribute("src") !== w) els.audioWarning.src = w;
    if (els.audioEnd.getAttribute("src") !== e) els.audioEnd.src = e;
  }

  // Build speaker columns + timeline from the current save (loadScene)
  function loadScene() {
    let data;
    try {
      data = parseSave(loadText());
    } catch (e) {
      data = parseSave(DEFAULT_TEXT);
    }
    state.data = data;
    state.lang = data.settings.language;

    ringTimer.displayMinutes = data.settings.display_minutes;
    barTimers.forEach((bt) => (bt.displayMinutes = data.settings.display_minutes));

    applyTheme(data.settings);
    applyAudio(data.settings);
    buildSpeakers("pro", data.pro_side.length, data.settings.pro_colors);
    buildSpeakers("con", data.con_side.length, data.settings.con_colors);
    buildTimeline(data.event_order);

    state.eventIndex = -1;
    state.currentSpeaker = null;
    state.nextSpeaker = null;
    state.prepPhase = true;
    state.prepSide = null;
    state.freePhase = false;
    state.sharedLive = null;
    ringTimer.reset();
    barTimers.forEach((bt) => bt.reset());
    show(els.ringTimer, false);
    show(els.doubleTimer, false);
    show(els.endOverlay, false);
    clearProgress();

    applyI18n();
    updateSpeakerIndicators();
    updateTimelineActive();
  }

  // Reload Scene, asking first if a debate is in progress.
  function requestReload() {
    if (state.eventIndex < 0) {
      loadScene();
      return;
    }
    confirmDialog({
      title: t("reloadTitle"),
      text: t("reloadText"),
      primary: { label: t("reloadConfirm"), cls: "btn-red", action: loadScene },
      cancel: t("cancel"),
    });
  }

  function buildSpeakers(side, count, color) {
    const col = side === "pro" ? els.proCol : els.conCol;
    col.innerHTML = "";
    const list = [];
    for (let i = 1; i <= count; i++) {
      const row = document.createElement("div");
      row.className = "speaker";
      row.innerHTML = `
        <div class="slot outer"><span class="icon-next">${picto("next")}</span></div>
        <div class="figure" style="background-color:${color}"><div class="figure-num">${i}</div></div>
        <div class="slot inner">
          <img class="icon-clipboard" src="assets/icons/clipboard.png" alt="" />
          <span class="icon-group">${picto("thinking")}</span>
          <img class="icon-speech" src="assets/icons/speech-icon.png" alt="" />
        </div>`;
      col.appendChild(row);
      list.push({
        id: side === "pro" ? i : -i,
        next: row.querySelector(".icon-next"),
        clipboard: row.querySelector(".icon-clipboard"),
        group: row.querySelector(".icon-group"),
        speech: row.querySelector(".icon-speech"),
      });
    }
    state.speakers[side] = list;
    fitSpeakerSize();
  }

  // Size the speaker figures to fill the side columns, leaving a little air
  // above and below, with gaps in proportion to the figures.
  function fitSpeakerSize() {
    const n = Math.max(state.speakers.pro.length, state.speakers.con.length, 1);
    const side = els.proCol.parentElement;
    const full = side.clientHeight || window.innerHeight * 0.7;
    const gapRatio = 0.3;
    // The label's padding is 0.2 × the figure height, so it is solved for here too.
    const label = parseFloat(getComputedStyle(els.proLabel).fontSize) * 1.2 || 0;
    const avail = full * 0.94 - label;
    // A speaker row is about 1.6 figure-heights wide (figure plus its icons).
    const widthCap = (side.clientWidth || Infinity) / 1.6;
    const h = Math.min(full * 0.22, widthCap, avail / (n + gapRatio * (n - 1) + 0.2));
    const fig = Math.max(24, h);
    document.documentElement.style.setProperty("--fig-h", `${fig}px`);
    document.documentElement.style.setProperty("--fig-gap", `${fig * gapRatio}px`);
  }

  function eventLabel(ev) {
    const k = evKind(ev);
    return { prep: "P", free: "F", shared: "S", break: "B" }[k] || String(evSpeaker(ev));
  }

  const partName = (ev) => partNameIn(state.data, ev);

  // The timeline is a stepper: one dot per part, joined by a line that fills
  // up as the round goes on. The dot says who (team colour and number, or an
  // icon for preparation and free debate); the caption adds only what the dot
  // can't: a custom speaker name, and the time.
  function buildTimeline(order) {
    const s = state.data.settings;
    const dm = s.display_minutes;
    els.timeline.innerHTML = "";
    els.timeline.style.setProperty("--n", String(Math.max(order.length, 1)));
    els.timeline.parentElement.setAttribute("aria-label", t("timelineTitle"));
    const track = document.createElement("div");
    track.className = "tl-track";
    track.innerHTML = '<i class="tl-fill"></i>';
    els.timeline.appendChild(track);
    const d = state.data;
    state.timelineButtons = order.map((ev, i) => {
      const k = evKind(ev);
      const color = evColor(d, ev);
      let dot;
      let name = labelOf(ev);
      let time = formatTime(evTime(d, ev), dm);
      if (k === "speech") {
        const id = evSpeaker(ev);
        const p = participant(id);
        dot = String(Math.abs(id));
        if (!name) name = p && p.name ? p.name : "";
        if (!p) time = "–";
      } else {
        dot = picto({ prep: "prep", free: "thinking", shared: "shared", break: "break" }[k]);
        if (!name) name = partNameIn(d, ev, true);
        if (k === "free") time = t("eachSide")(time);
      }
      const b = document.createElement("button");
      b.className = "tl-step";
      b.style.setProperty("--c", color);
      b.style.setProperty("--c-ink", color.startsWith("#") ? inkFor(color) : "#111");
      b.innerHTML = `<span class="tl-dot"><span class="tl-mark">${dot}</span><span class="tl-check">${picto("done")}</span></span>${
        name ? `<span class="tl-name">${esc(name)}</span>` : ""
      }<span class="tl-time">${esc(time)}</span>`;
      b.title = `${partName(ev)} · ${time}`;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => {
        state.eventIndex = i - 1; // TimelineButtonControl.OnButtonPress
        next();
      });
      els.timeline.appendChild(b);
      return b;
    });
    updateTimelineActive();
  }

  function updateTimelineActive() {
    const i = state.eventIndex;
    const n = state.timelineButtons.length;
    state.timelineButtons.forEach((b, k) => {
      b.classList.toggle("done", i >= 0 && k < i);
      b.classList.toggle("now", k === i);
      if (k === i) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    const fill = els.timeline.querySelector(".tl-fill");
    if (fill) fill.style.width = n > 1 && i > 0 ? `${(Math.min(i, n - 1) / (n - 1)) * 100}%` : "0%";
    const cur = state.timelineButtons[i];
    const strip = els.timeline.parentElement;
    if (cur && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({ left: cur.offsetLeft + cur.offsetWidth / 2 - strip.clientWidth / 2, behavior: "smooth" });
    }
    updateNextButton();
  }

  const shortPartName = (ev) => partNameIn(state.data, ev, true);

  // "Begin" / "Next" and "Back", each with the part they lead to underneath.
  function updateNextButton() {
    const d = state.data;
    if (!d) return;
    const i = state.eventIndex;
    els.btnNextLabel.textContent = i < 0 ? t("begin") : t("next");
    const upcoming = d.event_order[i + 1];
    els.btnNextSub.textContent = upcoming === undefined ? "" : shortPartName(upcoming);
    const canGoBack = i > 0;
    els.btnPrev.disabled = !canGoBack;
    els.btnPrevSub.textContent = canGoBack ? shortPartName(d.event_order[i - 1]) : "";
    syncStepWidths();
  }

  // Back and Next are as wide as the wider of the two needs, no wider, so
  // the timeline between them stays centred.
  function syncStepWidths() {
    const a = els.btnPrev;
    const b = els.btnNext;
    a.style.width = b.style.width = "";
    const w = Math.ceil(Math.max(a.offsetWidth, b.offsetWidth));
    if (w) a.style.width = b.style.width = `${w}px`;
  }

  // AnimationController.Update, evaluated every frame
  function updateSpeakerIndicators() {
    const all = state.speakers.pro.concat(state.speakers.con);
    const currentTimerDone = ringTimer.remaining < 0.1;
    for (const sp of all) {
      const side = sp.id > 0 ? "pro" : "con";
      sp.clipboard.classList.toggle("show", state.prepPhase && (!state.prepSide || state.prepSide === side));
      sp.group.classList.toggle("show", state.freePhase);
      const isCurrent = sp.id === state.currentSpeaker || Boolean(state.sharedLive && state.sharedLive.includes(side));
      const isNext = sp.id === state.nextSpeaker;
      sp.speech.classList.toggle("show", isCurrent && ringTimer.running);
      sp.next.classList.toggle("show", isNext);
      sp.next.classList.toggle("flashing", isNext && currentTimerDone);
    }
  }

  // MenuController.Next()
  function next() {
    const d = state.data;
    const order = d.event_order;
    state.eventIndex++;

    state.nextSpeaker = speakerIdAt(state.eventIndex + 1);

    if (state.eventIndex >= order.length) {
      state.eventIndex = -1;
      state.currentSpeaker = null;
      state.nextSpeaker = null;
      state.prepPhase = true;
      state.prepSide = null;
      state.freePhase = false;
      state.sharedLive = null;
      ringTimer.reset();
      show(els.ringTimer, false);
      show(els.doubleTimer, false);
      show(els.endOverlay, true);
    } else {
      enterEvent(order[state.eventIndex], d.settings.advance_starts);
    }

    updateTitle();
    updateTimelineActive();
    updateSpeakerIndicators();
    persistProgress();
  }

  // Loads a part: sets the clocks up for it and, if `start`, starts them.
  // Called with start = false when restoring a debate after a refresh.
  function enterEvent(ev, start) {
    const d = state.data;
    const k = evKind(ev);
    const o = evOpts(ev);
    state.currentSpeaker = k === "speech" ? evSpeaker(ev) : null;
    state.prepPhase = k === "prep";
    state.prepSide = k === "prep" ? o.side || null : null;
    state.freePhase = k === "free";
    state.sharedLive = k === "shared" ? o.live || ["pro", "con"] : null;
    show(els.ringTimer, k !== "free");
    show(els.doubleTimer, k === "free");
    if (k === "free") {
      ringTimer.reset(); // stop the hidden ring timer so it cannot ring during free debate
      barTimers.forEach((bt) => {
        setupTimer(bt, d, ev, evTime(d, ev));
        bt.reset();
      });
      // The team that starts gets the first Space, or starts straight away.
      const first = o.first === "pro" ? barPro : o.first === "con" ? barCon : null;
      lastBar = first;
      if (start && first) first.start();
      return;
    }
    const missing = k === "speech" && !participant(state.currentSpeaker);
    // A missing speaker shows 0 instead of ringing instantly.
    setupTimer(ringTimer, d, ev, missing ? 0 : evTime(d, ev));
    ringTimer.reset();
    if (start && !missing) ringTimer.start();
  }

  function previous() {
    if (state.eventIndex <= 0) return;
    state.eventIndex -= 2;
    next();
  }

  // ---------------------------------------------------------------------------
  // Settings panel: pages over a shared draft, saved with Save & Apply
  // ---------------------------------------------------------------------------
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    layers: svg('<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>'),
    users: svg(
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
    ),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    code: svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
    pencil: svg('<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
    upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    play: svg('<path d="m6 3 14 9-14 9Z"/>'),
    bookmark: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/><path d="M12 7v6M9 10h6"/>'),
    folder: svg(
      '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>'
    ),
    repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    rotate: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
    music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  };

  const PAGES = [
    { id: "presets", icon: "layers", label: "navPresets" },
    { id: "debate", icon: "users", label: "navDebate" },
    { id: "order", icon: "clock", label: "navOrder" },
    { id: "display", icon: "sliders", label: "navDisplay" },
    { id: "advanced", icon: "code", label: "navAdvanced" },
  ];
  const PRESET_ICONS = ["⭐", "⚖️", "⚡", "🏆", "🎓", "🗣️", "🎤", "⏱️", "📚", "🧠", "🎯", "🌏", "🔥", "🏫", "☕", "🐉"];
  const PRESETS_KEY = "debate-timer-presets";
  const PAGE_KEY = "debate-timer-settings-page";
  const ORDER_VIEW_KEY = "debate-timer-order-view";

  function readLocal(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, value);
      return null;
    } catch (e) {
      return e && e.message ? e.message : String(e);
    }
  }

  let draft = null;
  let storedJson = ""; // the saved settings as the draft would serialize them
  let page = PAGES.some((p) => p.id === readLocal(PAGE_KEY)) ? readLocal(PAGE_KEY) : "presets";
  let notice = ""; // a one-off line for the footer, e.g. after loading a preset
  // "detailed": vertical list with side, name and duration; "simple": compact chips.
  let orderView = readLocal(ORDER_VIEW_KEY) === "simple" ? "simple" : "detailed";

  // ---- User presets (stored in this browser) ------------------------------
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const validIcon = (v) => (typeof v === "string" && v.trim() && v.length <= 8 ? v.trim() : PRESET_ICONS[0]);
  const cleanName = (v) => String(v == null ? "" : v).trim().slice(0, 60);

  function loadUserPresets() {
    try {
      const list = JSON.parse(readLocal(PRESETS_KEY) || "[]");
      if (!Array.isArray(list)) return [];
      return list
        .filter((p) => p && typeof p === "object" && p.round && typeof p.round === "object")
        .map((p) => ({
          id: String(p.id || newId()),
          name: cleanName(p.name) || "Preset",
          icon: validIcon(p.icon),
          round: roundOf(parseSave(p.round)),
        }));
    } catch (_) {
      return [];
    }
  }
  let userPresets = loadUserPresets();
  function storeUserPresets() {
    return writeLocal(PRESETS_KEY, JSON.stringify(userPresets));
  }

  const allPresets = () => BUILTIN_PRESETS.concat(userPresets);
  const findPreset = (id) => allPresets().find((p) => p.id === id) || null;
  const presetName = (p) => (p.builtin ? t(p.nameKey) : p.name);

  // The file a preset downloads as: a save file with just the round, plus name and icon.
  function presetFile(p) {
    return Object.assign({ name: presetName(p), icon: p.icon }, clone(p.round));
  }
  function fileNameFor(name) {
    return (String(name).replace(/[\\/:*?"<>|]+/g, "").trim() || "preset") + ".json";
  }
  function parsePresetFile(text, fileName) {
    const raw = JSON.parse(text);
    const save = parseSave(raw);
    if (!save.pro_side.length && !save.con_side.length) throw new Error(t("notAPreset"));
    const name = cleanName(raw.name) || cleanName(String(fileName || "").replace(/\.json$/i, "")) || t("newPresetName");
    return { id: newId(), name, icon: validIcon(raw.icon), round: roundOf(save) };
  }

  function downloadJson(obj, fileName) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Picks files and hands back [{name, text}].
  function pickFiles(accept, multiple, onFiles) {
    const input = els.fileInput;
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      input.value = "";
      if (!files.length) return;
      Promise.all(files.map((f) => f.text().then((text) => ({ name: f.name, text })))).then(onFiles);
    };
    input.click();
  }

  // ---- Round facts for summaries --------------------------------------------
  function roundStats(r) {
    let speeches = 0;
    let total = 0;
    const segs = r.event_order.map((ev) => {
      const kind = evKind(ev);
      const sec = evTime(r, ev) * (kind === "free" ? 2 : 1);
      if (kind === "speech") speeches++;
      total += sec;
      return { kind, sec, color: evColor(r, ev) };
    });
    return { speeches, total, segs };
  }
  const roundSummary = (r) => {
    const s = roundStats(r);
    return t("summary")(s.speeches, Math.round(s.total / 60));
  };
  // A thin bar showing each part of the round in proportion to its length.
  function miniBar(r) {
    const { segs, total } = roundStats(r);
    if (!total) return "";
    return `<span class="mbar" aria-hidden="true">${segs
      .map((g) => `<i style="flex-grow:${g.sec || 1};background:${g.color}"></i>`)
      .join("")}</span>`;
  }

  // Black or white, whichever reads better on the colour.
  function inkFor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#111" : "#fff";
  }

  // ---- Panel open / close / save -------------------------------------------
  function setError(msg) {
    els.editorError.textContent = msg || "";
  }

  function storedDraft() {
    try {
      return parseSave(loadText());
    } catch (_) {
      return parseSave(DEFAULT_TEXT);
    }
  }

  function isDirty() {
    return JSON.stringify(draft) !== storedJson;
  }

  function openMenu() {
    draft = storedDraft();
    storedJson = JSON.stringify(draft);
    userPresets = loadUserPresets();
    notice = "";
    setError("");
    renderForm();
    show(els.menuOverlay, true);
    const active = els.nav.querySelector(".snav-btn.active");
    if (active) active.focus();
  }

  function closeMenu() {
    show(els.menuOverlay, false);
    show(confirmOverlay, false);
    show(presetOverlay, false);
    show(partOverlay, false);
    partCtx = null;
    // Undo any language preview that was not saved.
    if (state.data && state.lang !== state.data.settings.language) {
      state.lang = state.data.settings.language;
      applyI18n();
    }
  }

  // Generic 1–3 button confirm dialog.
  // opts: { title, text, primary?: {label, cls, action}, secondary?: {label, cls, action}, cancel }
  function confirmDialog(opts) {
    $("confirm-title").textContent = opts.title;
    $("confirm-text").textContent = opts.text;
    const wire = (id, spec) => {
      const b = $(id);
      show(b, Boolean(spec));
      if (!spec) return;
      b.textContent = spec.label;
      b.className = "btn " + (spec.cls || "btn-mint");
      b.onclick = () => {
        show(confirmOverlay, false);
        spec.action();
      };
    };
    wire("confirm-save", opts.primary);
    wire("confirm-discard", opts.secondary);
    const c = $("confirm-cancel");
    c.textContent = opts.cancel || t("cancel");
    c.onclick = () => show(confirmOverlay, false);
    show(confirmOverlay, true);
    (opts.primary ? $("confirm-save") : opts.secondary ? $("confirm-discard") : c).focus();
  }

  // Close the panel, prompting first if there are unsaved (or unparsable) edits.
  const confirmOverlay = $("confirm-overlay");
  function requestClose() {
    const valid = commitView();
    if (valid && !isDirty()) {
      closeMenu();
      return;
    }
    confirmDialog({
      title: t(valid ? "unsavedTitle" : "invalidTitle"),
      text: t(valid ? "unsavedText" : "invalidText"),
      primary: valid ? { label: t("saveApply"), cls: "btn-mint", action: saveAndApply } : null,
      secondary: {
        label: t("discard"),
        cls: "btn-yellow",
        action: () => {
          draft = storedDraft();
          setError("");
          closeMenu();
        },
      },
      cancel: t("keepEditing"),
    });
  }
  confirmOverlay.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) show(confirmOverlay, false);
  });

  // Pull edits from the JSON editor into `draft`. Returns false on invalid JSON.
  function commitView() {
    const ed = $("editor");
    if (page === "advanced" && ed) {
      try {
        draft = parseSave(ed.value);
      } catch (e) {
        setError(t("invalidJson") + e.message);
        return false;
      }
    }
    setError("");
    return true;
  }

  function goPage(id) {
    if (id === page || !commitView()) return;
    page = id;
    writeLocal(PAGE_KEY, page);
    renderForm();
    els.form.scrollTop = 0;
  }

  function saveAndApply() {
    if (!commitView()) return;
    if (!isDirty()) {
      closeMenu();
      return;
    }
    const missing = draft.event_order.map(evSpeaker).filter((id) => id !== null && !participant2(id));
    if (missing.length) {
      if (page !== "order") goPage("order");
      setError(t("invalidEvents") + missing.join(", "));
      return;
    }
    const err = saveText(JSON.stringify(draft, null, 2));
    if (err) {
      setError(t("saveFailed") + err);
      return;
    }
    closeMenu();
    loadScene();
  }

  // Footer: what is unsaved, and what the main button will do.
  function updateFoot() {
    const dirty = isDirty();
    els.btnDiscard.disabled = !dirty;
    els.btnSave.textContent = t(dirty ? "saveApply" : "done");
    els.panelFoot.classList.toggle("dirty", dirty);
    const parts = [];
    if (notice) parts.push(notice);
    if (dirty) parts.push(t(state.eventIndex >= 0 ? "unsavedRestart" : "unsavedNote"));
    els.footNote.textContent = parts.join(" ");
  }

  // ---- Rendering -------------------------------------------------------------
  function renderNav() {
    els.nav.innerHTML = PAGES.map(
      (p) =>
        `<button type="button" class="snav-btn ${p.id === page ? "active" : ""}" data-page="${p.id}" role="tab" aria-selected="${
          p.id === page
        }">${ICONS[p.icon]}<span>${esc(t(p.label))}</span></button>`
    ).join("");
  }

  const PAGE_RENDER = {
    presets: () => pagePresets(),
    debate: () => pageDebate(),
    order: () => pageOrder(),
    display: () => pageDisplay(),
    advanced: () => pageAdvanced(),
  };

  function renderForm() {
    renderNav();
    els.form.innerHTML = PAGE_RENDER[page]();
    if (page === "debate") {
      renderSpeakerList("pro");
      renderSpeakerList("con");
    } else if (page === "order") {
      renderEventChips();
    }
    updateFoot();
  }

  function pageIntro(titleKey, textKey) {
    return `<div class="page-intro"><h3>${esc(t(titleKey))}</h3><p>${esc(t(textKey))}</p></div>`;
  }

  // Minutes and seconds boxes for one duration. `key` is a draft path or "sp:side:index".
  function durInput(key, sec, label) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `<span class="dur" data-dur="${key}" role="group" aria-label="${esc(label || "")}">
      <input class="dur-m" type="text" inputmode="numeric" maxlength="3" value="${m}" aria-label="${esc(t("minutes"))}" /><span class="dur-u">${esc(
      t("minShort")
    )}</span>
      <input class="dur-s" type="text" inputmode="numeric" maxlength="3" value="${s < 10 ? "0" : ""}${s}" aria-label="${esc(
      t("seconds")
    )}" /><span class="dur-u">${esc(t("secShort"))}</span>
    </span>`;
  }

  function seg(path, options, current) {
    return `<div class="seg" role="radiogroup">${options
      .map(
        ([value, label]) =>
          `<button type="button" class="seg-btn ${value === current ? "active" : ""}" role="radio" aria-checked="${
            value === current
          }" data-set-path="${path}" data-value="${esc(JSON.stringify(value))}">${esc(label)}</button>`
      )
      .join("")}</div>`;
  }

  // -- Presets page
  function pagePresets() {
    const current = allPresets().find((p) => presetMatches(p, draft));
    return `
      ${pageIntro("presetsTitle", "presetsIntro")}
      <section class="current">
        <span class="picon">${current ? esc(current.icon) : "✏️"}</span>
        <div class="current-txt">
          <span class="eyebrow">${esc(t("currentSetup"))}</span>
          <strong>${esc(current ? presetName(current) : t("customSetup"))}</strong>
          <span class="psum">${esc(roundSummary(draft))}</span>
          ${miniBar(draft)}
        </div>
        <button type="button" class="btn btn-lime" data-preset-new>${ICONS.bookmark}<span>${esc(t("saveAsPreset"))}</span></button>
      </section>
      <div class="list-head-row"><h4 class="list-head">${esc(t("builtinPresets"))}</h4></div>
      <div class="pgrid">${BUILTIN_PRESETS.map(presetCard).join("")}</div>
      <div class="list-head-row">
        <h4 class="list-head">${esc(t("myPresets"))}</h4>
        <button type="button" class="btn btn-quiet sm" data-preset-import>${ICONS.folder}<span>${esc(t("openPresetFile"))}</span></button>
      </div>
      ${
        userPresets.length
          ? `<div class="pgrid">${userPresets.map(presetCard).join("")}</div>`
          : `<p class="empty-note">${esc(t("noPresets"))}</p>`
      }`;
  }

  function presetCard(p) {
    const inUse = presetMatches(p, draft);
    const name = presetName(p);
    const tool = (attr, icon, labelKey, extra) =>
      `<button type="button" class="icon-btn ${extra || ""}" ${attr}="${esc(p.id)}" title="${esc(t(labelKey))}" aria-label="${esc(
        t(labelKey) + ": " + name
      )}">${ICONS[icon]}</button>`;
    return `<div class="pcard ${inUse ? "in-use" : ""}">
      <button type="button" class="pcard-main" data-use-preset="${esc(p.id)}">
        <span class="pcard-top">
          <span class="picon">${esc(p.icon)}</span>
          <span class="pcard-txt"><span class="pname">${esc(name)}</span><span class="psum">${esc(roundSummary(p.round))}</span></span>
        </span>
        ${miniBar(p.round)}
      </button>
      <div class="pcard-foot">
        ${
          inUse
            ? `<span class="pbadge">${ICONS.check}${esc(t("inUse"))}</span>`
            : `<span class="puse">${esc(t("usePreset"))}</span>`
        }
        <span class="pcard-tools">
          ${p.builtin ? "" : tool("data-edit-preset", "pencil", "editPreset")}
          ${tool("data-download-preset", "download", "downloadPreset")}
          ${p.builtin ? "" : tool("data-delete-preset", "trash", "deletePreset", "danger")}
        </span>
      </div>
    </div>`;
  }

  // -- Debate page
  function pageDebate() {
    return `
      ${pageIntro("debateTitle", "debateIntro")}
      <section class="sgroup">
        <label class="fstack"><span class="flabel">${esc(t("fTitle"))}</span>
          <input type="text" data-path="title" value="${esc(draft.title)}" placeholder="${esc(t("fTitlePlaceholder"))}" /></label>
      </section>
      <div class="sides">${sideCard("pro")}${sideCard("con")}</div>`;
  }

  function sideCard(side) {
    const s = draft.settings;
    const isPro = side === "pro";
    const color = isPro ? s.pro_colors : s.con_colors;
    return `<section class="sgroup side-card" data-side="${side}" style="--side:${color};--side-ink:${inkFor(color)}">
      <div class="side-head">
        <label class="swatch" title="${esc(t("fColor"))}"><input type="color" data-path="settings.${side}_colors" value="${esc(
      color
    )}" aria-label="${esc(t("fColor"))}" /></label>
        <label class="fstack grow"><span class="flabel">${esc(t(isPro ? "fProSide" : "fConSide"))}</span>
          <input type="text" data-path="settings.${side}_label" value="${esc(isPro ? s.pro_label : s.con_label)}" placeholder="${esc(
      t(isPro ? "proDefault" : "conDefault")
    )}" /></label>
      </div>
      <div class="speaker-list" id="list-${side}"></div>
      <button type="button" class="btn btn-quiet sm" data-add-speaker="${side}">${ICONS.plus}<span>${esc(t("fAdd"))}</span></button>
    </section>`;
  }

  function renderSpeakerList(side) {
    const list = draft[side + "_side"];
    const root = $("list-" + side);
    if (!root) return;
    const sign = side === "pro" ? 1 : -1;
    root.innerHTML = list.length
      ? `<div class="srow head"><span></span><span>${esc(t("fName"))}</span><span>${esc(t("fSpeakingTime"))}</span><span></span></div>`
      : `<p class="empty-note sm">${esc(t("noSpeakers"))}</p>`;
    list.forEach((p, i) => {
      const scheduled = draft.event_order.some((ev) => evSpeaker(ev) === sign * (i + 1));
      const row = document.createElement("div");
      row.className = "srow";
      row.innerHTML = `<span class="num">${i + 1}</span>
        <span class="name-cell">
          <input type="text" data-sp="${side}:${i}:name" value="${esc(p.name)}" placeholder="${esc(
            defaultSpeakerName(side, i, state.lang)
          )}" aria-label="${esc(t("fName") + " " + (i + 1))}" />
          ${scheduled ? "" : `<span class="tag-warn" title="${esc(t("notInOrderHint"))}">${esc(t("notInOrder"))}</span>`}
        </span>
        ${durInput(`sp:${side}:${i}`, p.time, t("fSpeakingTime"))}
        <button type="button" class="icon-btn danger" data-del-speaker="${side}:${i}" title="${esc(t("fRemove"))}" aria-label="${esc(
        t("fRemove") + " " + nameOf(sign * (i + 1), p)
      )}">${ICONS.trash}</button>`;
      root.appendChild(row);
    });
  }

  // -- Order & time page
  function pageOrder() {
    const s = draft.settings;
    const timeField = (labelKey, hintKey, path, v) =>
      `<div class="tfield"><span class="flabel">${esc(t(labelKey))}</span>${durInput(path, v, t(labelKey))}<span class="fhint">${esc(
        t(hintKey)
      )}</span></div>`;
    return `
      ${pageIntro("orderTitle", "orderIntro")}
      <section class="sgroup">
        <div class="sgroup-head">
          <h3>${esc(t("fEvents"))}</h3>
          ${segView()}
        </div>
        <p class="hint">${esc(t("fEventsHint"))}</p>
        <div class="chips order" id="event-chips"></div>
        <div class="order-tools">
          <span id="order-total" class="order-total"></span>
          <button type="button" class="btn btn-quiet sm" data-order-alternate>${ICONS.repeat}<span>${esc(t("orderAlternate"))}</span></button>
          <button type="button" class="btn btn-quiet sm" data-order-clear>${ICONS.trash}<span>${esc(t("orderClear"))}</span></button>
        </div>
        <div class="palette-row">
          <span class="palette-label">${esc(t("fAddLabel"))}</span>
          <div class="chips palette" id="event-palette"></div>
        </div>
      </section>
      <section class="sgroup">
        <h3>${esc(t("fTimes"))}</h3>
        <div class="tgrid">
          ${timeField("fWarning", "fWarningHint", "settings.time_warning", s.time_warning)}
          ${timeField("fPrep", "fPrepHint", "settings.time_prep", s.time_prep)}
          ${timeField("fFree", "fFreeHint", "settings.time_free", s.time_free)}
        </div>
      </section>
      <section class="sgroup">
        <h3>${esc(t("fBells"))}</h3>
        <p class="hint">${esc(t("fBellsHint"))}</p>
        <div class="opt-row"><span class="flabel">${esc(t("fWarningTone"))}</span>
          <span class="inline">${toneSelect("settings.warning_tone", s.warning_tone)}${playToneBtn(s.warning_tone)}</span>
        </div>
        <div class="opt-row"><span class="flabel">${esc(t("fMoreWarnings"))}</span>
          <div class="fstack">${cueEditor("round", s.extra_cues)}<span class="fhint">${esc(t("fMoreWarningsHint"))}</span></div>
        </div>
        <div class="opt-row"><span class="flabel">${esc(t("fGrace"))}</span>
          <div class="fstack">${durInput("settings.time_grace", s.time_grace, t("fGrace"))}<span class="fhint">${esc(
      t("fGraceHint")
    )}</span></div>
        </div>
      </section>`;
  }

  // ---- Warnings (cues) ------------------------------------------------------
  const TONE_KEYS = {
    warning: "toneWarning",
    end: "toneEnd",
    soft: "toneSoft",
    single: "toneSingle",
    double: "toneDouble",
    triple: "toneTriple",
  };
  function toneSelect(attr, current) {
    return `<select data-tone="${attr}" aria-label="${esc(t("cueTone"))}">${TONES.map(
      (tone) => `<option value="${tone}" ${tone === current ? "selected" : ""}>${esc(t(TONE_KEYS[tone]))}</option>`
    ).join("")}</select>`;
  }
  const playToneBtn = (tone) =>
    `<button type="button" class="btn btn-quiet sm" data-play-tone="${tone}" title="${esc(t("fPlay"))}">${ICONS.play}<span>${esc(
      t("fPlay")
    )}</span></button>`;

  // A list of warnings: "round" is the round's extra warnings, "part" the open part's own.
  function cueEditor(list, cues) {
    const rows = cues
      .map(
        (c, i) => `<div class="cue-row">
          ${durInput(`cue:${list}:${i}`, c.at, t("pCues"))}<span class="cue-left">${esc(t("cueLeft"))}</span>
          ${toneSelect(`cue:${list}:${i}`, c.tone)}${playToneBtn(c.tone)}
          <button type="button" class="icon-btn danger" data-cue-del="${list}:${i}" title="${esc(t("fRemove"))}" aria-label="${esc(
          t("fRemove")
        )}">${ICONS.trash}</button>
        </div>`
      )
      .join("");
    return `<div class="cue-list">${rows || `<span class="fhint">${esc(t("cuesNone"))}</span>`}</div>
      <button type="button" class="btn btn-quiet sm cue-add" data-cue-add="${list}">${ICONS.plus}<span>${esc(t("cueAdd"))}</span></button>`;
  }

  // The array a cue editor edits. Editing a part's warnings works on a copy
  // that is written back with putPart().
  function cueList(list) {
    if (list === "round") return draft.settings.extra_cues;
    return partCtx ? partCtx.obj.cues || [] : [];
  }
  function cueChanged(list) {
    if (list === "part") putPart();
  }

  function setTone(attr, tone) {
    if (attr === "settings.warning_tone") draft.settings.warning_tone = tone;
    else if (attr === "part") return;
    else {
      const [, list, i] = attr.split(":");
      const c = cueList(list)[Number(i)];
      if (c) c.tone = tone;
      cueChanged(list);
    }
  }

  function addCue(list) {
    const cues = cueList(list);
    const lowest = cues.reduce((m, c) => Math.min(m, c.at), Infinity);
    const at = lowest === Infinity ? 60 : Math.max(1, Math.round(lowest / 2));
    if (list === "part") partCtx.obj.cues = cues.concat([{ at, tone: "single" }]);
    else cues.push({ at, tone: "single" });
    cueChanged(list);
  }

  function delCue(spec) {
    const [list, i] = spec.split(":");
    cueList(list).splice(Number(i), 1);
    cueChanged(list);
  }

  // Plays a tone from the settings, with the sound files being edited.
  function previewTone(tone) {
    if (tone === "warning" || tone === "end") {
      const key = tone === "warning" ? "audio_warning" : "audio_end";
      const a = new Audio(draft.settings[key] || DEFAULT_AUDIO[tone]);
      const p = a.play();
      if (p && p.catch) p.catch(() => setError(t("fCannotPlay")));
    } else {
      knock(tone);
    }
  }

  // ---- Settings for one part --------------------------------------------------
  const partOverlay = $("part-overlay");
  let partCtx = null; // { idx, obj }: the part being edited, in its long form

  function openPartDialog(idx) {
    if (!commitView() || idx < 0 || idx >= draft.event_order.length) return;
    partCtx = { idx, obj: expandEvent(draft.event_order[idx]) };
    renderPartDialog();
    show(partOverlay, true);
    const first = $("part-fields").querySelector("button, input, select");
    if (first) first.focus();
  }

  function closePartDialog() {
    show(partOverlay, false);
    partCtx = null;
    if (page === "order") renderEventChips();
  }

  function putPart() {
    draft.event_order[partCtx.idx] = normalizeEvent(partCtx.obj);
    updateFoot();
  }

  function partChoice(field, options, current) {
    return `<div class="seg" role="radiogroup">${options
      .map(
        ([value, label]) =>
          `<button type="button" class="seg-btn ${JSON.stringify(value) === JSON.stringify(current) ? "active" : ""}" role="radio" aria-checked="${
            JSON.stringify(value) === JSON.stringify(current)
          }" data-part-set="${field}" data-value="${esc(JSON.stringify(value))}">${esc(label)}</button>`
      )
      .join("")}</div>`;
  }

  function renderPartDialog() {
    const o = partCtx.obj;
    const ev = normalizeEvent(o);
    const k = evKind(ev);
    const fmt = (sec) => formatTime(sec, true);
    $("part-dialog-title").textContent = t("partTitle")(partCtx.idx + 1, eventName(ev));
    const field = (label, body, hint) =>
      `<div class="fstack pfield"><span class="flabel">${esc(label)}</span>${body}${hint ? `<span class="fhint">${esc(hint)}</span>` : ""}</div>`;
    const parts = [];

    // Time
    const own = o.time != null;
    if (k === "shared" || k === "break") {
      parts.push(field(t("pTime"), durInput("pe:time", evTime(draft, ev), t("pTime"))));
    } else {
      const usual = evTime(draft, Object.assign({}, o, { time: undefined }));
      const usualLabel =
        k === "speech"
          ? t("pSpeakerTime")(nameOf(o.speaker, participant2(o.speaker)), fmt(usual))
          : t("pUsualTime")(fmt(usual));
      parts.push(
        field(
          t(k === "free" ? "pTimePerTeam" : "pTime"),
          `${partChoice("ownTime", [
            [false, usualLabel],
            [true, t(k === "speech" ? "pThisSpeech" : "pOwnTime")],
          ], own)}${own ? durInput("pe:time", o.time, t("pTime")) : ""}`,
          own ? t("pTimeHint") : ""
        )
      );
    }

    // What only some kinds of part have
    const pro = teamName(draft, "pro");
    const con = teamName(draft, "con");
    if (k === "speech") {
      parts.push(field(t("pProtected"), durInput("pe:protected", o.protected || 0, t("pProtected")), t("pProtectedHint")));
    } else if (k === "prep") {
      parts.push(field(t("pPrepFor"), partChoice("side", [[null, t("pBothTeams")], ["pro", pro], ["con", con]], o.side || null)));
    } else if (k === "free") {
      parts.push(
        field(t("pFirst"), partChoice("first", [[null, t("pOperator")], ["pro", pro], ["con", con]], o.first || null), t("pFirstHint"))
      );
    } else if (k === "shared") {
      const live = o.live && o.live.length === 1 ? o.live[0] : null;
      parts.push(field(t("pLive"), partChoice("live", [[null, t("pBothTeams")], ["pro", pro], ["con", con]], live)));
    }

    // Name, in both languages
    parts.push(
      field(
        t("pLabel"),
        `<div class="pnames">
          <input type="text" data-part-text="label" value="${esc(o.label || "")}" placeholder="${esc(
          partNameIn(draft, Object.assign({}, o, { label: "", label_zh: "" }))
        )}" aria-label="${esc(t("pLabel"))}" />
          <input type="text" data-part-text="label_zh" value="${esc(o.label_zh || "")}" placeholder="${esc(
          t("pLabelZh")
        )}" aria-label="${esc(t("pLabelZh"))}" />
        </div>`,
        t("pLabelHint")
      )
    );

    // Warnings
    const ownCues = Array.isArray(o.cues);
    parts.push(
      field(
        t("pCues"),
        `${partChoice("ownCues", [
          [false, t("pCuesRound")],
          [true, t("pCuesOwn")],
        ], ownCues)}${ownCues ? `<div class="pcues">${cueEditor("part", o.cues)}</div>` : ""}`
      )
    );

    $("part-fields").innerHTML = parts.join("");
  }

  function setPartChoice(fieldName, value) {
    const o = partCtx.obj;
    const ev = normalizeEvent(o) || o;
    if (fieldName === "ownTime") {
      if (value) o.time = evTime(draft, ev);
      else delete o.time;
    } else if (fieldName === "ownCues") {
      if (value) o.cues = cuesFor(draft, Object.assign({}, o, { cues: undefined }));
      else delete o.cues;
    } else if (fieldName === "live") {
      if (value) o.live = [value];
      else delete o.live;
    } else if (value) {
      o[fieldName] = value;
    } else {
      delete o[fieldName];
    }
    putPart();
    renderPartDialog();
  }

  $("part-dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    closePartDialog();
  });
  partOverlay.addEventListener("click", (e) => {
    if (e.target === partOverlay) return closePartDialog();
    const b = e.target.closest("button");
    if (!b || !partCtx) return;
    const d = b.dataset;
    if (d.partSet) setPartChoice(d.partSet, JSON.parse(d.value));
    else if (d.cueAdd) {
      addCue("part");
      renderPartDialog();
    } else if (d.cueDel) {
      delCue(d.cueDel);
      renderPartDialog();
    } else if (d.playTone) previewTone(d.playTone);
  });
  partOverlay.addEventListener("input", (e) => {
    const el = e.target;
    if (!partCtx) return;
    const group = el.closest(".dur");
    if (group) {
      const key = group.dataset.dur;
      const sec = durValue(group);
      if (key === "pe:time") partCtx.obj.time = sec;
      else if (key === "pe:protected") partCtx.obj.protected = sec;
      else if (key.startsWith("cue:part:")) {
        const c = cueList("part")[Number(key.split(":")[2])];
        if (c) c.at = sec;
      }
      putPart();
    } else if (el.dataset.partText) {
      partCtx.obj[el.dataset.partText] = el.value;
      putPart();
    }
  });
  partOverlay.addEventListener("change", (e) => {
    const el = e.target;
    if (!partCtx) return;
    const group = el.closest(".dur");
    if (group) normalizeDur(group);
    if (el.dataset.tone) {
      setTone(el.dataset.tone, el.value);
      renderPartDialog();
    }
  });

  function segView() {
    return `<div class="seg" role="radiogroup" aria-label="${esc(t("fEvents"))}">
      <button type="button" class="seg-btn ${orderView === "detailed" ? "active" : ""}" role="radio" aria-checked="${
      orderView === "detailed"
    }" data-view="detailed">${esc(t("viewDetailed"))}</button>
      <button type="button" class="seg-btn ${orderView === "simple" ? "active" : ""}" role="radio" aria-checked="${
      orderView === "simple"
    }" data-view="simple">${esc(t("viewSimple"))}</button>
    </div>`;
  }

  function updateOrderTotal() {
    const el = $("order-total");
    if (el) el.textContent = t("orderTotal")(draft.event_order.length, Math.round(roundStats(draft).total / 60));
  }

  // -- Display & sound page
  function pageDisplay() {
    const s = draft.settings;
    return `
      ${pageIntro("displayTitle", "displayIntro")}
      <section class="sgroup">
        <h3>${esc(t("fScreen"))}</h3>
        <div class="opt-row"><span class="flabel">${esc(t("fLanguage"))}</span>${seg(
      "settings.language",
      [
        ["en", "English"],
        ["zh", "中文"],
      ],
      s.language
    )}</div>
        <div class="opt-row"><span class="flabel">${esc(t("fClock"))}</span>${seg(
      "settings.display_minutes",
      [
        [true, t("clockMinutes")],
        [false, t("clockSeconds")],
      ],
      s.display_minutes
    )}</div>
        <div class="opt-row"><span class="flabel">${esc(t("fBackground"))}</span>
          <span class="inline">
            <label class="swatch"><input type="color" data-path="settings.background_color" value="${esc(
              s.background_color
            )}" aria-label="${esc(t("fBackground"))}" /></label>
            ${
              s.background_color === DEFAULT_SAVE.settings.background_color
                ? ""
                : `<button type="button" class="btn btn-quiet sm" data-bg-default>${ICONS.rotate}<span>${esc(t("fDefault"))}</span></button>`
            }
          </span>
        </div>
      </section>
      <section class="sgroup">
        <h3>${esc(t("fSounds"))}</h3>
        <div class="opt-row"><span class="flabel">${esc(t("fSoundOn"))}</span>${seg(
      "settings.sound",
      [
        [true, t("on")],
        [false, t("off")],
      ],
      s.sound
    )}</div>
        ${audioRow("fWarningSound", "audio_warning", DEFAULT_AUDIO.warning)}
        ${audioRow("fEndSound", "audio_end", DEFAULT_AUDIO.end)}
      </section>`;
  }

  function audioRow(labelKey, key, defaultSrc) {
    const v = draft.settings[key];
    const isFile = v.startsWith("data:");
    return `<div class="opt-row audio-row" data-audio="${key}">
      <span class="flabel">${esc(t(labelKey))}</span>
      <span class="audio-ctl">
        <input type="text" data-audio-url="${key}" placeholder="${esc(t("fBuiltinSound"))}"
          value="${esc(isFile ? t("fUploadedFile") : v)}" ${isFile ? "readonly" : ""} aria-label="${esc(t(labelKey) + " URL")}" />
        <button type="button" class="btn btn-mint sm" data-audio-play="${key}" data-default="${defaultSrc}">${ICONS.play}<span>${esc(
      t("fPlay")
    )}</span></button>
        <button type="button" class="btn btn-quiet sm" data-audio-file="${key}">${ICONS.music}<span>${esc(t("fChooseFile"))}</span></button>
        ${
          v
            ? `<button type="button" class="btn btn-quiet sm" data-audio-default="${key}">${ICONS.rotate}<span>${esc(
                t("fDefault")
              )}</span></button>`
            : ""
        }
      </span>
    </div>`;
  }

  // -- Advanced page
  function pageAdvanced() {
    const keys = [
      ["Space", "kSpace"],
      ["→ / N", "kNext"],
      ["← / P", "kPrev"],
      ["I", "kInvert"],
      ["F", "kFull"],
      ["S", "kSettings"],
      ["Ctrl + S", "kSave"],
      ["Esc", "kEsc"],
    ];
    const s = draft.settings;
    const choice = (labelKey, path, options, current, hintKey, extra) =>
      `<div class="opt-row"><span class="flabel">${esc(t(labelKey))}</span><div class="fstack">${
        options ? seg(path, options, current) : extra
      }<span class="fhint">${esc(t(hintKey))}</span></div></div>`;
    const zhName = (labelKey, path, value, placeholder) =>
      `<label class="fstack"><span class="flabel">${esc(t(labelKey))}</span><input type="text" data-path="${path}" value="${esc(
        value
      )}" placeholder="${esc(placeholder)}" /></label>`;
    return `
      ${pageIntro("advancedTitle", "advancedIntro")}
      <section class="sgroup">
        <h3>${esc(t("fBehaviour"))}</h3>
        ${choice("fAdvance", "settings.advance_starts", [[true, t("advStart")], [false, t("advPause")]], s.advance_starts, "fAdvanceHint")}
        ${choice("fFreeClocks", "settings.free_exclusive", [[false, t("freeBoth")], [true, t("freeOne")]], s.free_exclusive, "fFreeClocksHint")}
        ${choice("fOvertime", "settings.overtime", [[false, t("otStop")], [true, t("otCount")]], s.overtime, "fOvertimeHint")}
        ${choice("fCap", "", null, null, "fCapHint", durInput("settings.overtime_cap", s.overtime_cap, t("fCap")))}
      </section>
      <section class="sgroup">
        <h3>${esc(t("fBilingual"))}</h3>
        <p class="hint">${esc(t("fBilingualHint"))}</p>
        <div class="zh-names">
          ${zhName("fTitleZh", "title_zh", draft.title_zh, draft.title)}
          ${zhName("fProZh", "settings.pro_label_zh", s.pro_label_zh, s.pro_label || I18N.zh.proDefault)}
          ${zhName("fConZh", "settings.con_label_zh", s.con_label_zh, s.con_label || I18N.zh.conDefault)}
        </div>
      </section>
      <section class="sgroup">
        <h3>${esc(t("fJson"))}</h3>
        <p class="hint">${esc(t("fJsonHint"))}</p>
        <textarea id="editor" spellcheck="false" aria-label="${esc(t("fJson"))}">${esc(JSON.stringify(draft, null, 2))}</textarea>
        <div class="json-tools">
          <button type="button" class="btn btn-quiet sm" data-json-download>${ICONS.download}<span>${esc(t("download"))}</span></button>
          <button type="button" class="btn btn-quiet sm" data-json-upload>${ICONS.upload}<span>${esc(t("upload"))}</span></button>
        </div>
      </section>
      <section class="sgroup">
        <h3>${esc(t("fShortcuts"))}</h3>
        <dl class="keys">${keys.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(t(d))}</dd>`).join("")}</dl>
      </section>
      <section class="sgroup danger-zone">
        <h3>${esc(t("fReset"))}</h3>
        <p class="hint">${esc(t("fResetHint"))}</p>
        <button type="button" class="btn btn-red sm" data-reset-all>${ICONS.rotate}<span>${esc(t("resetDefaults"))}</span></button>
      </section>`;
  }

  // ---- Event order ------------------------------------------------------------
  function eventName(ev) {
    const id = evSpeaker(ev);
    if (id !== null && !participant2(id)) return t("fNoSpeaker");
    return partNameIn(draft, ev);
  }

  const sideName = (id) => teamName(draft, id > 0 ? "pro" : "con");

  // Long description for the detailed view, e.g. "Pro 1 · 正一" and "3:00".
  function eventDetail(ev) {
    const k = evKind(ev);
    const label = labelOf(ev);
    let time = formatTime(evTime(draft, ev), true);
    if (k === "free") time += ` ${t("perSide")}`;
    if (k !== "speech") return { text: partNameIn(draft, ev), time };
    const id = evSpeaker(ev);
    const p = participant2(id);
    const who = `${sideName(id)} ${Math.abs(id)}`;
    if (!p) return { text: `${who} · ${t("fNoSpeaker")}`, time: "" };
    const name = label || p.name;
    return { text: name ? `${who} · ${name}` : who, time };
  }

  function makeChip(ev, extra) {
    const chip = document.createElement("span");
    const k = evKind(ev);
    const id = evSpeaker(ev);
    const missing = id !== null && !participant2(id);
    const custom = typeof ev === "object" && !extra;
    chip.className =
      "chip " +
      (k === "speech" ? (id > 0 ? "c-pro" : "c-con") : "c-" + k) +
      (missing ? " c-missing" : "") +
      (custom ? " c-custom" : "") +
      (extra ? " " + extra : "");
    chip.title = eventName(ev) + (custom ? ` · ${t("partCustom")}` : "");
    const mark = custom ? `<i class="opt-dot" aria-hidden="true"></i>` : "";
    if (orderView === "detailed") {
      const d = eventDetail(ev);
      chip.innerHTML = `<span class="lbl">${esc(eventLabel(ev))}</span><span class="txt">${esc(d.text)}</span>${mark}<span class="dur-t">${esc(
        d.time
      )}</span>`;
    } else {
      chip.innerHTML = `<span class="lbl">${esc(eventLabel(ev))}</span>${mark}`;
    }
    return chip;
  }

  function renderEventChips() {
    const root = $("event-chips");
    if (!root) return;
    root.innerHTML = "";
    root.classList.toggle("vertical", orderView === "detailed");
    $("event-palette").classList.toggle("detailed", orderView === "detailed");
    if (draft.event_order.length === 0) {
      root.innerHTML = `<span class="empty">${esc(t("fEmptyOrder"))}</span>`;
    }
    draft.event_order.forEach((ev, i) => {
      const chip = makeChip(ev);
      chip.dataset.idx = String(i);
      chip.tabIndex = 0;
      if (orderView === "detailed") {
        chip.insertAdjacentHTML(
          "beforeend",
          `<button type="button" class="ed" data-edit-event="${i}" title="${esc(t("partSettings"))}" aria-label="${esc(
            t("partSettings") + ": " + eventName(ev)
          )}">${ICONS.sliders}</button>`
        );
      }
      chip.insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="x" data-del-event="${i}" title="${esc(t("fRemove"))}" aria-label="${esc(
          t("fRemove") + " " + eventName(ev)
        )}">×</button>`
      );
      root.appendChild(chip);
    });
    renderPalette();
    updateOrderTotal();
    updateFoot();
  }

  function renderPalette() {
    const root = $("event-palette");
    root.innerHTML = "";
    const groups = [
      { label: t("fPhases"), items: ["prep", "free", { kind: "shared" }, { kind: "break" }] },
      { label: sideName(1), items: draft.pro_side.map((_, i) => i + 1) },
      { label: sideName(-1), items: draft.con_side.map((_, i) => -(i + 1)) },
    ];
    groups.forEach(({ label, items }) => {
      const group = document.createElement("div");
      group.className = "palette-group";
      group.innerHTML = `<span class="palette-group-label">${esc(label)}</span>`;
      items.forEach((ev) => {
        const chip = makeChip(ev, "add");
        chip.dataset.addEv = JSON.stringify(ev);
        chip.setAttribute("role", "button");
        chip.tabIndex = 0;
        group.appendChild(chip);
      });
      root.appendChild(group);
    });
  }

  // A click on a chip that was just dragged is not a request to open it.
  let justDragged = false;

  // Pointer-based drag reordering for the event chips (mouse + touch).
  (function enableChipDrag() {
    const rootEl = () => $("event-chips");
    let root = null;
    let dragEl = null;
    let ghost = null;
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let pointerId = null;

    function moveGhost(e) {
      ghost.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px)`;
    }

    function placeAt(e) {
      const chips = Array.from(root.querySelectorAll(".chip")).filter((c) => c !== dragEl);
      if (!chips.length) return;
      let best = null;
      let bestDist = Infinity;
      for (const c of chips) {
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot((e.clientX - cx) * 0.6, e.clientY - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      const r = best.getBoundingClientRect();
      const before = root.classList.contains("vertical")
        ? e.clientY < r.top + r.height / 2
        : e.clientX < r.left + r.width / 2;
      if (before) root.insertBefore(dragEl, best);
      else root.insertBefore(dragEl, best.nextSibling);
      if (ghost && root.classList.contains("vertical")) {
        ghost.dataset.step = String(Array.from(root.querySelectorAll(".chip")).indexOf(dragEl) + 1);
      }
    }

    document.addEventListener("pointerdown", (e) => {
      if (dragEl) endDrag();
      root = rootEl();
      if (!root || !root.contains(e.target)) return;
      const chip = e.target.closest(".chip");
      if (!chip || e.target.closest(".x, .ed") || e.button !== 0) return;
      dragEl = chip;
      dragging = false;
      sx = e.clientX;
      sy = e.clientY;
      pointerId = e.pointerId;
      // Capture on the stable list: moving the chip itself can otherwise drop
      // pointer capture and leave the drag preview stranded on screen.
      try {
        root.setPointerCapture(pointerId);
      } catch (_) {
        /* document listeners remain as a fallback */
      }
    });

    document.addEventListener("pointermove", (e) => {
      if (!dragEl || e.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
        dragging = true;
        const r = dragEl.getBoundingClientRect();
        ghost = dragEl.cloneNode(true);
        ghost.classList.add("ghost");
        if (root.classList.contains("vertical")) {
          ghost.classList.add("vertical-ghost");
          ghost.dataset.step = String(Array.from(root.querySelectorAll(".chip")).indexOf(dragEl) + 1);
        }
        ghost.style.left = `${r.left}px`;
        ghost.style.top = `${r.top}px`;
        ghost.style.width = `${r.width}px`;
        ghost.style.height = `${r.height}px`;
        document.body.appendChild(ghost);
        dragEl.classList.add("dragging");
      }
      moveGhost(e);
      placeAt(e);
    });

    function endDrag(e) {
      if (!dragEl) return;
      if (e && e.pointerId != null && e.pointerId !== pointerId) return;
      const finishedRoot = root;
      const finishedChip = dragEl;
      const finishedGhost = ghost;
      const finishedPointer = pointerId;
      const didDrag = dragging;
      root = null;
      dragEl = null;
      ghost = null;
      pointerId = null;
      dragging = false;

      finishedChip.classList.remove("dragging");
      if (finishedGhost) finishedGhost.remove();
      try {
        if (finishedRoot && finishedPointer != null && finishedRoot.hasPointerCapture(finishedPointer)) {
          finishedRoot.releasePointerCapture(finishedPointer);
        }
      } catch (_) {
        /* capture may already have been released by the browser */
      }
      if (didDrag && finishedRoot && finishedRoot.isConnected) {
        const before = draft.event_order.slice();
        draft.event_order = Array.from(finishedRoot.querySelectorAll(".chip")).map((c) => before[Number(c.dataset.idx)]);
        justDragged = true;
        setTimeout(() => (justDragged = false), 0);
        renderEventChips();
      }
    }
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    document.addEventListener("lostpointercapture", endDrag);
    window.addEventListener("blur", () => endDrag());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) endDrag();
    });
  })();

  const participant2 = (id) => speakerOf(draft, id);

  function setPath(obj, path, value) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = value;
  }

  let removalPending = false;
  function slideRemove(el, onDone) {
    if (!el || removalPending) return;
    removalPending = true;
    els.form.classList.add("removal-active");
    els.form.setAttribute("aria-busy", "true");

    const container = el.parentElement;
    const isChip = el.classList.contains("chip");
    const peers = () =>
      Array.from(container.children).filter((child) =>
        isChip ? child.classList.contains("chip") : child.classList.contains("srow") && !child.classList.contains("head")
      );
    const oldRects = peers()
      .filter((child) => child !== el)
      .map((child) => child.getBoundingClientRect());
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add("removal-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    if (isChip) {
      ghost.classList.add("ghost");
      if (container.classList.contains("vertical")) {
        ghost.classList.add("vertical-ghost");
        ghost.dataset.step = String(peers().indexOf(el) + 1);
      }
    }
    Object.assign(ghost.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    document.body.appendChild(ghost);

    // Update the data and layout once, then animate only compositor-friendly
    // transforms. This avoids a full settings-panel reflow on every frame.
    onDone();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 220;
    const animations = peers().map((child, i) => {
      const before = oldRects[i];
      const after = child.getBoundingClientRect();
      const dx = before ? before.left - after.left : 0;
      const dy = before ? before.top - after.top : 0;
      return child.animate(
        [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
        { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    });
    animations.push(
      ghost.animate(
        [
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
          { opacity: 0, transform: "translate3d(-72px, 0, 0) scale(0.98)" },
        ],
        { duration, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
      )
    );

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ghost.remove();
      removalPending = false;
      els.form.classList.remove("removal-active");
      els.form.removeAttribute("aria-busy");
    };
    Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
    setTimeout(finish, duration + 100);
  }

  // ---- Durations --------------------------------------------------------------
  function setDur(key, sec) {
    if (key.startsWith("cue:")) {
      const [, list, i] = key.split(":");
      const c = cueList(list)[Number(i)];
      if (c) c.at = sec;
    } else if (key.startsWith("sp:")) {
      const [, side, idx] = key.split(":");
      const p = draft[side + "_side"][Number(idx)];
      if (p) p.time = sec;
    } else {
      setPath(draft, key, sec);
    }
  }
  const digits = (v) => Number(String(v).replace(/\D/g, "")) || 0;
  function durValue(group) {
    return digits(group.querySelector(".dur-m").value) * 60 + digits(group.querySelector(".dur-s").value);
  }
  // Tidy the boxes once editing is done, e.g. 0 min 90 sec becomes 1 min 30 sec.
  function normalizeDur(group) {
    const total = durValue(group);
    const s = total % 60;
    group.querySelector(".dur-m").value = String(Math.floor(total / 60));
    group.querySelector(".dur-s").value = (s < 10 ? "0" : "") + s;
  }

  // ---- Speakers -----------------------------------------------------------------
  function addSpeaker(side) {
    const list = draft[side + "_side"];
    const last = list[list.length - 1];
    list.push({ name: "", time: last ? last.time : 120 });
    renderSpeakerList(side);
    const inputs = $("list-" + side).querySelectorAll("input[data-sp$=':name']");
    if (inputs.length) inputs[inputs.length - 1].focus();
    updateFoot();
  }

  // Remove a speaker, and drop or renumber their turns so the order still
  // points at the same people.
  function removeSpeaker(side, idx) {
    const sign = side === "pro" ? 1 : -1;
    const n = idx + 1;
    draft[side + "_side"].splice(idx, 1);
    draft.event_order = draft.event_order
      .filter((ev) => evSpeaker(ev) !== sign * n)
      .map((ev) => {
        const id = evSpeaker(ev);
        if (id === null || Math.sign(id) !== sign || Math.abs(id) <= n) return ev;
        return typeof ev === "number" ? ev - sign : Object.assign({}, ev, { speaker: id - sign });
      });
    renderSpeakerList(side);
    updateFoot();
  }

  // ---- Presets ------------------------------------------------------------------
  const presetOverlay = $("preset-overlay");
  let presetCtx = null; // { mode: "new" | "edit", preset?, icon }

  function renderIconGrid() {
    const icons = PRESET_ICONS.includes(presetCtx.icon) ? PRESET_ICONS : [presetCtx.icon].concat(PRESET_ICONS);
    $("preset-icons").innerHTML = icons
      .map(
        (ic) =>
          `<button type="button" class="icon-opt" role="radio" aria-checked="${ic === presetCtx.icon}" data-icon="${esc(ic)}">${esc(
            ic
          )}</button>`
      )
      .join("");
  }

  function openPresetDialog(mode, preset) {
    presetCtx = { mode, preset, icon: preset ? preset.icon : PRESET_ICONS[0] };
    const isEdit = mode === "edit";
    $("preset-dialog-title").textContent = t(isEdit ? "editPresetTitle" : "newPresetTitle");
    $("preset-dialog-text").textContent = t(isEdit ? "editPresetText" : "newPresetText");
    $("preset-name").value = isEdit ? preset.name : cleanName(draft.title) || t("newPresetName");
    $("preset-update").checked = false;
    show($("preset-update-row"), isEdit);
    $("preset-ok").textContent = t(isEdit ? "save" : "savePreset");
    renderIconGrid();
    show(presetOverlay, true);
    $("preset-name").focus();
    $("preset-name").select();
  }

  function closePresetDialog() {
    show(presetOverlay, false);
    presetCtx = null;
  }

  $("preset-dialog").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName($("preset-name").value);
    if (!name) {
      $("preset-name").focus();
      return;
    }
    if (!commitView()) return;
    let p;
    if (presetCtx.mode === "edit") {
      p = userPresets.find((x) => x.id === presetCtx.preset.id);
      if (!p) return closePresetDialog();
      p.name = name;
      p.icon = presetCtx.icon;
      if ($("preset-update").checked) p.round = roundOf(draft);
    } else {
      p = { id: newId(), name, icon: presetCtx.icon, round: roundOf(draft) };
      userPresets.push(p);
    }
    const err = storeUserPresets();
    closePresetDialog();
    notice = err ? "" : t("presetSaved")(name);
    renderForm();
    if (err) setError(t("saveFailed") + err);
  });
  $("preset-cancel").addEventListener("click", closePresetDialog);
  presetOverlay.addEventListener("click", (e) => {
    if (e.target === presetOverlay) closePresetDialog();
    const b = e.target.closest("[data-icon]");
    if (!b) return;
    presetCtx.icon = b.dataset.icon;
    renderIconGrid();
    const sel = $("preset-icons").querySelector(`[aria-checked="true"]`);
    if (sel) sel.focus();
  });

  function usePreset(id) {
    const p = findPreset(id);
    if (!p || !commitView()) return;
    applyRound(draft, p.round);
    notice = t("presetLoaded")(presetName(p));
    renderForm();
  }

  function importPresets() {
    pickFiles("application/json,.json", true, (files) => {
      const added = [];
      const failed = [];
      files.forEach((f) => {
        try {
          added.push(parsePresetFile(f.text, f.name));
        } catch (e) {
          failed.push(`${f.name} (${e.message})`);
        }
      });
      if (added.length) {
        userPresets = userPresets.concat(added);
        const err = storeUserPresets();
        if (err) {
          userPresets = userPresets.slice(0, userPresets.length - added.length);
          failed.push(t("saveFailed") + err);
          added.length = 0;
        }
      }
      notice = added.length ? t("presetsAdded")(added.length) : "";
      renderForm();
      setError(failed.length ? t("presetImportFailed") + failed.join("; ") : "");
    });
  }

  // ---- Delegated form events --------------------------------------------------
  els.nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b) goPage(b.dataset.page);
  });
  els.nav.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const i = PAGES.findIndex((p) => p.id === page);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    goPage(PAGES[(i + step + PAGES.length) % PAGES.length].id);
    const active = els.nav.querySelector(".snav-btn.active");
    if (active) active.focus();
  });

  els.form.addEventListener("input", (e) => {
    const el = e.target;
    notice = "";
    if (el.id === "editor") {
      try {
        draft = parseSave(el.value);
        setError("");
      } catch (_) {
        /* reported on save or when leaving the page */
      }
    } else if (el.closest(".dur")) {
      const group = el.closest(".dur");
      setDur(group.dataset.dur, durValue(group));
      if (page === "order") {
        updateOrderTotal();
        renderEventChips();
      }
    } else if (el.dataset.path) {
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (el.type === "color") v = el.value.toUpperCase();
      else v = el.value;
      setPath(draft, el.dataset.path, v);
      if (el.type === "color") {
        const card = el.closest(".side-card");
        if (card) {
          card.style.setProperty("--side", v);
          card.style.setProperty("--side-ink", inkFor(v));
        }
      }
    } else if (el.dataset.sp) {
      const [side, idx] = el.dataset.sp.split(":");
      const p = draft[side + "_side"][Number(idx)];
      if (p) p.name = el.value;
    } else if (el.dataset.audioUrl) {
      draft.settings[el.dataset.audioUrl] = el.value.trim();
    }
    updateFoot();
  });

  els.form.addEventListener("change", (e) => {
    const group = e.target.closest(".dur");
    if (group) normalizeDur(group);
    if (e.target.dataset.tone) {
      setTone(e.target.dataset.tone, e.target.value);
      renderForm();
      updateFoot();
    }
    if (e.target.dataset.path === "settings.background_color" && page === "display") renderForm();
  });

  // Palette chips act as buttons for the keyboard too.
  els.form.addEventListener("keydown", (e) => {
    const chip = e.target.closest && e.target.closest(".chip.add, #event-chips .chip");
    if (chip && e.target === chip && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      chip.click();
    }
  });

  els.form.addEventListener("click", (e) => {
    // A chip in the order opens that part's settings.
    const chip = e.target.closest("#event-chips .chip");
    if (chip && !e.target.closest("button") && !justDragged) {
      openPartDialog(Number(chip.dataset.idx));
      return;
    }
    const b = e.target.closest("button, .chip.add");
    if (!b) return;
    const d = b.dataset;
    if (d.playTone) {
      previewTone(d.playTone);
    } else if (d.cueAdd) {
      addCue(d.cueAdd);
      renderForm();
    } else if (d.cueDel) {
      delCue(d.cueDel);
      renderForm();
    } else if (d.usePreset) {
      usePreset(d.usePreset);
    } else if (d.presetNew !== undefined) {
      if (commitView()) openPresetDialog("new");
    } else if (d.presetImport !== undefined) {
      importPresets();
    } else if (d.editPreset) {
      const p = findPreset(d.editPreset);
      if (p) openPresetDialog("edit", p);
    } else if (d.downloadPreset) {
      const p = findPreset(d.downloadPreset);
      if (p) downloadJson(presetFile(p), fileNameFor(presetName(p)));
    } else if (d.deletePreset) {
      const p = findPreset(d.deletePreset);
      if (!p) return;
      confirmDialog({
        title: t("deletePresetTitle")(p.name),
        text: t("deletePresetText"),
        primary: {
          label: t("deletePreset"),
          cls: "btn-red",
          action: () => {
            userPresets = userPresets.filter((x) => x.id !== p.id);
            storeUserPresets();
            notice = "";
            renderForm();
          },
        },
      });
    } else if (d.addSpeaker) {
      addSpeaker(d.addSpeaker);
    } else if (d.delSpeaker) {
      const [side, idx] = d.delSpeaker.split(":");
      slideRemove(b.closest(".srow"), () => removeSpeaker(side, Number(idx)));
    } else if (d.setPath) {
      const v = JSON.parse(d.value);
      setPath(draft, d.setPath, v);
      if (d.setPath === "settings.language") {
        state.lang = v;
        applyI18n();
      }
      renderForm();
    } else if (d.view) {
      orderView = d.view === "detailed" ? "detailed" : "simple";
      writeLocal(ORDER_VIEW_KEY, orderView);
      els.form.querySelectorAll("[data-view]").forEach((s) => {
        s.classList.toggle("active", s.dataset.view === orderView);
        s.setAttribute("aria-checked", String(s.dataset.view === orderView));
      });
      renderEventChips();
    } else if (d.addEv !== undefined) {
      draft.event_order.push(JSON.parse(d.addEv));
      renderEventChips();
    } else if (d.editEvent !== undefined) {
      openPartDialog(Number(d.editEvent));
    } else if (d.delEvent !== undefined) {
      slideRemove(b.closest(".chip"), () => {
        draft.event_order.splice(Number(d.delEvent), 1);
        renderEventChips();
      });
    } else if (d.orderAlternate !== undefined) {
      confirmDialog({
        title: t("orderAlternateTitle"),
        text: t("orderAlternateText"),
        primary: {
          label: t("orderAlternate"),
          cls: "btn-mint",
          action: () => {
            const order = [];
            for (let i = 1; i <= Math.max(draft.pro_side.length, draft.con_side.length); i++) {
              if (i <= draft.pro_side.length) order.push(i);
              if (i <= draft.con_side.length) order.push(-i);
            }
            draft.event_order = order;
            renderEventChips();
          },
        },
      });
    } else if (d.orderClear !== undefined) {
      if (!draft.event_order.length) return;
      confirmDialog({
        title: t("orderClearTitle"),
        text: t("orderClearText"),
        primary: {
          label: t("orderClear"),
          cls: "btn-red",
          action: () => {
            draft.event_order = [];
            renderEventChips();
          },
        },
      });
    } else if (d.bgDefault !== undefined) {
      draft.settings.background_color = DEFAULT_SAVE.settings.background_color;
      renderForm();
    } else if (d.audioFile) {
      const key = d.audioFile;
      els.audioFileInput.onchange = () => {
        const f = els.audioFileInput.files && els.audioFileInput.files[0];
        els.audioFileInput.value = "";
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) {
          setError(t("fFileTooBig"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          draft.settings[key] = String(reader.result);
          setError("");
          renderForm();
        };
        reader.readAsDataURL(f);
      };
      els.audioFileInput.click();
    } else if (d.audioDefault) {
      draft.settings[d.audioDefault] = "";
      renderForm();
    } else if (d.audioPlay) {
      const src = draft.settings[d.audioPlay] || d.default;
      const a = new Audio(src);
      const p = a.play();
      if (p && p.catch) p.catch(() => setError(t("fCannotPlay")));
    } else if (d.jsonDownload !== undefined) {
      if (commitView()) downloadJson(draft, "debate-timer-settings.json");
    } else if (d.jsonUpload !== undefined) {
      pickFiles("application/json,.json", false, (files) => {
        const ed = $("editor");
        if (!ed) return;
        ed.value = files[0].text;
        ed.dispatchEvent(new Event("input", { bubbles: true }));
      });
    } else if (d.resetAll !== undefined) {
      confirmDialog({
        title: t("resetTitle"),
        text: t("resetText"),
        primary: {
          label: t("resetDefaults"),
          cls: "btn-red",
          action: () => {
            draft = parseSave(DEFAULT_TEXT);
            if (state.lang !== draft.settings.language) {
              state.lang = draft.settings.language;
              applyI18n();
            }
            notice = "";
            setError("");
            renderForm();
          },
        },
      });
    }
  });

  els.form.addEventListener("submit", (e) => e.preventDefault());

  $("btn-menu").addEventListener("click", () => {
    if (els.menuOverlay.classList.contains("hidden")) openMenu();
    else requestClose();
  });
  $("btn-close").addEventListener("click", requestClose);
  els.btnSave.addEventListener("click", saveAndApply);
  els.btnDiscard.addEventListener("click", () => {
    draft = storedDraft();
    notice = "";
    setError("");
    if (state.lang !== draft.settings.language) {
      state.lang = draft.settings.language;
      applyI18n();
    }
    renderForm();
  });
  els.menuOverlay.addEventListener("click", (e) => {
    if (e.target === els.menuOverlay) requestClose();
  });

  // Language button: edits the draft and previews the UI; saved with Save & Apply.
  els.btnLang.addEventListener("click", () => {
    if (!commitView()) return;
    state.lang = state.lang === "en" ? "zh" : "en";
    draft.settings.language = state.lang;
    applyI18n();
    renderForm();
  });


  // ---------------------------------------------------------------------------
  // Global buttons, keyboard, end screen
  // ---------------------------------------------------------------------------
  $("btn-reload").addEventListener("click", requestReload);
  $("btn-end-reload").addEventListener("click", loadScene);
  $("btn-end-close").addEventListener("click", () => show(els.endOverlay, false));
  els.btnNext.addEventListener("click", next);
  els.btnPrev.addEventListener("click", previous);

  // Fullscreen
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  $("btn-fullscreen").addEventListener("click", toggleFullscreen);

  // Screen wake lock while a debate is in progress
  let wakeLock = null;
  function updateWakeLock() {
    if (!("wakeLock" in navigator)) return;
    const want = state.eventIndex >= 0 && !document.hidden;
    if (want && !wakeLock) {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          wakeLock = l;
          l.addEventListener("release", () => {
            wakeLock = null;
          });
        })
        .catch(() => {});
    } else if (!want && wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  document.addEventListener("visibilitychange", updateWakeLock);

  let lastBar = null; // last bar timer that ran, for the Space shortcut

  document.addEventListener("keydown", (e) => {
    const menuOpen = !els.menuOverlay.classList.contains("hidden");
    const confirmOpen = !confirmOverlay.classList.contains("hidden");
    const presetOpen = !presetOverlay.classList.contains("hidden");
    const partOpen = !partOverlay.classList.contains("hidden");
    if (e.key === "Escape") {
      if (confirmOpen) show(confirmOverlay, false);
      else if (presetOpen) closePresetDialog();
      else if (partOpen) closePartDialog();
      else if (menuOpen) requestClose();
      else if (!els.endOverlay.classList.contains("hidden")) show(els.endOverlay, false);
      return;
    }
    if (menuOpen && !confirmOpen && !presetOpen && !partOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveAndApply();
      return;
    }
    if (menuOpen || confirmOpen || presetOpen) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const key = e.key.toLowerCase();
    if (e.key === " ") {
      e.preventDefault();
      if (state.freePhase) {
        const running = barTimers.find((bt) => bt.running);
        if (running) running.stop();
        else (lastBar || barPro).toggle();
      } else if (!els.ringTimer.classList.contains("hidden")) {
        ringTimer.toggle();
      }
    } else if (e.key === "ArrowRight" || key === "n") {
      next();
    } else if (e.key === "ArrowLeft" || key === "p") {
      previous();
    } else if (key === "i" && state.freePhase) {
      invert();
    } else if (key === "f") {
      toggleFullscreen();
    } else if (key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openMenu();
    }
  });

  window.addEventListener("resize", () => {
    fitSpeakerSize();
    syncStepWidths();
  });
  // The stage also changes height when the title wraps onto a second line.
  if ("ResizeObserver" in window) new ResizeObserver(() => fitSpeakerSize()).observe(els.proCol.parentElement);

  // ---------------------------------------------------------------------------
  // Main loop (Update)
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let lastHousekeeping = 0;
  function update(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    ringTimer.tick(dt);
    barTimers.forEach((bt) => bt.tick(dt));
    ringTimer.render();
    barTimers.forEach((bt) => bt.render());
    updateSpeakerIndicators();
    const runningBar = barTimers.find((bt) => bt.running);
    if (runningBar) lastBar = runningBar;
    if (now - lastHousekeeping > 500) {
      lastHousekeeping = now;
      if (state.eventIndex >= 0) persistProgress();
      updateWakeLock();
    }
  }
  function frame(now) {
    update(now);
    requestAnimationFrame(frame);
  }
  // Background tabs throttle rAF; keep the clock honest with a coarse interval too.
  setInterval(() => {
    if (document.hidden) update(performance.now());
  }, 500);

  const savedProgress = readProgress();
  loadScene();
  if (savedProgress) restoreProgress(savedProgress);
  requestAnimationFrame(frame);
})();
