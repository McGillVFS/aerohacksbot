const BRAND_BLUE = 3447003;
const PREVIEW_ORANGE = 15105570;

export const GO_LIVE_CHANNELS = {
  announcements: { id: "1440784110200160390", name: "📢│announcements" },
  welcome: { id: "1440784110200160391", name: "👋│welcome" },
  rules: { id: "1440784110200160392", name: "📝│rules" },
  faq: { id: "1440784110200160393", name: "❓│faq-and-resources" },
  gettingStarted: { id: "1440784110200160394", name: "🌱│getting-started" },
  staffChat: { id: "1440784110200160396", name: "💬│staff-chat" },
  modLog: { id: "1440784110200160398", name: "🛡│mod-log" },
  introductions: { id: "1440784110434914336", name: "🔰│introductions" },
  general: { id: "1440784110434914337", name: "💬│general" },
  eventQuestions: { id: "1440784110434914338", name: "❓│event-questions" },
  sponsor: { id: "1440784110434914343", name: "💬│sponsor-1" },
  offTopic: { id: "1440784110757871627", name: "👾│off-topic" },
  workshop: { id: "1440784110757871628", name: "🎒│workshop" },
  whois: { id: "1440784110757871631", name: "👤│whois" },
  getMentor: { id: "1440784110757871632", name: "✋│get-a-mentor" },
  mentorRoom: { id: "1440784110757871633", name: "💬│mentor-room" },
  botCommands: { id: "1467603518515970109", name: "bot-commands" },
};

const OFFICIAL_SOURCES = {
  website: "https://www.mcgillaerohacks.com",
  devpost: "https://mcgill-aerohacks.devpost.com",
  mlhCodeOfConduct: "https://github.com/MLH/mlh-policies/blob/main/code-of-conduct.md",
  mlhReport: "https://mlh.io/report",
};

function addSeedFooter(footerText, seedKey) {
  const base = footerText ? `${footerText} • ` : "";
  return `${base}[seed:${seedKey}]`;
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

async function fetchTextWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, title: null };
    }
    const text = await response.text();
    return { ok: true, status: response.status, title: extractTitle(text) };
  } catch {
    return { ok: false, status: null, title: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOfficialSourceSnapshot() {
  const [website, devpost] = await Promise.all([
    fetchTextWithTimeout(OFFICIAL_SOURCES.website),
    fetchTextWithTimeout(OFFICIAL_SOURCES.devpost),
  ]);

  return {
    checkedAtIso: new Date().toISOString(),
    website,
    devpost,
  };
}

function sourceStatusLine(label, url, result) {
  if (result.ok) {
    const titleSuffix = result.title ? ` (${result.title})` : "";
    return `- ${label}: ${url}${titleSuffix}`;
  }
  return `- ${label}: ${url} (currently unavailable, use when accessible)`;
}

function faqSourceField(snapshot) {
  return [
    "For latest event specifics (timelines, prizes, and logistics), use:",
    sourceStatusLine("Website", OFFICIAL_SOURCES.website, snapshot.website),
    sourceStatusLine("Devpost", OFFICIAL_SOURCES.devpost, snapshot.devpost),
  ].join("\n");
}

function baseEmbed({ title, description, fields, footerText, seedKey, color = BRAND_BLUE }) {
  return {
    title,
    description,
    color,
    fields,
    footer: {
      text: addSeedFooter(footerText, seedKey),
    },
  };
}

export function buildPreviewEmbed(seed) {
  return {
    title: `PREVIEW • ${seed.embed.title}`,
    description: `Target channel: <#${seed.channelId}>\n\n${seed.embed.description ?? ""}`,
    color: PREVIEW_ORANGE,
    fields: [
      {
        name: "Publish behavior",
        value: seed.pin ? "Will be posted and pinned in finalize phase." : "Will be posted in finalize phase.",
      },
      ...seed.embed.fields,
    ],
    footer: {
      text: addSeedFooter(`Preview for ${seed.key}`, `go-live-preview:${seed.key}`),
    },
  };
}

export function buildGoLiveSeeds(snapshot) {
  const checkedAt = new Date(snapshot.checkedAtIso).toUTCString();

  return [
    {
      key: "welcome",
      channelId: GO_LIVE_CHANNELS.welcome.id,
      pin: true,
      embed: baseEmbed({
        title: "👋 Welcome to McGill AeroHacks",
        description:
          "We are excited to have you here. This server is where announcements, support, mentorship, and team formation happen during AeroHacks.",
        fields: [
          {
            name: "Start here",
            value: [
              "1. Read <#1440784110200160392>.",
              "2. Verify with `/verify email:<your registration email>` in <#1467603518515970109>.",
              "3. Check <#1440784110200160393> and <#1440784110200160394> for logistics.",
            ].join("\n"),
          },
          {
            name: "Need help?",
            value: "Use <#1440784110434914338> for questions and contact `@Event Staff` for urgent support.",
          },
        ],
        footerText: "AeroHacks onboarding",
        seedKey: "go-live:welcome:v1",
      }),
    },
    {
      key: "rules",
      channelId: GO_LIVE_CHANNELS.rules.id,
      pin: true,
      legacyTitleMatch: "✈️ McGill AeroHacks Discord Rules",
      embed: baseEmbed({
        title: "✈️ McGill AeroHacks Discord Rules",
        description:
          "Be respectful, professional, and inclusive. Participation in this server means following the MLH Code of Conduct and organizer instructions.",
        fields: [
          {
            name: "Core expectations",
            value: [
              "- No harassment, hate speech, discrimination, or doxxing.",
              "- No NSFW, violent, or disturbing content.",
              "- Follow channel topics and staff moderation decisions.",
            ].join("\n"),
          },
          {
            name: "Safety and reporting",
            value: [
              `- Report concerns to staff or ${OFFICIAL_SOURCES.mlhReport}`,
              "- MLH Emergency Hotline (24/7): +1 (409) 202-6060",
              `- Full policy: ${OFFICIAL_SOURCES.mlhCodeOfConduct}`,
            ].join("\n"),
          },
        ],
        footerText: "By participating, you agree to server rules and MLH policies.",
        seedKey: "go-live:rules:v1",
      }),
    },
    {
      key: "faq",
      channelId: GO_LIVE_CHANNELS.faq.id,
      pin: true,
      embed: baseEmbed({
        title: "❓ FAQ and Resources",
        description: "Quick answers to common AeroHacks questions. This message is updated as official details evolve.",
        fields: [
          {
            name: "How do I get verified?",
            value: "Run `/verify email:<your registration email>` in <#1467603518515970109>.",
          },
          {
            name: "Who can participate?",
            value: "Follow official eligibility criteria published on the event website and Devpost.",
          },
          {
            name: "Where are the latest official details?",
            value: faqSourceField(snapshot),
          },
          {
            name: "Support channels",
            value: [
              "- Event questions: <#1440784110434914338>",
              "- Mentor request: <#1440784110757871632>",
              "- Mentor discussion: <#1440784110757871633>",
            ].join("\n"),
          },
        ],
        footerText: `Sources checked: ${checkedAt}`,
        seedKey: "go-live:faq:v1",
      }),
    },
    {
      key: "getting-started",
      channelId: GO_LIVE_CHANNELS.gettingStarted.id,
      pin: true,
      embed: baseEmbed({
        title: "🌱 Getting Started",
        description: "Use this checklist to get fully set up before hacking.",
        fields: [
          {
            name: "Checklist",
            value: [
              "1. Register for the event on official channels.",
              "2. Run `/verify email:<your registration email>` in <#1467603518515970109>.",
              "3. Confirm with `/status`.",
              "4. Introduce yourself in <#1440784110434914336> once verified.",
            ].join("\n"),
          },
          {
            name: "Verification troubleshooting",
            value: [
              "- Use the exact registration email.",
              "- If linking fails, contact `@Event Staff` with your email.",
              "- `/help` in bot commands shows command reference.",
            ].join("\n"),
          },
        ],
        footerText: "Verification unlocks collaboration channels",
        seedKey: "go-live:getting-started:v1",
      }),
    },
    {
      key: "event-questions",
      channelId: GO_LIVE_CHANNELS.eventQuestions.id,
      pin: true,
      embed: baseEmbed({
        title: "❓ Event Questions",
        description: "Ask organizers questions about schedule, logistics, judging, and participation.",
        fields: [
          {
            name: "Question template",
            value: ["- Topic:", "- What you already checked:", "- Your question:"].join("\n"),
          },
          {
            name: "Before posting",
            value: "Check <#1440784110200160393> and the official website/Devpost first.",
          },
        ],
        footerText: "Organizers and staff monitor this channel",
        seedKey: "go-live:event-questions:v1",
      }),
    },
    {
      key: "bot-commands",
      channelId: GO_LIVE_CHANNELS.botCommands.id,
      pin: true,
      embed: baseEmbed({
        title: "🤖 Bot Commands and Verification",
        description: "Run bot commands here to keep other channels focused.",
        fields: [
          {
            name: "Verification flow",
            value: [
              "1. `/verify email:<your registration email>`",
              "2. `/status` to confirm link and roles",
              "3. `/help` for command guidance",
            ].join("\n"),
          },
          {
            name: "Other command",
            value: "`/find_teammates [interest]` to find potential teammates once verified.",
          },
        ],
        footerText: "Use your registration email exactly as submitted",
        seedKey: "go-live:bot-commands:v1",
      }),
    },
    {
      key: "introductions",
      channelId: GO_LIVE_CHANNELS.introductions.id,
      pin: true,
      embed: baseEmbed({
        title: "🔰 Introduce Yourself",
        description: "Say hi and share what you want to build so teammates and mentors can find you.",
        fields: [
          {
            name: "Intro template",
            value: ["- Name and school", "- Interests/skills", "- What you want to build", "- Team status"].join("\n"),
          },
        ],
        footerText: "Keep intros concise and friendly",
        seedKey: "go-live:introductions:v1",
      }),
    },
    {
      key: "whois",
      channelId: GO_LIVE_CHANNELS.whois.id,
      pin: true,
      embed: baseEmbed({
        title: "👤 Who Is Who",
        description: "Use this channel to ask who handles what (mentors, judges, sponsors, organizers).",
        fields: [
          {
            name: "Best use",
            value: "Ask role-specific routing questions, then move detailed discussion to the relevant channel.",
          },
        ],
        footerText: "Routing and role discovery",
        seedKey: "go-live:whois:v1",
      }),
    },
    {
      key: "get-a-mentor",
      channelId: GO_LIVE_CHANNELS.getMentor.id,
      pin: true,
      embed: baseEmbed({
        title: "✋ Request a Mentor",
        description: "Post focused mentorship requests so mentors can respond quickly.",
        fields: [
          {
            name: "Request template",
            value: ["- Problem statement", "- What you tried", "- What feedback you need", "- Urgency"].join("\n"),
          },
        ],
        footerText: "Keep requests specific for faster support",
        seedKey: "go-live:get-a-mentor:v1",
      }),
    },
    {
      key: "mentor-room",
      channelId: GO_LIVE_CHANNELS.mentorRoom.id,
      pin: true,
      embed: baseEmbed({
        title: "💬 Mentor Room Guidelines",
        description: "This channel is for active mentor-participant technical support.",
        fields: [
          {
            name: "Expectations",
            value: [
              "- Be concise and respectful.",
              "- Share code snippets or screenshots when relevant.",
              "- Move solved threads back to project channels.",
            ].join("\n"),
          },
        ],
        footerText: "Mentor collaboration zone",
        seedKey: "go-live:mentor-room:v1",
      }),
    },
    {
      key: "workshop",
      channelId: GO_LIVE_CHANNELS.workshop.id,
      pin: true,
      embed: baseEmbed({
        title: "🎒 Workshop Updates",
        description: "Workshop announcements, resources, and recap links will be posted here.",
        fields: [
          {
            name: "Latest schedule source",
            value: `${OFFICIAL_SOURCES.website}\n${OFFICIAL_SOURCES.devpost}`,
          },
        ],
        footerText: "Watch this channel for workshop updates",
        seedKey: "go-live:workshop:v1",
      }),
    },
  ];
}

export const CHANNEL_PERMISSION_TEMPLATE = {
  publicReadOnly: [
    GO_LIVE_CHANNELS.announcements.id,
    GO_LIVE_CHANNELS.welcome.id,
    GO_LIVE_CHANNELS.rules.id,
    GO_LIVE_CHANNELS.faq.id,
    GO_LIVE_CHANNELS.gettingStarted.id,
  ],
  publicInteractive: [GO_LIVE_CHANNELS.eventQuestions.id, GO_LIVE_CHANNELS.botCommands.id],
  verifiedInteractive: [
    GO_LIVE_CHANNELS.introductions.id,
    GO_LIVE_CHANNELS.general.id,
    GO_LIVE_CHANNELS.sponsor.id,
    GO_LIVE_CHANNELS.offTopic.id,
    GO_LIVE_CHANNELS.workshop.id,
    GO_LIVE_CHANNELS.whois.id,
    GO_LIVE_CHANNELS.getMentor.id,
    GO_LIVE_CHANNELS.mentorRoom.id,
  ],
};

export const PERMISSION_BITS = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
};

export { OFFICIAL_SOURCES };
