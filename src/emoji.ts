/** Telegram Premium custom emoji IDs owned by the bot creator. */
export const emoji = {
  newDeal: "5294453490549043522",
  myDeals: "5373258138906564295",
  wallet: "5294398081175959531",
  help: "5294486858149965212",
  transparency: "5294330886412608826",
  safety: "5294510381685842377",
  payment: "5294458614445025164",
  warning: "6024008227564296298",
  success: "5371083639914275191",
  hello: "5372882664275614093",
  cancel: "5373132558357795677",
  statistics: "5373357039118488365",
  buyer: "5375221879558676772",
  seller: "5375155333335392865",
  plus: "5449588387885392967",
  // Взяты из эмодзи-пула сопутствующего бота (та же связка) — для инлайн-вставок в текст сообщений.
  lock: "5373250115907662555",
  unlock: "5373250115907662555",
  robot: "5372880619871181325",
  moneybag: "5372887010782519760",
  hourglass: "5370645432990996779",
  hourglass2: "5373089484130785466",
  package: "5373258138906564295",
  memo: "5373045172953191248",
  chart: "5373357039118488365",
  wave: "5372882664275614093",
  edit: "5447467253861754118",
  next: "5438643750358262584",
  check: "5371083639914275191",
  cross: "5373132558357795677",
  star: "5438363087130372845",
  bell: "5449432248644313340",
  noEntry: "5375242946373259878",
  repeat: "5373209528466705409",
  key: "5373021292935028701",
} as const;

export type EmojiKey = keyof typeof emoji;

/** Unicode fallback shown to clients without Premium / when the custom emoji can't render. */
const fallback: Record<EmojiKey, string> = {
  newDeal: "🆕", myDeals: "📋", wallet: "👛", help: "❓", transparency: "🔎",
  safety: "🛡", payment: "💳", warning: "⚠️", success: "✅", hello: "👋",
  cancel: "❌", statistics: "📊", buyer: "🛒", seller: "💰", plus: "➕",
  lock: "🔒", unlock: "🔓", robot: "🤖", moneybag: "💰", hourglass: "⏳",
  hourglass2: "⏱", package: "📦", memo: "📝", chart: "📊", wave: "👋",
  edit: "✏️", next: "➡️", check: "✅", cross: "❌", star: "⭐",
  bell: "🔔", noEntry: "🚫", repeat: "🔄", key: "🔑",
};

/**
 * Inline premium emoji for use inside HTML message text, e.g.
 * `${p("hello")} привет!`. Falls back to a plain unicode glyph on
 * clients that can't render Telegram Premium custom emoji.
 * Requires parse_mode: "HTML" on the message.
 */
export function p(key: EmojiKey): string {
  return `<tg-emoji emoji-id="${emoji[key]}">${fallback[key]}</tg-emoji>`;
}
